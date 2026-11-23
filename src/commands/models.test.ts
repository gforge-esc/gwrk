/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithOutputScope } from "../adapters/cli/output-scope.js";
import { createFixtureRunner } from "../adapters/models/fixture-runner.js";
import { createRouteLockStore } from "../adapters/models/route-lock-store.js";
import { promoteModel } from "../application/models/promote-model.js";
import { runCli } from "../cli.js";
import {
  type DiscoverySnapshot,
  type ModelCandidate,
  type RunnerScope,
  eligibleRoutesDigest,
} from "../domain/model-qualification.js";
import type {
  FixtureRepeatEvidence,
  ModelCatalogPort,
  PromotionJudgePort,
  QualificationRunnerPort,
  StructuredJudgeVerdict,
} from "../ports/model-qualification-port.js";
import { createModelsCommand, type ModelsCommandDeps } from "./models.js";

const scope: RunnerScope = {
  workspaceId: "fixture-proj",
  runnerProfile: "local",
  platform: process.platform,
  arch: process.arch,
};

function validSnapshot(candidate: ModelCandidate): DiscoverySnapshot {
  return {
    scope,
    adapters: [
      {
        backend: candidate.backend,
        status: "available",
        cliVersion: "1.0.0",
        adapterVersion: "1.0.0",
        supportsModelForwarding: true,
        models: [
          {
            backend: candidate.backend,
            provider: candidate.provider,
            family: candidate.family,
            modelId: candidate.modelId,
            supportedEfforts: candidate.effort ? [candidate.effort] : [],
            isDefault: true,
            hidden: false,
          },
        ],
      },
      {
        backend: "claude",
        status: "available",
        cliVersion: "1.0.0",
        adapterVersion: "1.0.0",
        supportsModelForwarding: true,
        models: [
          {
            backend: "claude",
            provider: "anthropic",
            family: "claude-3-7",
            modelId: "claude-3-7-sonnet",
            supportedEfforts: [],
            isDefault: true,
            hidden: false,
          },
        ],
      },
    ],
  };
}

