/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtureRunner } from "../adapters/models/fixture-runner.js";
import { createRouteLockStore } from "../adapters/models/route-lock-store.js";
import { runCli } from "../cli.js";
import type {
  DiscoverySnapshot,
  ModelCandidate,
  RunnerScope,
} from "../domain/model-qualification.js";

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
    const { exitCode, stdout, stderr } = await executeCli([
      "models",
      "discover",
      "--format",
      "json",
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/\[exit:0 \| [^\]]+\]/);

    const snapshot = JSON.parse(stdout);
    expect(snapshot.scope.runnerProfile).toBe("local");
    expect(Array.isArray(snapshot.adapters)).toBe(true);

    const store = createRouteLockStore(root);
    const persisted = await store.readDiscoverySnapshot(scope);
    expect(persisted).not.toBeNull();
  });

  it("TR-012: promotes passing candidate and records active lock and digest", async () => {
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
      suiteHashes,
      judgeVerdictHashes: [
        createHash("sha256").update(JSON.stringify(verdict1)).digest("hex"),
        createHash("sha256").update(JSON.stringify(verdict2)).digest("hex"),
      ],
      promotionEvidence: {
        candidateOption: "A",
        requiredFixtures: ["define-long-context"],
        repeats: [
          { fixtureId: "define-long-context", repeatIndex: 0, gatesPassed: true },
          { fixtureId: "define-long-context", repeatIndex: 1, gatesPassed: true },
          { fixtureId: "define-long-context", repeatIndex: 2, gatesPassed: true },
        ],
        judges: [verdict1, verdict2],
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
});