describe("gwrk models CLI (TR-012, TR-013)", () => {
  let root: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    process.env.GWRK_FIXTURES_DIR = join(
      originalCwd,
      "tests/fixtures/model-qualification",
    );
    root = await mkdtemp(join(tmpdir(), "gwrk-models-cli-test-"));
    await writeFile(
      join(root, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "fixture-proj" } }),
    );
    process.chdir(root);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  async function executeCli(args: string[]) {
    let stdout = "";
    let stderr = "";
    const exitCode = await runCli(args, {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });
    return { exitCode, stdout, stderr };
  }

  it("FR-001: shows Examples: section in --help for models and its subcommands", async () => {
    const parent = await executeCli(["models", "--help"]);
    expect(parent.exitCode).toBe(0);
    expect(parent.stdout).toMatch(/Examples:/i);

    const discover = await executeCli(["models", "discover", "--help"]);
    expect(discover.exitCode).toBe(0);
    expect(discover.stdout).toMatch(/Examples:/i);

    const evaluate = await executeCli(["models", "evaluate", "--help"]);
    expect(evaluate.exitCode).toBe(0);
    expect(evaluate.stdout).toMatch(/Examples:/i);

    const promote = await executeCli(["models", "promote", "--help"]);
    expect(promote.exitCode).toBe(0);
    expect(promote.stdout).toMatch(/Examples:/i);
  });

  it("TR-012: discovers models and outputs snapshot JSON with operational signal", async () => {
    const candidate: ModelCandidate = {
      backend: "codex",
      provider: "openai",
      family: "gpt-6",
      modelId: "gpt-6.1-sol",
    };
    const store = createRouteLockStore(root);
    const catalog: ModelCatalogPort = {
      async discoverCatalog() {
        return validSnapshot(candidate).adapters.map((adapter) => ({
          ...adapter,
          models: adapter.models.map((model) => ({ ...model })),
        }));
      },
    };
    let stdout = "";
    let stderr = "";
    const outputScope = {
      agentMode: false,
      exitCode: 0,
      stdout: (chunk: string) => {
        stdout += chunk;
      },
      stderr: (chunk: string) => {
        stderr += chunk;
      },
    };
    const cmd = createModelsCommand({ catalog, store, projectRoot: root });
    cmd.exitOverride();
    for (const sub of cmd.commands) sub.exitOverride();
    await runWithOutputScope(outputScope, async () => {
      await cmd.parseAsync(["discover", "--format", "json"], { from: "user" });
    });

    expect(outputScope.exitCode).toBe(0);
    expect(stderr).toMatch(/\[exit:0 \| [^\]]+\]/);

    const snapshot = JSON.parse(stdout);
    expect(snapshot.scope.runnerProfile).toBe("local");
    expect(Array.isArray(snapshot.adapters)).toBe(true);

    const persisted = await store.readDiscoverySnapshot(scope);
    expect(persisted).not.toBeNull();
    expect(persisted?.adapters).toHaveLength(2);
  });

  it("TR-012: promotes passing candidate and records active lock and digest", async () => {
    const candidate: ModelCandidate = {
      backend: "codex",
      provider: "openai",
      family: "gpt-6",
      modelId: "gpt-6.1-sol",
    };

    const store = createRouteLockStore(root);
    const snapshot = validSnapshot(candidate);
    await store.writeDiscoverySnapshot(scope, snapshot);

    const runner = createFixtureRunner({
      fixturesDir: join(originalCwd, "tests/fixtures/model-qualification"),
    });
    const suiteHashes = await runner.computeSuiteHashes();

    const verdict1 = {
      judgeBackend: "claude",
      judgeProvider: "anthropic",
      judgeFamily: "claude-3-7",
      judgeModelId: "claude-3-7-sonnet",
      observedJudgeModel: "claude-3-7-sonnet",
      winner: "A" as const,
      optionARegression: false,
      optionBRegression: false,
      scores: { optionA: 95, optionB: 80 },
      citations: [
        {
          claim: "Requirement covered",
          inputRef: "input:1:A:0",
          outputRef: "optionA",
          gateRef: "gate:1:A:0",
        },
      ],
    };
    const verdict2 = {
      judgeBackend: "agy",
      judgeProvider: "google",
      judgeFamily: "gemini",
      judgeModelId: "gemini-2.5-pro",
      observedJudgeModel: "gemini-2.5-pro",
      winner: "A" as const,
      optionARegression: false,
      optionBRegression: false,
      scores: { optionA: 90, optionB: 75 },
      citations: [
        {
          claim: "Clear plan",
          inputRef: "input:1:A:0",
          outputRef: "optionA",
          gateRef: "gate:1:A:0",
        },
      ],
    };

    const evalId = "eval-passing-1";
    const bundle = {
      evaluationId: evalId,
      role: "define",
      candidate,
      incumbent: {
        backend: "claude",
        provider: "anthropic",
        family: "claude-3-5",
        modelId: "claude-3-5-sonnet",
      },
      scope,
      incumbentDigest: null,
      snapshotHash: createHash("sha256")
        .update(JSON.stringify(snapshot))
        .digest("hex"),
      eligibleRoutesDigest: eligibleRoutesDigest(snapshot, scope),
      toolVersions: { cliVersion: "1.0.0", adapterVersion: "1.0.0" },
      suiteHashes,
      judgeVerdictHashes: [
        createHash("sha256").update(JSON.stringify(verdict1)).digest("hex"),
        createHash("sha256").update(JSON.stringify(verdict2)).digest("hex"),
      ],
      promotionEvidence: {
        candidateOption: "A",
        requiredFixtures: ["0", "1"],
        repeats: [0, 1, 2].flatMap((repeatIndex) => [
          { fixtureId: "0", repeatIndex, gatesPassed: true },
          { fixtureId: "1", repeatIndex, gatesPassed: true },
        ]),
        judges: [verdict1, verdict2],
        refs: {
          input: ["input:1:A:0"],
          output: ["optionA", "optionB"],
          gate: ["gate:1:A:0"],
        },
      },
      comparisons: [
        {
          fixtureId: "define-long-context",
          repeats: {
            candidate: [0, 1, 2].map((repeatIndex) => ({
              fixtureId: "define-long-context",
              repeatIndex,
              deterministicGatesPassed: true,
              gateChecks: [{ checkId: "c1", passed: true, detail: "ok" }],
            })),
            incumbent: [0, 1, 2].map((repeatIndex) => ({
              fixtureId: "define-long-context",
              repeatIndex,
              deterministicGatesPassed: true,
            })),
          },
        },
        {
          fixtureId: "implement-seeded-defect",
          handoff: {
            from: "define-long-context",
            to: "implement-seeded-defect",
            planSource: "candidate" as const,
          },
          repeats: {
            candidate: [0, 1, 2].map((repeatIndex) => ({
              fixtureId: "implement-seeded-defect",
              repeatIndex,
              deterministicGatesPassed: true,
              gateChecks: [{ checkId: "c1", passed: true, detail: "ok" }],
            })),
            incumbent: [0, 1, 2].map((repeatIndex) => ({
              fixtureId: "implement-seeded-defect",
              repeatIndex,
              deterministicGatesPassed: true,
            })),
          },
        },
      ],
    };

    await store.writeEvaluationBundle(evalId, bundle);

    const { exitCode, stdout, stderr } = await executeCli([
      "models",
      "promote",
      "--eval",
      evalId,
      "--format",
      "json",
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/\[exit:0 \| [^\]]+\]/);
    const result = JSON.parse(stdout);
    expect(result.promote).toBe(true);
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);

    const activeLock = await store.readRouteLock(scope);
    expect(activeLock).not.toBeNull();
    expect(activeLock?.digest).toBe(result.digest);
    expect(activeLock?.document.routes.define?.modelId).toBe("gpt-6.1-sol");
  });

  it("TR-012: rejects absent model not present in runner discovery snapshot", async () => {
    const candidate: ModelCandidate = {
      backend: "unknown-backend",
      provider: "unknown-provider",
      family: "unknown-family",
      modelId: "nonexistent-model",
    };

    const store = createRouteLockStore(root);
    await store.writeDiscoverySnapshot(scope, { scope, adapters: [] });

    const runner = createFixtureRunner({
      fixturesDir: join(originalCwd, "tests/fixtures/model-qualification"),
    });
    const suiteHashes = await runner.computeSuiteHashes();

    const evalId = "eval-absent";
    const bundle = {
      evaluationId: evalId,
      role: "define",
      candidate,
      scope,
      incumbentDigest: null,
      suiteHashes,
      judgeVerdictHashes: [
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ],
      promotionEvidence: {
        candidateOption: "A",
        requiredFixtures: ["0"],
        repeats: [{ fixtureId: "0", repeatIndex: 0, gatesPassed: true }],
        judges: [],
        refs: { input: [], output: [], gate: [] },
      },
    };
    await store.writeEvaluationBundle(evalId, bundle);

    const { exitCode, stderr } = await executeCli([
      "models",
      "promote",
      "--eval",
      evalId,
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/\[exit:1 \| [^\]]+\]/);
    expect(stderr).toMatch(/model-unavailable/);
  });

  it("TR-012: rejects stale evaluation runs when suite hashes change", async () => {
    const candidate: ModelCandidate = {
      backend: "codex",
      provider: "openai",
      family: "gpt-6",
      modelId: "gpt-6.1-sol",
    };

    const store = createRouteLockStore(root);
    await store.writeDiscoverySnapshot(scope, validSnapshot(candidate));

    const evalId = "eval-stale";
    const bundle = {
      evaluationId: evalId,
      role: "define",
      candidate,
      scope,
      incumbentDigest: null,
      suiteHashes: {
        fixtureSuiteHash:
          "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        workflowPromptHashes: {
          "define-spec":
            "2222222222222222222222222222222222222222222222222222222222222222",
        },
      },
      judgeVerdictHashes: [
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ],
      promotionEvidence: {
        candidateOption: "A",
        requiredFixtures: ["0"],
        repeats: [{ fixtureId: "0", repeatIndex: 0, gatesPassed: true }],
        judges: [],
        refs: { input: [], output: [], gate: [] },
      },
    };
    await store.writeEvaluationBundle(evalId, bundle);

    const { exitCode, stderr } = await executeCli([
      "models",
      "promote",
      "--eval",
      evalId,
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/\[exit:1 \| [^\]]+\]/);
    expect(stderr).toMatch(/stale-evaluation-inputs/);
  });

  it("TR-012: rejects split-judge runs where judges disagree", async () => {
    const candidate: ModelCandidate = {
      backend: "codex",
      provider: "openai",
      family: "gpt-6",
      modelId: "gpt-6.1-sol",
    };

    const store = createRouteLockStore(root);
    await store.writeDiscoverySnapshot(scope, validSnapshot(candidate));

    const runner = createFixtureRunner({
      fixturesDir: join(originalCwd, "tests/fixtures/model-qualification"),
    });
    const suiteHashes = await runner.computeSuiteHashes();

    const verdict1 = {
      judgeBackend: "claude",
      judgeProvider: "anthropic",
      judgeFamily: "claude-3-7",
      judgeModelId: "claude-3-7-sonnet",
      observedJudgeModel: "claude-3-7-sonnet",
      winner: "A" as const,
      optionARegression: false,
      optionBRegression: false,
      scores: { optionA: 90, optionB: 70 },
      citations: [
        {
          claim: "C1",
          inputRef: "input:1:A:0",
          outputRef: "optionA",
          gateRef: "gate:1:A:0",
        },
      ],
    };
    const verdict2Split = {
      judgeBackend: "agy",
      judgeProvider: "google",
      judgeFamily: "gemini",
      judgeModelId: "gemini-2.5-pro",
      observedJudgeModel: "gemini-2.5-pro",
      winner: "B" as const, // Disagreement: judge 2 picked B!
      optionARegression: false,
      optionBRegression: false,
      scores: { optionA: 70, optionB: 90 },
      citations: [
        {
          claim: "C2",
          inputRef: "input:1:A:0",
          outputRef: "optionA",
          gateRef: "gate:1:A:0",
        },
      ],
    };

    const evalId = "eval-split-judge";
    const bundle = {
      evaluationId: evalId,
      role: "define",
      candidate,
      scope,
      incumbentDigest: null,
      suiteHashes,
      judgeVerdictHashes: [
        createHash("sha256").update(JSON.stringify(verdict1)).digest("hex"),
        createHash("sha256")
          .update(JSON.stringify(verdict2Split))
          .digest("hex"),
      ],
      promotionEvidence: {
        candidateOption: "A",
        requiredFixtures: ["define-long-context"],
        repeats: [
          { fixtureId: "define-long-context", repeatIndex: 0, gatesPassed: true },
          { fixtureId: "define-long-context", repeatIndex: 1, gatesPassed: true },
          { fixtureId: "define-long-context", repeatIndex: 2, gatesPassed: true },
        ],
        judges: [verdict1, verdict2Split],
        refs: {
          input: ["input:1:A:0"],
          output: ["optionA", "optionB"],
          gate: ["gate:1:A:0"],
        },
      },
      comparisons: [
        {
          fixtureId: "implement-seeded-defect",
          handoff: {
            from: "define-long-context",
            to: "implement-seeded-defect",
            planSource: "candidate" as const,
          },
          repeats: {
            candidate: [
              {
                repeatIndex: 0,
                deterministicGatesPassed: true,
                gateChecks: [{ checkId: "c1", passed: true, detail: "ok" }],
              },
              {
                repeatIndex: 1,
                deterministicGatesPassed: true,
                gateChecks: [{ checkId: "c1", passed: true, detail: "ok" }],
              },
              {
                repeatIndex: 2,
                deterministicGatesPassed: true,
                gateChecks: [{ checkId: "c1", passed: true, detail: "ok" }],
              },
            ],
            incumbent: [
              { repeatIndex: 0, deterministicGatesPassed: true },
              { repeatIndex: 1, deterministicGatesPassed: true },
              { repeatIndex: 2, deterministicGatesPassed: true },
            ],
          },
        },
      ],
    };
    await store.writeEvaluationBundle(evalId, bundle);

    const { exitCode, stderr } = await executeCli([
      "models",
      "promote",
      "--eval",
      evalId,
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/\[exit:1 \| [^\]]+\]/);
    expect(stderr).toMatch(/judge-non-regression/);
  });

  it("TR-011: rollback restores the previous lock and leaves intermediate writes intact", async () => {
    const candidate1: ModelCandidate = {
      backend: "codex",
      provider: "openai",
      family: "gpt-6",
      modelId: "gpt-6.1-sol",
    };
    const candidate2: ModelCandidate = {
      backend: "codex",
      provider: "openai",
      family: "gpt-6",
      modelId: "gpt-6.2-sol",
    };

    const store = createRouteLockStore(root);
    await store.writeDiscoverySnapshot(scope, {
      scope,
      adapters: [
        {
          backend: "codex",
          status: "available",
          cliVersion: "1.0.0",
          adapterVersion: "1.0.0",
          supportsModelForwarding: true,
          models: [
            {
              backend: "codex",
              provider: "openai",
              family: "gpt-6",
              modelId: "gpt-6.1-sol",
              supportedEfforts: [],
              isDefault: false,
              hidden: false,
            },
            {
              backend: "codex",
              provider: "openai",
              family: "gpt-6",
              modelId: "gpt-6.2-sol",
              supportedEfforts: [],
              isDefault: false,
              hidden: false,
            },
          ],
        },
      ],
    });

    const lockV1 = {
      schemaVersion: 1 as const,
      workspaceId: scope.workspaceId,
      runnerProfile: scope.runnerProfile,
      updatedAt: "2026-11-18T12:00:00.000Z",
      routes: {
        define: {
          role: "define" as const,
          routeMode: "pinned" as const,
          backend: candidate1.backend,
          provider: candidate1.provider,
          family: candidate1.family,
          modelId: candidate1.modelId,
          fallbackRoutes: [],
          toolVersions: { cliVersion: "1.0.0", adapterVersion: "1.0.0" },
          evidence: {
            evaluationId: "eval-v1",
            snapshotHash:
              "1111111111111111111111111111111111111111111111111111111111111111",
            evaluationBundleHash:
              "2222222222222222222222222222222222222222222222222222222222222222",
            fixtureSuiteHash:
              "3333333333333333333333333333333333333333333333333333333333333333",
            workflowPromptHashes: {
              p: "4444444444444444444444444444444444444444444444444444444444444444",
            },
            judgeVerdictHashes: [
              "5555555555555555555555555555555555555555555555555555555555555555",
              "6666666666666666666666666666666666666666666666666666666666666666",
            ] as [string, string],
          },
        },
      },
    };

    const digestV1 = await store.writeRouteLockAtomic(scope, {
      document: lockV1,
      expectedIncumbentDigest: null,
    });

    const lockV2 = {
      ...lockV1,
      updatedAt: "2026-11-18T13:00:00.000Z",
      routes: {
        define: {
          ...lockV1.routes.define,
          modelId: candidate2.modelId,
        },
      },
      previousLock: lockV1,
    };

    const digestV2 = await store.writeRouteLockAtomic(scope, {
      document: lockV2,
      expectedIncumbentDigest: digestV1,
    });

    const activeBefore = await store.readRouteLock(scope);
    expect(activeBefore?.document.routes.define?.modelId).toBe("gpt-6.2-sol");
    expect(activeBefore?.digest).toBe(digestV2);

    const { exitCode, stdout, stderr } = await executeCli([
      "models",
      "promote",
      "--rollback",
      "--format",
      "json",
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/\[exit:0 \| [^\]]+\]/);
    const rollbackResponse = JSON.parse(stdout);
    expect(rollbackResponse.ok).toBe(true);

    const activeAfter = await store.readRouteLock(scope);
    expect(activeAfter?.document.routes.define?.modelId).toBe("gpt-6.1-sol");
    expect(activeAfter?.digest).toBe(digestV1);
  });

  describe("Phase 4 review regressions (T017 promoteModel)", () => {
    const candidate: ModelCandidate = {
      backend: "codex",
      provider: "openai",
      family: "gpt-6",
      modelId: "gpt-6.1-sol",
    };
    const incumbent: ModelCandidate = {
      backend: "claude",
      provider: "anthropic",
      family: "claude-3-7",
      modelId: "claude-3-7-sonnet",
    };

    const suiteHashes = {
      fixtureSuiteHash: "1".repeat(64),
      workflowPromptHashes: {
        "gwrk-specify": "2".repeat(64),
        "gwrk-plan": "3".repeat(64),
        "gwrk-implement": "4".repeat(64),
      },
    };

    function createStubRunner(): QualificationRunnerPort {
      return {
        async loadSuite() {
          return {
            repeats: 3,
            fixtures: [
              { id: "define-long-context", roles: ["define"] },
              { id: "implement-seeded-defect", roles: ["implement", "review"] },
            ],
            handoffs: [
              {
                from: "define-long-context",
                to: "implement-seeded-defect",
                planSource: "candidate",
              },
              {
                from: "define-long-context",
                to: "implement-seeded-defect",
                planSource: "fixed",
              },
            ],
          };
        },
        async computeSuiteHashes() {
          return suiteHashes;
        },
        async runFixtureRepeat() {
          throw new Error("runFixtureRepeat should not be called by promote");
        },
      };
    }

    function makeJudges(): [StructuredJudgeVerdict, StructuredJudgeVerdict] {
      return [
        {
          judgeBackend: "claude",
          judgeProvider: "anthropic",
          judgeFamily: "claude-3-7",
          judgeModelId: "claude-3-7-sonnet",
          observedJudgeModel: "claude-3-7-sonnet",
          winner: "A",
          optionARegression: false,
          optionBRegression: false,
          scores: { optionA: 95, optionB: 80 },
          citations: [
            {
              claim: "Requirement covered",
              inputRef: "input:1:A:0",
              outputRef: "optionA",
              gateRef: "gate:1:A:0",
            },
          ],
        },
        {
          judgeBackend: "agy",
          judgeProvider: "google",
          judgeFamily: "gemini",
          judgeModelId: "gemini-2.5-pro",
          observedJudgeModel: "gemini-2.5-pro",
          winner: "A",
          optionARegression: false,
          optionBRegression: false,
          scores: { optionA: 92, optionB: 78 },
          citations: [
            {
              claim: "Plan passes gates",
              inputRef: "input:1:A:0",
              outputRef: "optionA",
              gateRef: "gate:1:A:0",
            },
          ],
        },
      ];
    }

    function hashVerdicts(
      judges: readonly [StructuredJudgeVerdict, StructuredJudgeVerdict],
    ): [string, string] {
      return [
        createHash("sha256").update(JSON.stringify(judges[0])).digest("hex"),
        createHash("sha256").update(JSON.stringify(judges[1])).digest("hex"),
      ];
    }

    it("rejects implement promotion when recomputed repeat medians are slower than incumbent despite forged roleScore", async () => {
      const store = createRouteLockStore(root);
      await store.writeDiscoverySnapshot(scope, validSnapshot(candidate));
      const judges = makeJudges();
      const evalId = "eval-forged-speed";
      await store.writeEvaluationBundle(evalId, {
        evaluationId: evalId,
        role: "implement",
        candidate,
        incumbent,
        scope,
        incumbentDigest: null,
        suiteHashes,
        judgeVerdictHashes: hashVerdicts(judges),
        promotionEvidence: {
          candidateOption: "A",
          requiredFixtures: ["0", "1"],
          repeats: [0, 1, 2].flatMap((repeatIndex) => [
            { fixtureId: "0", repeatIndex, gatesPassed: true },
            { fixtureId: "1", repeatIndex, gatesPassed: true },
          ]),
          judges,
          refs: {
            input: ["input:1:A:0"],
            output: ["optionA", "optionB"],
            gate: ["gate:1:A:0"],
          },
        },
        comparisons: [
          {
            fixtureId: "implement-seeded-defect",
            handoff: {
              from: "define-long-context",
              to: "implement-seeded-defect",
              planSource: "fixed",
            },
            repeats: {
              candidate: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "implement-seeded-defect",
                repeatIndex,
                durationMs: 500,
                deterministicGatesPassed: true,
                gateChecks: [{ checkId: "tests", passed: true, detail: "ok" }],
              })),
              incumbent: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "implement-seeded-defect",
                repeatIndex,
                durationMs: 100,
                deterministicGatesPassed: true,
                gateChecks: [{ checkId: "tests", passed: true, detail: "ok" }],
              })),
            },
            roleScore: {
              role: "implement",
              candidateMedianMsToGreen: 10,
              incumbentMedianMsToGreen: 200,
              speedup: 20,
            },
          },
        ],
      });

      const result = await promoteModel(
        { store, runner: createStubRunner() },
        { scope, evaluationId: evalId, nowIso: "2026-11-18T12:00:00.000Z" },
      );
      expect(result).toEqual({
        promote: false,
        reason: "implementation-not-faster",
      });
    });

    it("rejects implement promotion when required fixed-plan handoff comparison is missing", async () => {
      const store = createRouteLockStore(root);
      await store.writeDiscoverySnapshot(scope, validSnapshot(candidate));
      const judges = makeJudges();
      const evalId = "eval-missing-fixed-handoff";
      await store.writeEvaluationBundle(evalId, {
        evaluationId: evalId,
        role: "implement",
        candidate,
        incumbent,
        scope,
        incumbentDigest: null,
        suiteHashes,
        judgeVerdictHashes: hashVerdicts(judges),
        promotionEvidence: {
          candidateOption: "A",
          requiredFixtures: ["0"],
          repeats: [0, 1, 2].map((repeatIndex) => ({
            fixtureId: "0",
            repeatIndex,
            gatesPassed: true,
          })),
          judges,
          refs: {
            input: ["input:1:A:0"],
            output: ["optionA", "optionB"],
            gate: ["gate:1:A:0"],
          },
        },
        comparisons: [
          {
            fixtureId: "implement-seeded-defect",
            repeats: {
              candidate: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "implement-seeded-defect",
                repeatIndex,
                durationMs: 50,
                deterministicGatesPassed: true,
                gateChecks: [{ checkId: "tests", passed: true, detail: "ok" }],
              })),
              incumbent: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "implement-seeded-defect",
                repeatIndex,
                durationMs: 200,
                deterministicGatesPassed: true,
                gateChecks: [{ checkId: "tests", passed: true, detail: "ok" }],
              })),
            },
            roleScore: {
              role: "implement",
              candidateMedianMsToGreen: 50,
              incumbentMedianMsToGreen: 200,
              speedup: 4,
            },
          },
        ],
      });

      const result = await promoteModel(
        { store, runner: createStubRunner() },
        { scope, evaluationId: evalId, nowIso: "2026-11-18T12:00:00.000Z" },
      );
      expect(result.promote).toBe(false);
    });

    it("rejects promotion when judgeVerdictHashes do not match replayed judge verdicts", async () => {
      const store = createRouteLockStore(root);
      await store.writeDiscoverySnapshot(scope, validSnapshot(candidate));
      const judges = makeJudges();
      const evalId = "eval-bad-verdict-hash";
      await store.writeEvaluationBundle(evalId, {
        evaluationId: evalId,
        role: "define",
        candidate,
        incumbent,
        scope,
        incumbentDigest: null,
        suiteHashes,
        judgeVerdictHashes: ["a".repeat(64), "b".repeat(64)],
        promotionEvidence: {
          candidateOption: "A",
          requiredFixtures: ["0", "1"],
          repeats: [0, 1, 2].flatMap((repeatIndex) => [
            { fixtureId: "0", repeatIndex, gatesPassed: true },
            { fixtureId: "1", repeatIndex, gatesPassed: true },
          ]),
          judges,
          refs: {
            input: ["input:1:A:0"],
            output: ["optionA", "optionB"],
            gate: ["gate:1:A:0"],
          },
        },
        comparisons: [
          {
            fixtureId: "define-long-context",
            repeats: {
              candidate: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "define-long-context",
                repeatIndex,
                deterministicGatesPassed: true,
                gateChecks: [{ checkId: "c1", passed: true, detail: "ok" }],
              })),
              incumbent: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "define-long-context",
                repeatIndex,
                deterministicGatesPassed: true,
              })),
            },
          },
          {
            fixtureId: "implement-seeded-defect",
            handoff: {
              from: "define-long-context",
              to: "implement-seeded-defect",
              planSource: "candidate",
            },
            repeats: {
              candidate: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "implement-seeded-defect",
                repeatIndex,
                deterministicGatesPassed: true,
                gateChecks: [{ checkId: "c1", passed: true, detail: "ok" }],
              })),
              incumbent: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "implement-seeded-defect",
                repeatIndex,
                deterministicGatesPassed: true,
              })),
            },
          },
        ],
      });

      const result = await promoteModel(
        { store, runner: createStubRunner() },
        { scope, evaluationId: evalId, nowIso: "2026-11-18T12:00:00.000Z" },
      );
      expect(result.promote).toBe(false);
    });

    it("rejects define promotion when handoff repeats have duplicate repeatIndex values", async () => {
      const store = createRouteLockStore(root);
      await store.writeDiscoverySnapshot(scope, validSnapshot(candidate));
      const judges = makeJudges();
      const evalId = "eval-dup-handoff-repeat";
      await store.writeEvaluationBundle(evalId, {
        evaluationId: evalId,
        role: "define",
        candidate,
        incumbent,
        scope,
        incumbentDigest: null,
        suiteHashes,
        judgeVerdictHashes: hashVerdicts(judges),
        promotionEvidence: {
          candidateOption: "A",
          requiredFixtures: ["0", "1"],
          repeats: [0, 1, 2].flatMap((repeatIndex) => [
            { fixtureId: "0", repeatIndex, gatesPassed: true },
            { fixtureId: "1", repeatIndex, gatesPassed: true },
          ]),
          judges,
          refs: {
            input: ["input:1:A:0"],
            output: ["optionA", "optionB"],
            gate: ["gate:1:A:0"],
          },
        },
        comparisons: [
          {
            fixtureId: "define-long-context",
            repeats: {
              candidate: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "define-long-context",
                repeatIndex,
                deterministicGatesPassed: true,
                gateChecks: [{ checkId: "c1", passed: true, detail: "ok" }],
              })),
              incumbent: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "define-long-context",
                repeatIndex,
                deterministicGatesPassed: true,
              })),
            },
          },
          {
            fixtureId: "implement-seeded-defect",
            handoff: {
              from: "define-long-context",
              to: "implement-seeded-defect",
              planSource: "candidate",
            },
            repeats: {
              candidate: [0, 0, 0].map((repeatIndex) => ({
                fixtureId: "implement-seeded-defect",
                repeatIndex,
                deterministicGatesPassed: true,
                gateChecks: [{ checkId: "c1", passed: true, detail: "ok" }],
              })),
              incumbent: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "implement-seeded-defect",
                repeatIndex,
                deterministicGatesPassed: true,
              })),
            },
          },
        ],
      });

      const result = await promoteModel(
        { store, runner: createStubRunner() },
        { scope, evaluationId: evalId, nowIso: "2026-11-18T12:00:00.000Z" },
      );
      expect(result.promote).toBe(false);
    });

    it("rejects promotion when bundle incumbent does not match active route lock pin", async () => {
      const store = createRouteLockStore(root);
      await store.writeDiscoverySnapshot(scope, validSnapshot(candidate));
      const incumbentLockDigest = await store.writeRouteLockAtomic(scope, {
        document: {
          schemaVersion: 1,
          workspaceId: scope.workspaceId,
          runnerProfile: scope.runnerProfile,
          updatedAt: "2026-11-18T11:00:00.000Z",
          routes: {
            define: {
              role: "define",
              routeMode: "pinned",
              backend: incumbent.backend,
              provider: incumbent.provider,
              family: incumbent.family,
              modelId: incumbent.modelId,
              fallbackRoutes: [],
              toolVersions: { cliVersion: "1.0.0", adapterVersion: "1.0.0" },
              evidence: {
                evaluationId: "eval-prior",
                snapshotHash: "1".repeat(64),
                evaluationBundleHash: "2".repeat(64),
                fixtureSuiteHash: "3".repeat(64),
                workflowPromptHashes: { p: "4".repeat(64) },
                judgeVerdictHashes: ["5".repeat(64), "6".repeat(64)],
              },
            },
          },
        },
        expectedIncumbentDigest: null,
      });

      const judges = makeJudges();
      const evalId = "eval-wrong-incumbent";
      await store.writeEvaluationBundle(evalId, {
        evaluationId: evalId,
        role: "define",
        candidate,
        incumbent: {
          backend: "codex",
          provider: "openai",
          family: "gpt-5",
          modelId: "gpt-5.2-codex",
        },
        scope,
        incumbentDigest: incumbentLockDigest,
        suiteHashes,
        judgeVerdictHashes: hashVerdicts(judges),
        promotionEvidence: {
          candidateOption: "A",
          requiredFixtures: ["0", "1"],
          repeats: [0, 1, 2].flatMap((repeatIndex) => [
            { fixtureId: "0", repeatIndex, gatesPassed: true },
            { fixtureId: "1", repeatIndex, gatesPassed: true },
          ]),
          judges,
          refs: {
            input: ["input:1:A:0"],
            output: ["optionA", "optionB"],
            gate: ["gate:1:A:0"],
          },
        },
        comparisons: [
          {
            fixtureId: "define-long-context",
            repeats: {
              candidate: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "define-long-context",
                repeatIndex,
                deterministicGatesPassed: true,
                gateChecks: [{ checkId: "c1", passed: true, detail: "ok" }],
              })),
              incumbent: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "define-long-context",
                repeatIndex,
                deterministicGatesPassed: true,
              })),
            },
          },
          {
            fixtureId: "implement-seeded-defect",
            handoff: {
              from: "define-long-context",
              to: "implement-seeded-defect",
              planSource: "candidate",
            },
            repeats: {
              candidate: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "implement-seeded-defect",
                repeatIndex,
                deterministicGatesPassed: true,
                gateChecks: [{ checkId: "c1", passed: true, detail: "ok" }],
              })),
              incumbent: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "implement-seeded-defect",
                repeatIndex,
                deterministicGatesPassed: true,
              })),
            },
          },
        ],
      });

      const result = await promoteModel(
        { store, runner: createStubRunner() },
        { scope, evaluationId: evalId, nowIso: "2026-11-18T12:00:00.000Z" },
      );
      expect(result.promote).toBe(false);
    });

    it("rejects promotion when runner snapshot tool versions or eligible models changed after evaluation", async () => {
      const store = createRouteLockStore(root);
      const originalSnapshot = validSnapshot(candidate);
      const updatedSnapshot: DiscoverySnapshot = {
        scope,
        adapters: originalSnapshot.adapters.map((adapter) =>
          adapter.backend === candidate.backend
            ? {
                ...adapter,
                cliVersion: "2.0.0",
                models: [
                  ...adapter.models,
                  {
                    backend: candidate.backend,
                    provider: candidate.provider,
                    family: "gpt-7",
                    modelId: "gpt-7.0-preview",
                    supportedEfforts: [],
                    isDefault: false,
                    hidden: false,
                  },
                ],
              }
            : adapter,
        ),
      };
      await store.writeDiscoverySnapshot(scope, updatedSnapshot);

      const judges = makeJudges();
      const evalId = "eval-stale-snapshot";
      await store.writeEvaluationBundle(evalId, {
        evaluationId: evalId,
        role: "define",
        candidate,
        incumbent,
        scope,
        incumbentDigest: null,
        snapshotHash: createHash("sha256")
          .update(JSON.stringify(originalSnapshot))
          .digest("hex"),
        eligibleRoutesDigest: eligibleRoutesDigest(originalSnapshot, scope),
        toolVersions: { cliVersion: "1.0.0", adapterVersion: "1.0.0" },
        suiteHashes,
        judgeVerdictHashes: hashVerdicts(judges),
        promotionEvidence: {
          candidateOption: "A",
          requiredFixtures: ["0", "1"],
          repeats: [0, 1, 2].flatMap((repeatIndex) => [
            { fixtureId: "0", repeatIndex, gatesPassed: true },
            { fixtureId: "1", repeatIndex, gatesPassed: true },
          ]),
          judges,
          refs: {
            input: ["input:1:A:0"],
            output: ["optionA", "optionB"],
            gate: ["gate:1:A:0"],
          },
        },
        comparisons: [
          {
            fixtureId: "define-long-context",
            repeats: {
              candidate: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "define-long-context",
                repeatIndex,
                deterministicGatesPassed: true,
                gateChecks: [{ checkId: "c1", passed: true, detail: "ok" }],
              })),
              incumbent: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "define-long-context",
                repeatIndex,
                deterministicGatesPassed: true,
              })),
            },
          },
          {
            fixtureId: "implement-seeded-defect",
            handoff: {
              from: "define-long-context",
              to: "implement-seeded-defect",
              planSource: "candidate",
            },
            repeats: {
              candidate: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "implement-seeded-defect",
                repeatIndex,
                deterministicGatesPassed: true,
                gateChecks: [{ checkId: "c1", passed: true, detail: "ok" }],
              })),
              incumbent: [0, 1, 2].map((repeatIndex) => ({
                fixtureId: "implement-seeded-defect",
                repeatIndex,
                deterministicGatesPassed: true,
              })),
            },
          },
        ],
      });

      const result = await promoteModel(
        { store, runner: createStubRunner() },
        { scope, evaluationId: evalId, nowIso: "2026-11-18T12:00:00.000Z" },
      );
      expect(result.promote).toBe(false);
    });
  });

  describe("Phase 4 review regressions (T019 models CLI)", () => {
    const candidate: ModelCandidate = {
      backend: "codex",
      provider: "openai",
      family: "gpt-6",
      modelId: "gpt-6.1-sol",
    };
    const incumbent: ModelCandidate = {
      backend: "claude",
      provider: "anthropic",
      family: "claude-3-7",
      modelId: "claude-3-7-sonnet",
    };

    async function runInjectedModels(
      args: string[],
      deps: ModelsCommandDeps,
    ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
      let stdout = "";
      let stderr = "";
      const outputScope = {
        agentMode: false,
        exitCode: 0,
        stdout: (chunk: string) => {
          stdout += chunk;
        },
        stderr: (chunk: string) => {
          stderr += chunk;
        },
      };
      const cmd = createModelsCommand(deps);
      cmd.exitOverride();
      for (const sub of cmd.commands) sub.exitOverride();
      try {
        await runWithOutputScope(outputScope, async () => {
          await cmd.parseAsync(args, { from: "user" });
        });
        return { exitCode: outputScope.exitCode, stdout, stderr };
      } catch (error: unknown) {
        const exitCode =
          error &&
          typeof error === "object" &&
          "exitCode" in error &&
          typeof error.exitCode === "number"
            ? error.exitCode
            : 1;
        return { exitCode, stdout, stderr: `${stderr}${String(error)}` };
      }
    }

    function createSyntheticDeps(
      projectRoot: string,
      overrides: {
        runRepeat?: QualificationRunnerPort["runFixtureRepeat"];
        judge?: PromotionJudgePort["judgeComparison"];
      } = {},
    ) {
      const store = createRouteLockStore(projectRoot);
      const snapshot = validSnapshot(candidate);
      const catalog: ModelCatalogPort = {
        async discoverCatalog({ scope: reqScope }) {
          if (!reqScope.runnerProfile) return [];
          return [
            ...snapshot.adapters.map((adapter) => ({
              ...adapter,
              models: adapter.models.map((model) => ({ ...model })),
            })),
            {
              backend: "agy",
              status: "available" as const,
              cliVersion: "1.0.0",
              adapterVersion: "1.0.0",
              supportsModelForwarding: true,
              models: [
                {
                  backend: "agy",
                  provider: "google",
                  family: "gemini",
                  modelId: "gemini-2.5-pro",
                  supportedEfforts: [],
                  isDefault: true,
                  hidden: false,
                },
              ],
            },
          ];
        },
      };
      const runFixtureRepeat = vi.fn<QualificationRunnerPort["runFixtureRepeat"]>(
        overrides.runRepeat ??
          (async (request): Promise<FixtureRepeatEvidence> => ({
            fixtureId: request.fixtureId,
            repeatIndex: request.repeatIndex,
            requestedModel: request.route.modelId,
            observedModel: request.route.modelId,
            deterministicGatesPassed: true,
            fixtureInputs: { "spec.md": "input" },
            gateChecks: [
              {
                checkId: "required-output-spec",
                passed: true,
                detail: "passed",
              },
            ],
            durationMs:
              request.route.modelId === candidate.modelId ? 100 : 250,
            retries: 0,
            sanitizedOutput: request.handoffArtifactDir?.includes("/incumbent/")
              ? "incumbent output"
              : request.route.modelId === candidate.modelId
                ? "candidate output"
                : "incumbent output",
          })),
      );
      const judgeComparison = vi.fn<PromotionJudgePort["judgeComparison"]>(
        overrides.judge ??
          (async (judge, packet): Promise<StructuredJudgeVerdict> => {
            const candidateOption = packet.optionA.includes("candidate output")
              ? "A"
              : "B";
            return {
              judgeBackend: judge.backend,
              judgeProvider: judge.provider,
              judgeFamily: judge.family,
              judgeModelId: judge.modelId,
              observedJudgeModel: judge.modelId,
              winner: candidateOption,
              optionARegression: false,
              optionBRegression: false,
              scores:
                candidateOption === "A"
                  ? { optionA: 95, optionB: 75 }
                  : { optionA: 75, optionB: 95 },
              citations: [
                {
                  claim: "Candidate passed gates",
                  inputRef: `input:1:${candidateOption}:0:1`,
                  outputRef: `option${candidateOption}`,
                  gateRef: `gate:1:${candidateOption}:0:1`,
                },
              ],
            };
          }),
      );
      const runner: QualificationRunnerPort & PromotionJudgePort = {
        async loadSuite() {
          return {
            repeats: 3,
            fixtures: [
              { id: "define-long-context", roles: ["define"] },
              { id: "implement-seeded-defect", roles: ["implement", "review"] },
            ],
            handoffs: [
              {
                from: "define-long-context",
                to: "implement-seeded-defect",
                planSource: "candidate",
              },
              {
                from: "define-long-context",
                to: "implement-seeded-defect",
                planSource: "fixed",
              },
            ],
          };
        },
        async computeSuiteHashes() {
          return {
            fixtureSuiteHash: "1".repeat(64),
            workflowPromptHashes: { "gwrk-specify": "2".repeat(64) },
          };
        },
        runFixtureRepeat,
        judgeComparison,
      };
      return {
        deps: { catalog, runner, store, projectRoot } satisfies ModelsCommandDeps,
        runFixtureRepeat,
        judgeComparison,
        store,
      };
    }

    it("checks the live runbook's evaluate-all then promote-all order", async () => {
      const { deps } = createSyntheticDeps(root);
      expect((await runInjectedModels(["discover"], deps)).exitCode).toBe(0);
      for (const role of ["define", "implement"]) {
        const result = await runInjectedModels(["evaluate", "--role", role,
          "--candidate", "codex:gpt-6.1-sol", "--incumbent", "claude:claude-3-7-sonnet",
          ...(role === "define" ? ["--fixed-implementer", "codex:gpt-6.1-sol"] : []),
          "--judges", "claude:claude-3-7-sonnet", "agy:gemini-2.5-pro", "--eval-id", "runbook-" + role], deps);
        expect(result.exitCode, result.stderr).toBe(0);
      }
      expect((await runInjectedModels(["promote", "--eval", "runbook-define"], deps)).exitCode).toBe(0);
      const second = await runInjectedModels(["promote", "--eval", "runbook-implement"], deps);
      expect(second.exitCode, second.stderr).toBe(0);
    });

    it("executes synthetic discover -> evaluate --role define -> promote end-to-end without live CLIs", async () => {
      const { deps, store } = createSyntheticDeps(root);

      const discover = await runInjectedModels(
        ["discover", "--format", "json"],
        deps,
      );
      expect(discover.exitCode).toBe(0);

      const evaluate = await runInjectedModels(
        [
          "evaluate",
          "--role",
          "define",
          "--candidate",
          "codex:gpt-6.1-sol",
          "--incumbent",
          "claude:claude-3-7-sonnet",
          "--fixed-implementer",
          "codex:gpt-6.1-sol",
          "--judges",
          "claude:claude-3-7-sonnet",
          "agy:gemini-2.5-pro",
          "--eval-id",
          "eval-e2e-define",
          "--format",
          "json",
        ],
        deps,
      );
      expect(evaluate.exitCode).toBe(0);

      const promote = await runInjectedModels(
        ["promote", "--eval", "eval-e2e-define", "--format", "json"],
        deps,
      );
      expect(promote.exitCode).toBe(0);
      const activeLock = await store.readRouteLock(scope);
      expect(activeLock?.document).toMatchObject({
        routes: { define: { modelId: "gpt-6.1-sol" } },
      });
    });

    it("rejects absent or alias candidates in models evaluate before dispatching fixture repeats", async () => {
      const { deps, runFixtureRepeat } = createSyntheticDeps(root);
      await runInjectedModels(["discover"], deps);

      const evaluate = await runInjectedModels(
        [
          "evaluate",
          "--role",
          "implement",
          "--candidate",
          "codex:default",
          "--incumbent",
          "claude:claude-3-7-sonnet",
          "--eval-id",
          "eval-alias",
        ],
        deps,
      );
      expect(evaluate.exitCode).toBe(1);
      expect(runFixtureRepeat).not.toHaveBeenCalled();
    });

    it.each([
      { label: "unconfigured judge policy", judgeArgs: [] },
      { label: "unavailable explicit judge", judgeArgs: ["--judges", "claude:claude-3-7-sonnet", "codex:gpt-4o"] },
    ])("rejects $label before fixture or judge inference", async ({ judgeArgs }) => {
      const { deps, runFixtureRepeat, judgeComparison } = createSyntheticDeps(root);
      await runInjectedModels(["discover"], deps);
      const result = await runInjectedModels([
        "evaluate", "--role", "implement", "--candidate", "codex:gpt-6.1-sol",
        "--incumbent", "claude:claude-3-7-sonnet", "--eval-id", "eval-judge-availability",
        ...judgeArgs,
      ], deps);
      expect(result.exitCode).toBe(1);
      expect(runFixtureRepeat).not.toHaveBeenCalled();
      expect(judgeComparison).not.toHaveBeenCalled();
    });

    it("surfaces a configuration hint when judge policy is absent and uses active pinned judges when valid", async () => {
      const { deps, store, runFixtureRepeat, judgeComparison } =
        createSyntheticDeps(root);
      const loadSuiteSpy = vi.spyOn(deps.runner, "loadSuite");
      await runInjectedModels(["discover"], deps);

      const missingPolicy = await runInjectedModels(
        [
          "evaluate",
          "--role",
          "implement",
          "--candidate",
          "codex:gpt-6.1-sol",
          "--incumbent",
          "claude:claude-3-7-sonnet",
          "--eval-id",
          "eval-missing-judge-policy",
        ],
        deps,
      );
      expect(missingPolicy.exitCode).toBe(1);
      expect(missingPolicy.stderr).toMatch(/--judges/);
      expect(missingPolicy.stderr).toMatch(/route lock/i);
      expect(loadSuiteSpy).not.toHaveBeenCalled();
      expect(runFixtureRepeat).not.toHaveBeenCalled();
      expect(judgeComparison).not.toHaveBeenCalled();

      const makeJudgePin = (judge: ModelCandidate) => ({
        role: "judge" as const,
        routeMode: "pinned" as const,
        backend: judge.backend,
        provider: judge.provider,
        family: judge.family,
        modelId: judge.modelId,
        fallbackRoutes: [],
        toolVersions: { cliVersion: "1.0.0", adapterVersion: "1.0.0" },
        evidence: {
          evaluationId: "eval-judge-pin",
          snapshotHash: "1".repeat(64),
          evaluationBundleHash: "2".repeat(64),
          fixtureSuiteHash: "3".repeat(64),
          workflowPromptHashes: { "gwrk-specify": "4".repeat(64) },
          judgeVerdictHashes: ["5".repeat(64), "6".repeat(64)] as [
            string,
            string,
          ],
        },
      });

      const lockDigest = await store.writeRouteLockAtomic(scope, {
        document: {
          schemaVersion: 1,
          workspaceId: scope.workspaceId,
          runnerProfile: scope.runnerProfile,
          updatedAt: "2026-11-18T12:00:00.000Z",
          routes: {},
          judges: [
            makeJudgePin({
              backend: "claude",
              provider: "anthropic",
              family: "claude-3-7",
              modelId: "claude-3-7-sonnet",
            }),
            makeJudgePin({
              backend: "agy",
              provider: "google",
              family: "gemini",
              modelId: "gemini-2.5-pro",
            }),
          ],
        },
        expectedIncumbentDigest: null,
      });

      const pinnedRun = await runInjectedModels(
        [
          "evaluate",
          "--role",
          "implement",
          "--candidate",
          "codex:gpt-6.1-sol",
          "--incumbent",
          "claude:claude-3-7-sonnet",
          "--eval-id",
          "eval-pinned-judges",
        ],
        deps,
      );
      expect(pinnedRun.exitCode).toBe(0);
      expect(judgeComparison).toHaveBeenCalledTimes(2);
      expect(
        judgeComparison.mock.calls.map(([judge]) => `${judge.backend}:${judge.modelId}`),
      ).toEqual(["claude:claude-3-7-sonnet", "agy:gemini-2.5-pro"]);

      runFixtureRepeat.mockClear();
      judgeComparison.mockClear();
      loadSuiteSpy.mockClear();

      await store.writeRouteLockAtomic(scope, {
        document: {
          schemaVersion: 1,
          workspaceId: scope.workspaceId,
          runnerProfile: scope.runnerProfile,
          updatedAt: "2026-11-18T12:05:00.000Z",
          routes: {},
          judges: [
            makeJudgePin({
              backend: "claude",
              provider: "anthropic",
              family: "claude-3-7",
              modelId: "claude-3-7-sonnet",
            }),
            makeJudgePin({
              backend: "codex",
              provider: "openai",
              family: "gpt-4o",
              modelId: "gpt-4o",
            }),
          ],
        },
        expectedIncumbentDigest: lockDigest,
      });

      const unavailablePinned = await runInjectedModels(
        [
          "evaluate",
          "--role",
          "implement",
          "--candidate",
          "codex:gpt-6.1-sol",
          "--incumbent",
          "claude:claude-3-7-sonnet",
          "--eval-id",
          "eval-pinned-judge-unavailable",
        ],
        deps,
      );
      expect(unavailablePinned.exitCode).toBe(1);
      expect(unavailablePinned.stderr).toMatch(/model-unavailable/);
      expect(loadSuiteSpy).not.toHaveBeenCalled();
      expect(runFixtureRepeat).not.toHaveBeenCalled();
      expect(judgeComparison).not.toHaveBeenCalled();
    });

    it("rejects dependent, alias, or unsupported-effort explicit judges before loading fixtures", async () => {
      const { deps, store, runFixtureRepeat, judgeComparison } =
        createSyntheticDeps(root);
      const loadSuiteSpy = vi.spyOn(deps.runner, "loadSuite");
      await runInjectedModels(["discover"], deps);

      const snapshot = await store.readDiscoverySnapshot(scope);
      expect(snapshot).not.toBeNull();
      if (snapshot) {
        await store.writeDiscoverySnapshot(scope, {
          ...snapshot,
          adapters: snapshot.adapters.map((adapter) =>
            adapter.backend === "claude"
              ? {
                  ...adapter,
                  models: [
                    ...adapter.models,
                    {
                      backend: "claude",
                      provider: "anthropic",
                      family: "claude-4",
                      modelId: "claude-4-opus-2026",
                      supportedEfforts: [],
                      isDefault: false,
                      hidden: false,
                    },
                  ],
                }
              : adapter,
          ),
        });
      }

      const sameProvider = await runInjectedModels(
        [
          "evaluate",
          "--role",
          "implement",
          "--candidate",
          "codex:gpt-6.1-sol",
          "--incumbent",
          "claude:claude-3-7-sonnet",
          "--judges",
          "claude:claude-3-7-sonnet",
          "claude:claude-4-opus-2026",
          "--eval-id",
          "eval-dependent-judges",
        ],
        deps,
      );
      expect(sameProvider.exitCode).toBe(1);
      expect(sameProvider.stderr).toMatch(/judge-dependence/);
      expect(loadSuiteSpy).not.toHaveBeenCalled();
      expect(runFixtureRepeat).not.toHaveBeenCalled();
      expect(judgeComparison).not.toHaveBeenCalled();

      const aliasJudge = await runInjectedModels(
        [
          "evaluate",
          "--role",
          "implement",
          "--candidate",
          "codex:gpt-6.1-sol",
          "--incumbent",
          "claude:claude-3-7-sonnet",
          "--judges",
          "claude:claude-3-7-sonnet",
          "agy:auto",
          "--eval-id",
          "eval-alias-judge",
        ],
        deps,
      );
      expect(aliasJudge.exitCode).toBe(1);
      expect(aliasJudge.stderr).toMatch(/model-alias/);
      expect(loadSuiteSpy).not.toHaveBeenCalled();
      expect(runFixtureRepeat).not.toHaveBeenCalled();
      expect(judgeComparison).not.toHaveBeenCalled();

      const unsupportedEffort = await runInjectedModels(
        [
          "evaluate",
          "--role",
          "implement",
          "--candidate",
          "codex:gpt-6.1-sol",
          "--incumbent",
          "claude:claude-3-7-sonnet",
          "--judges",
          "claude:claude-3-7-sonnet:high",
          "agy:gemini-2.5-pro",
          "--eval-id",
          "eval-effort-judge",
        ],
        deps,
      );
      expect(unsupportedEffort.exitCode).toBe(1);
      expect(unsupportedEffort.stderr).toMatch(/effort-unavailable/);
      expect(loadSuiteSpy).not.toHaveBeenCalled();
      expect(runFixtureRepeat).not.toHaveBeenCalled();
      expect(judgeComparison).not.toHaveBeenCalled();
    });

    it("rejects invalid --judges input instead of silently substituting hardcoded default judges", async () => {
      const { deps, judgeComparison } = createSyntheticDeps(root);
      await runInjectedModels(["discover"], deps);

      const evaluate = await runInjectedModels(
        [
          "evaluate",
          "--role",
          "implement",
          "--candidate",
          "codex:gpt-6.1-sol",
          "--incumbent",
          "claude:claude-3-7-sonnet",
          "--judges",
          "claude:claude-3-7-sonnet",
          "--eval-id",
          "eval-one-judge",
        ],
        deps,
      );
      expect(evaluate.exitCode).toBe(1);
      expect(judgeComparison).not.toHaveBeenCalled();
    });

    it("honors GWRK_RUNNER_PROFILE when --runner is omitted and rejects unknown --format", async () => {
      vi.stubEnv("GWRK_RUNNER_PROFILE", "linux-pilot");
      const { deps } = createSyntheticDeps(root);

      const discover = await runInjectedModels(
        ["discover", "--format", "json"],
        deps,
      );
      expect(discover.exitCode).toBe(0);
      const snapshot = JSON.parse(discover.stdout);
      expect(snapshot.scope.runnerProfile).toBe("linux-pilot");

      const badFormat = await runInjectedModels(
        ["discover", "--format", "xml"],
        deps,
      );
      expect(badFormat.exitCode).not.toBe(0);
    });

    it("executes full synthetic discover -> evaluate -> promote -> invalidation -> rollback lifecycle", async () => {
      const { deps, store } = createSyntheticDeps(root);

      const discover = await runInjectedModels(
        ["discover", "--format", "json"],
        deps,
      );
      expect(discover.exitCode).toBe(0);

      // 1. Evaluate and promote implement role so active implement pin exists
      const evalImpl = await runInjectedModels(
        [
          "evaluate",
          "--role",
          "implement",
          "--candidate",
          "codex:gpt-6.1-sol",
          "--incumbent",
          "claude:claude-3-7-sonnet",
          "--judges",
          "claude:claude-3-7-sonnet",
          "agy:gemini-2.5-pro",
          "--eval-id",
          "eval-cycle-impl",
          "--format",
          "json",
        ],
        deps,
      );
      expect(evalImpl.exitCode).toBe(0);

      const promoteImpl = await runInjectedModels(
        ["promote", "--eval", "eval-cycle-impl", "--format", "json"],
        deps,
      );
      expect(promoteImpl.exitCode).toBe(0);
      const digestAfterImpl = JSON.parse(promoteImpl.stdout).digest;

      // 2. Evaluate define role without --fixed-implementer (resolves from active implement pin)
      const evalDefine = await runInjectedModels(
        [
          "evaluate",
          "--role",
          "define",
          "--candidate",
          "codex:gpt-6.1-sol",
          "--incumbent",
          "claude:claude-3-7-sonnet",
          "--judges",
          "claude:claude-3-7-sonnet",
          "agy:gemini-2.5-pro",
          "--eval-id",
          "eval-cycle-define",
          "--format",
          "json",
        ],
        deps,
      );
      expect(evalDefine.exitCode).toBe(0);

      const promoteDefine = await runInjectedModels(
        ["promote", "--eval", "eval-cycle-define", "--format", "json"],
        deps,
      );
      expect(promoteDefine.exitCode).toBe(0);

      const lockAfterDefine = await store.readRouteLock(scope);
      expect(lockAfterDefine?.document).toMatchObject({
        routes: {
          implement: { modelId: "gpt-6.1-sol" },
          define: { modelId: "gpt-6.1-sol" },
        },
      });

      // 3. Stale snapshot invalidates a previously recorded evaluation before promotion
      const evalStale = await runInjectedModels(
        [
          "evaluate",
          "--role",
          "review",
          "--candidate",
          "codex:gpt-6.1-sol",
          "--incumbent",
          "claude:claude-3-7-sonnet",
          "--judges",
          "claude:claude-3-7-sonnet",
          "agy:gemini-2.5-pro",
          "--eval-id",
          "eval-cycle-stale",
          "--format",
          "json",
        ],
        deps,
      );
      expect(evalStale.exitCode).toBe(0);

      const currentSnap = await store.readDiscoverySnapshot(scope);
      expect(currentSnap).not.toBeNull();
      if (currentSnap) {
        await store.writeDiscoverySnapshot(scope, {
          ...currentSnap,
          adapters: currentSnap.adapters.map((a) =>
            a.backend === "codex" ? { ...a, cliVersion: "2.0.0" } : a,
          ),
        });
      }
      const stalePromote = await runInjectedModels(
        ["promote", "--eval", "eval-cycle-stale"],
        deps,
      );
      expect(stalePromote.exitCode).toBe(1);
      expect(stalePromote.stderr).toMatch(/tools-changed/);

      // 4. Roll back to the prior lock (restoring implement-only lock)
      const rollback = await runInjectedModels(
        ["promote", "--rollback", "--format", "json"],
        deps,
      );
      expect(rollback.exitCode).toBe(0);
      const lockAfterRollback = await store.readRouteLock(scope);
      expect(lockAfterRollback?.digest).toBe(digestAfterImpl);
      expect(
        (lockAfterRollback?.document as { routes: Record<string, unknown> })
          .routes.define,
      ).toBeUndefined();
    });

    it("inherits global --format and --workspace options via optsWithGlobals and rejects malformed --judges or --format", async () => {
      const { deps, judgeComparison } = createSyntheticDeps(root);

      let stdout = "";
      let stderr = "";
      const outputScope = {
        agentMode: false,
        exitCode: 0,
        stdout: (chunk: string) => {
          stdout += chunk;
        },
        stderr: (chunk: string) => {
          stderr += chunk;
        },
      };
      const rootProgram = new Command("gwrk")
        .option("--format <type>", "Output format (json)")
        .option("--workspace <name>", "Workspace profile")
        .addCommand(createModelsCommand(deps));
      rootProgram.exitOverride();
      for (const cmd of rootProgram.commands) {
        cmd.exitOverride();
        for (const sub of cmd.commands) sub.exitOverride();
      }

      await runWithOutputScope(outputScope, async () => {
        await rootProgram.parseAsync(
          ["--format", "json", "--workspace", "custom-ws", "models", "discover"],
          { from: "user" },
        );
      });
      expect(outputScope.exitCode).toBe(0);
      expect(stderr).toMatch(/\[exit:0 \| [^\]]+\]/);
      const parsed = JSON.parse(stdout);
      expect(parsed.scope.workspaceId).toBe("custom-ws");

      await runInjectedModels(["discover"], deps);
      const malformedJudges = await runInjectedModels(
        [
          "evaluate",
          "--role",
          "implement",
          "--candidate",
          "codex:gpt-6.1-sol",
          "--incumbent",
          "claude:claude-3-7-sonnet",
          "--judges",
          "claude:claude-3-7-sonnet",
          "not-a-valid-route",
          "--eval-id",
          "eval-malformed-judges",
        ],
        deps,
      );
      expect(malformedJudges.exitCode).toBe(1);
      expect(judgeComparison).not.toHaveBeenCalled();

      const badPromoteFormat = await runInjectedModels(
        ["promote", "--rollback", "--format", "yaml"],
        deps,
      );
      expect(badPromoteFormat.exitCode).not.toBe(0);
    });
  });
});
