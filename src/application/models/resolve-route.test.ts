/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FixtureRunner } from "../../adapters/models/fixture-runner.js";
import { runCli } from "../../cli.js";
import { implementAction } from "../../commands/implement.js";
import { researchCommandHandler } from "../../commands/research.js";
import * as runLedger from "../../db/runs.js";
import {
  type DiscoverySnapshot,
  type RunnerScope,
  eligibleRoutesDigest,
} from "../../domain/model-qualification.js";
import { PlanStore } from "../../engine/plan-store.js";
import { resolveWorkspacePolicyRoots } from "../../engine/profile-detector.js";
import { resolveEnforcementSkills } from "../../plugins/skill-runtime.js";
import { WorkflowRuntime } from "../../plugins/workflow-runtime.js";
import type { RouteLockStorePort } from "../../ports/model-qualification-port.js";
import * as agentTransport from "../../utils/agent.js";
import type { TaskDispatch, TaskResult } from "../../utils/agent.js";
import { loadManifests } from "../../utils/manifest.js";
import { resolveAgent, resolveRoleAgent } from "../../utils/resolve-agent.js";
import { loadTaskState, saveTaskState } from "../../utils/state.js";
import type { PromotionReplayEvidence } from "./evaluate-models.js";
import type { PinnedRoleRoute, RouteLockDocument } from "./promote-model.js";
import {
  type FallbackQualificationRecord,
  formatRoutePreflightBanner,
  resolveQualifiedRoute,
  resolveQualifiedRouteFromStore,
} from "./resolve-route.js";

const SCOPE: RunnerScope = {
  workspaceId: "gwrk",
  runnerProfile: "local",
  platform: process.platform,
  arch: process.arch,
};

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);

function makeSnapshot(
  overrides: Partial<DiscoverySnapshot> = {},
): DiscoverySnapshot {
  return {
    scope: SCOPE,
    adapters: [
      {
        backend: "codex",
        status: "available",
        cliVersion: "0.167.0",
        adapterVersion: "1.0.0",
        supportsModelForwarding: true,
        models: [
          {
            backend: "codex",
            provider: "openai",
            family: "gpt-6",
            modelId: "gpt-6.1-sol",
            supportedEfforts: ["low", "medium", "high"],
            isDefault: true,
            hidden: false,
          },
          {
            backend: "codex",
            provider: "openai",
            family: "gpt-6",
            modelId: "gpt-6.1-terra",
            supportedEfforts: ["medium", "high"],
            isDefault: false,
            hidden: false,
          },
        ],
      },
      {
        backend: "claude",
        status: "available",
        cliVersion: "2.1.322",
        adapterVersion: "1.0.0",
        supportsModelForwarding: true,
        models: [
          {
            backend: "claude",
            provider: "anthropic",
            family: "claude-4",
            modelId: "claude-opus-4-6",
            supportedEfforts: ["medium", "high"],
            isDefault: false,
            hidden: false,
          },
          {
            backend: "claude",
            provider: "anthropic",
            family: "claude-4",
            modelId: "claude-sonnet-4-6",
            supportedEfforts: ["low", "medium"],
            isDefault: true,
            hidden: false,
          },
        ],
      },
      {
        backend: "agy",
        status: "available",
        cliVersion: "1.5.5",
        adapterVersion: "1.0.0",
        supportsModelForwarding: true,
        models: [
          {
            backend: "agy",
            provider: "google",
            family: "gemini-4",
            modelId: "gemini-4-carbon",
            supportedEfforts: ["medium", "high"],
            isDefault: false,
            hidden: false,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function fallbackFingerprints(
  backend: string,
  suiteHashes: {
    fixtureSuiteHash: string;
    workflowPromptHashes: Record<string, string>;
  },
) {
  const snapshot = makeSnapshot();
  const adapter = snapshot.adapters.find(
    (report) => report.backend === backend,
  )!;
  return {
    suiteHashes,
    snapshotHash: createHash("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex"),
    eligibleRoutesDigest: eligibleRoutesDigest(snapshot, SCOPE),
    toolVersions: {
      cliVersion: adapter.cliVersion,
      adapterVersion: adapter.adapterVersion,
    },
  };
}

function makePin(overrides: Partial<PinnedRoleRoute> = {}): PinnedRoleRoute {
  return {
    role: "define",
    routeMode: "pinned",
    backend: "codex",
    provider: "openai",
    family: "gpt-6",
    modelId: "gpt-6.1-sol",
    effort: "high",
    fallbackRoutes: [
      {
        backend: "claude",
        provider: "anthropic",
        family: "claude-4",
        modelId: "claude-opus-4-6",
        effort: "high",
        evaluationId: "eval-claude-define-1",
      },
      {
        backend: "agy",
        provider: "google",
        family: "gemini-4",
        modelId: "gemini-4-carbon",
        effort: "medium",
        evaluationId: "eval-agy-define-unverified",
      },
    ],
    toolVersions: {
      cliVersion: "0.167.0",
      adapterVersion: "1.0.0",
    },
    evidence: {
      evaluationId: "eval-codex-define-1",
      snapshotHash: HASH_A,
      evaluationBundleHash: HASH_B,
      fixtureSuiteHash: HASH_C,
      workflowPromptHashes: {
        "gwrk-specify": HASH_D,
        "gwrk-plan": HASH_E,
      },
      judgeVerdictHashes: [HASH_A, HASH_B],
    },
    ...overrides,
  };
}

function makeRouteLock(
  pinOverrides: Partial<PinnedRoleRoute> = {},
  docOverrides: Partial<RouteLockDocument> = {},
): RouteLockDocument {
  return {
    schemaVersion: 1,
    workspaceId: SCOPE.workspaceId,
    runnerProfile: SCOPE.runnerProfile,
    updatedAt: "2026-11-23T00:00:00.000Z",
    routes: {
      define: makePin(pinOverrides),
    },
    ...docOverrides,
  };
}

function makePassingPromotionEvidence(): PromotionReplayEvidence {
  return {
    candidateOption: "A",
    requiredFixtures: ["define-long-context"],
    repeats: [
      { fixtureId: "define-long-context", repeatIndex: 0, gatesPassed: true },
      { fixtureId: "define-long-context", repeatIndex: 1, gatesPassed: true },
      { fixtureId: "define-long-context", repeatIndex: 2, gatesPassed: true },
    ],
    judges: [
      {
        judgeBackend: "claude",
        judgeProvider: "anthropic",
        judgeFamily: "claude-4",
        judgeModelId: "claude-opus-4-6",
        observedJudgeModel: "claude-opus-4-6",
        winner: "A",
        optionARegression: false,
        optionBRegression: false,
        scores: { optionA: 92, optionB: 84 },
        citations: [
          {
            inputRef: "input-1",
            outputRef: "output-1",
            gateRef: "gate-1",
            claim: "Candidate satisfied all acceptance checks.",
          },
        ],
      },
      {
        judgeBackend: "agy",
        judgeProvider: "google",
        judgeFamily: "gemini-4",
        judgeModelId: "gemini-4-carbon",
        observedJudgeModel: "gemini-4-carbon",
        winner: "A",
        optionARegression: false,
        optionBRegression: false,
        scores: { optionA: 91, optionB: 82 },
        citations: [
          {
            inputRef: "input-1",
            outputRef: "output-1",
            gateRef: "gate-1",
            claim: "Candidate plan passed deterministic gates.",
          },
        ],
      },
    ],
    refs: {
      input: ["input-1"],
      output: ["output-1"],
      gate: ["gate-1"],
    },
  };
}

const tempDirs: string[] = [];

function createTempProject(config: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-resolve-route-"));
  tempDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, ".gwrkrc.json"),
    JSON.stringify(config, null, 2),
    "utf8",
  );
  return dir;
}

async function projectEvidence(root: string) {
  const fixturesDir = path.join(root, "tests/fixtures/model-qualification");
  fs.cpSync(path.resolve("tests/fixtures/model-qualification"), fixturesDir, {
    recursive: true,
  });
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
  try {
    const current = await new FixtureRunner({
      fixturesDir,
    }).computeSuiteHashes();
    const snapshot = makeSnapshot();
    const catalog = path.join(root, ".runs/models/discovery/local.json");
    fs.mkdirSync(path.dirname(catalog), { recursive: true });
    fs.writeFileSync(catalog, JSON.stringify(snapshot));
    return {
      ...makePin().evidence,
      ...current,
      snapshotHash: createHash("sha256")
        .update(JSON.stringify(snapshot))
        .digest("hex"),
    };
  } finally {
    cwd.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("TR-014: resolveQualifiedRoute", () => {
  it("selects the pinned model, effort and qualified fallback chain for a fresh lock", () => {
    const snapshot = makeSnapshot();
    const lock = makeRouteLock();
    const qualifiedFallbacks: FallbackQualificationRecord[] = [
      {
        evaluationId: "eval-claude-define-1",
        role: "define",
        scope: SCOPE,
        backend: "claude",
        provider: "anthropic",
        family: "claude-4",
        modelId: "claude-opus-4-6",
        effort: "high",
        passed: true,
      },
      {
        // Failed evaluation must not be admitted to fallbackRoutes.
        evaluationId: "eval-agy-define-unverified",
        role: "define",
        scope: SCOPE,
        backend: "agy",
        provider: "google",
        family: "gemini-4",
        modelId: "gemini-4-carbon",
        effort: "medium",
        passed: false,
      },
    ];

    const route = resolveQualifiedRoute({
      role: "define",
      scope: SCOPE,
      routeLock: lock,
      snapshot,
      currentSuiteHashes: {
        fixtureSuiteHash: HASH_C,
        workflowPromptHashes: {
          "gwrk-specify": HASH_D,
          "gwrk-plan": HASH_E,
        },
      },
      pinnedEligibleRoutesDigest: eligibleRoutesDigest(snapshot, SCOPE),
      qualifiedFallbacks,
    });

    expect(route.status).toBe("pinned");
    expect(route.routeMode).toBe("pinned");
    expect(route.backend).toBe("codex");
    expect(route.model).toBe("gpt-6.1-sol");
    expect(route.effort).toBe("high");
    expect(route.usedFallback).toBe(false);
    expect(route.fallbackRoutes).toHaveLength(1);
    expect(route.fallbackRoutes[0]?.evaluationId).toBe("eval-claude-define-1");

    const banner = formatRoutePreflightBanner(route);
    expect(banner).toContain("Route [define]");
    expect(banner).toContain("codex / gpt-6.1-sol");
    expect(banner).toContain("effort=high");
    expect(banner).toContain("mode=pinned");
    expect(banner).toContain("fallback=claude/claude-opus-4-6:high");
  });

  it("restricts fallbacks to qualified pins for the same role and runner profile", () => {
    const snapshot = makeSnapshot();
    const lock = makeRouteLock();
    const qualifiedFallbacks: FallbackQualificationRecord[] = [
      {
        // Wrong role: implement instead of define
        evaluationId: "eval-claude-define-1",
        role: "implement",
        scope: SCOPE,
        backend: "claude",
        provider: "anthropic",
        family: "claude-4",
        modelId: "claude-opus-4-6",
        effort: "high",
        passed: true,
      },
      {
        // Wrong runner profile: linux-pilot instead of local
        evaluationId: "eval-agy-define-unverified",
        role: "define",
        scope: { ...SCOPE, runnerProfile: "linux-pilot" },
        backend: "agy",
        provider: "google",
        family: "gemini-4",
        modelId: "gemini-4-carbon",
        effort: "medium",
        passed: true,
      },
    ];

    const rejected = resolveQualifiedRoute({
      role: "define",
      scope: SCOPE,
      routeLock: lock,
      currentSuiteHashes: makePin().evidence,
      snapshot,
      unavailableBackends: ["codex"],
      primaryFailureReason: "rate_limit",
      qualifiedFallbacks,
    });

    expect(rejected.status).toBe("unavailable_pin");
    expect(rejected.model).toBeUndefined();
    expect(rejected.fallbackReason).toBe("rate_limit");
    expect(rejected.fallbackRoutes).toEqual([]);

    const admitted = resolveQualifiedRoute({
      role: "define",
      scope: SCOPE,
      routeLock: lock,
      currentSuiteHashes: makePin().evidence,
      snapshot,
      unavailableBackends: ["codex"],
      primaryFailureReason: "rate_limit",
      qualifiedFallbacks: [
        {
          evaluationId: "eval-claude-define-1",
          role: "define",
          scope: SCOPE,
          backend: "claude",
          provider: "anthropic",
          family: "claude-4",
          modelId: "claude-opus-4-6",
          effort: "high",
          passed: true,
        },
      ],
    });

    expect(admitted.status).toBe("pinned");
    expect(admitted.backend).toBe("claude");
    expect(admitted.model).toBe("claude-opus-4-6");
    expect(admitted.effort).toBe("high");
    expect(admitted.usedFallback).toBe(true);
    expect(admitted.fallbackReason).toBe("rate_limit");
    expect(formatRoutePreflightBanner(admitted)).toContain(
      "fallback=rate_limit",
    );
  });

  it("reports unavailable_pin when an explicit backend lacks a qualified pin for the role", () => {
    const snapshot = makeSnapshot();
    const lock = makeRouteLock({
      fallbackRoutes: [
        {
          backend: "claude",
          provider: "anthropic",
          family: "claude-4",
          modelId: "claude-opus-4-6",
          effort: "high",
          evaluationId: "eval-claude-define-1",
        },
      ],
    });

    const missingBackend = resolveQualifiedRoute({
      role: "define",
      scope: SCOPE,
      routeLock: lock,
      currentSuiteHashes: makePin().evidence,
      snapshot,
      requestedBackend: "agy",
      qualifiedFallbacks: [
        {
          evaluationId: "eval-claude-define-1",
          role: "define",
          scope: SCOPE,
          backend: "claude",
          provider: "anthropic",
          family: "claude-4",
          modelId: "claude-opus-4-6",
          effort: "high",
          passed: true,
        },
      ],
    });

    expect(missingBackend.status).toBe("unavailable_pin");
    expect(missingBackend.backend).toBe("agy");
    expect(missingBackend.model).toBeUndefined();
    expect(missingBackend.fallbackReason).toBe("unavailable_pin");
    expect(missingBackend.diagnostic).toContain("agy");
    expect(missingBackend.diagnostic).toContain("define");

    const qualifiedExplicit = resolveQualifiedRoute({
      role: "define",
      scope: SCOPE,
      routeLock: lock,
      currentSuiteHashes: makePin().evidence,
      snapshot,
      requestedBackend: "claude",
      qualifiedFallbacks: [
        {
          evaluationId: "eval-claude-define-1",
          role: "define",
          scope: SCOPE,
          backend: "claude",
          provider: "anthropic",
          family: "claude-4",
          modelId: "claude-opus-4-6",
          effort: "high",
          passed: true,
        },
      ],
    });

    expect(qualifiedExplicit.status).toBe("pinned");
    expect(qualifiedExplicit.backend).toBe("claude");
    expect(qualifiedExplicit.model).toBe("claude-opus-4-6");
    expect(qualifiedExplicit.usedFallback).toBe(true);
    expect(qualifiedExplicit.fallbackReason).toBe("explicit_backend_pin");
  });

  it("honors explicit provider-default mode even when the route lock is stale", () => {
    const lock = makeRouteLock();
    const route = resolveQualifiedRoute({
      role: "define",
      scope: SCOPE,
      routeLock: lock,
      snapshot: makeSnapshot({ adapters: [] }),
      currentSuiteHashes: {
        fixtureSuiteHash: "f".repeat(64),
        workflowPromptHashes: { "gwrk-specify": "0".repeat(64) },
      },
      routeMode: "provider-default",
      requestedBackend: "claude",
    });

    expect(route.status).toBe("provider-default");
    expect(route.routeMode).toBe("provider-default");
    expect(route.backend).toBe("claude");
    expect(route.model).toBeUndefined();
    expect(route.requestedModel).toBe("provider-default");
    expect(route.stalenessReasons).toEqual([]);
    expect(formatRoutePreflightBanner(route)).toContain(
      "claude / provider-default (mode=provider-default)",
    );
  });

  it("marks pinned routes stale when prompts, fixtures, tools, eligible models or availability change", () => {
    const snapshot = makeSnapshot();
    const lock = makeRouteLock();
    const changed = resolveQualifiedRoute({
      role: "define",
      scope: SCOPE,
      routeLock: lock,
      snapshot: makeSnapshot({
        adapters: [
          {
            backend: "codex",
            status: "available",
            cliVersion: "0.168.0",
            adapterVersion: "1.0.0",
            supportsModelForwarding: true,
            models: [
              {
                backend: "codex",
                provider: "openai",
                family: "gpt-6",
                modelId: "gpt-6.1-terra",
                supportedEfforts: ["medium"],
                isDefault: true,
                hidden: false,
              },
            ],
          },
        ],
      }),
      currentSuiteHashes: {
        fixtureSuiteHash: "1".repeat(64),
        workflowPromptHashes: {
          "gwrk-specify": "2".repeat(64),
          "gwrk-plan": HASH_E,
        },
      },
      pinnedEligibleRoutesDigest: eligibleRoutesDigest(snapshot, SCOPE),
    });

    expect(changed.status).toBe("stale");
    expect(changed.model).toBeUndefined();
    expect(changed.fallbackReason).toBe("stale_pin");
    expect(changed.stalenessReasons).toEqual(
      expect.arrayContaining([
        "fixtures-changed",
        "prompts-changed",
        "tools-changed",
        "eligible-models-changed",
        "model-unavailable",
      ]),
    );
  });

  it("replays fallback evaluation bundles from RouteLockStorePort before admitting fallbacks", async () => {
    const snapshot = makeSnapshot();
    const lock = makeRouteLock();
    const bundles = new Map<string, unknown>([
      [
        "eval-codex-define-1",
        {
          evaluationId: "eval-codex-define-1",
          role: "define",
          scope: SCOPE,
          eligibleRoutesDigest: eligibleRoutesDigest(snapshot, SCOPE),
        },
      ],
      [
        "eval-claude-define-1",
        {
          evaluationId: "eval-claude-define-1",
          role: "define",
          scope: SCOPE,
          candidate: {
            backend: "claude",
            provider: "anthropic",
            family: "claude-4",
            modelId: "claude-opus-4-6",
            effort: "high",
          },
          decision: { promote: true },
          ...fallbackFingerprints("claude", makePin().evidence),
          promotionEvidence: makePassingPromotionEvidence(),
        },
      ],
      [
        "eval-agy-define-unverified",
        {
          evaluationId: "eval-agy-define-unverified",
          role: "define",
          scope: SCOPE,
          candidate: {
            backend: "agy",
            provider: "google",
            family: "gemini-4",
            modelId: "gemini-4-carbon",
            effort: "medium",
          },
          decision: { promote: true },
          ...fallbackFingerprints("agy", makePin().evidence),
          promotionEvidence: {
            ...makePassingPromotionEvidence(),
            repeats: [
              {
                fixtureId: "define-long-context",
                repeatIndex: 0,
                gatesPassed: false,
              },
            ],
          },
        },
      ],
    ]);

    const store: RouteLockStorePort = {
      async writeDiscoverySnapshot() {
        return "";
      },
      async readDiscoverySnapshot() {
        return snapshot;
      },
      async writeEvaluationBundle() {
        return "";
      },
      async readEvaluationBundle(id) {
        if (!bundles.has(id)) throw new Error("not found");
        return bundles.get(id);
      },
      async readRouteLock() {
        return { digest: HASH_A, document: lock };
      },
      async writeRouteLockAtomic() {
        return HASH_B;
      },
    };

    const route = await resolveQualifiedRouteFromStore(
      {
        store,
        runner: {
          async computeSuiteHashes() {
            return {
              fixtureSuiteHash: HASH_C,
              workflowPromptHashes: {
                "gwrk-specify": HASH_D,
                "gwrk-plan": HASH_E,
              },
            };
          },
        },
      },
      {
        role: "define",
        scope: SCOPE,
        unavailableBackends: ["codex"],
        primaryFailureReason: "rate_limit",
      },
    );

    expect(route.status).toBe("pinned");
    expect(route.backend).toBe("claude");
    expect(route.model).toBe("claude-opus-4-6");
    expect(route.effort).toBe("high");
    expect(route.usedFallback).toBe(true);
    expect(route.fallbackReason).toBe("rate_limit");
    expect(route.fallbackRoutes).toEqual([]);
  });

  it.each([
    "rejected",
    "expired",
    "outdated prompts",
    "outdated catalog",
    "outdated snapshot",
    "outdated tools",
  ] as const)(
    "refuses a fallback whose evaluation is %s even when both judges favored it",
    async (condition) => {
      const root = createTempProject({ project: { name: "gwrk" } });
      const role = "implement";
      const evidence = await projectEvidence(root);
      const fallback = makePin().fallbackRoutes[0];
      const pin = makePin({ role, evidence, fallbackRoutes: [fallback] });
      const bundleDir = path.join(
        root,
        ".runs/models/evaluations",
        fallback.evaluationId,
      );
      fs.mkdirSync(bundleDir, { recursive: true });
      const bundlePath = path.join(bundleDir, "bundle.json");
      const fingerprints = fallbackFingerprints(fallback.backend, evidence);
      const passing = {
        ...fingerprints,
        evaluationId: fallback.evaluationId,
        scope: SCOPE,
        role,
        candidate: fallback,
        decision: { promote: true },
        promotionEvidence: makePassingPromotionEvidence(),
      };
      const lock = makeRouteLock({}, { routes: { implement: pin } });
      const resolveFallback = () =>
        resolveAgent("implement", root, {
          agent: fallback.backend,
          routeLock: lock,
        });
      fs.writeFileSync(bundlePath, JSON.stringify(passing));
      expect(resolveFallback().model).toBe(fallback.modelId);
      const changes = {
        rejected: {
          decision: { promote: false, reason: "implementation-not-faster" },
        },
        expired: { suiteHashes: { ...evidence, fixtureSuiteHash: HASH_A } },
        "outdated prompts": {
          suiteHashes: { ...evidence, workflowPromptHashes: {} },
        },
        "outdated catalog": { eligibleRoutesDigest: HASH_A },
        "outdated snapshot": { snapshotHash: HASH_A },
        "outdated tools": {
          toolVersions: {
            ...fingerprints.toolVersions,
            cliVersion: "obsolete",
          },
        },
      };
      fs.writeFileSync(
        bundlePath,
        JSON.stringify({ ...passing, ...changes[condition] }),
      );
      expect(resolveFallback).toThrow(/unavailable|stale|qualif/i);
    },
  );

  it("requires requalification when the selected project enforcement skill changes", async () => {
    const root = createTempProject({ project: { name: "gwrk" } });
    const pack = path.join(root, ".gwrk/plugins/skills/review-fixture-policy");
    fs.mkdirSync(pack, { recursive: true });
    fs.writeFileSync(
      path.join(pack, "manifest.yaml"),
      JSON.stringify({
        type: "skill",
        tier: "enforcement",
        name: "review-fixture-policy",
        version: "1.0.0",
        description: "Test policy",
        scope: "define",
      }),
    );
    const body = path.join(pack, "SKILL.md");
    fs.writeFileSync(body, "Include the original acceptance criterion.");
    expect(await resolveEnforcementSkills(root, "define")).toContain(
      "original acceptance criterion",
    );
    const evidence = await projectEvidence(root);
    const pinFile = path.join(root, ".gwrk/models/route-lock.local.json");
    fs.mkdirSync(path.dirname(pinFile), { recursive: true });
    fs.writeFileSync(pinFile, JSON.stringify(makeRouteLock({ evidence })));
    expect(resolveAgent("define", root).model).toBe(makePin().modelId);
    fs.writeFileSync(body, "Include the revised acceptance criterion.");
    expect(await resolveEnforcementSkills(root, "define")).toContain(
      "revised acceptance criterion",
    );
    expect(() => resolveAgent("define", root)).toThrow(/stale|requalif/i);
  });

  it("rejects an unsupported route lock version before workflow dispatch", async () => {
    const root = createTempProject({ project: { name: "gwrk" } });
    const evidence = await projectEvidence(root);
    const lock = path.join(root, ".gwrk/models/route-lock.local.json");
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(
      lock,
      JSON.stringify({ ...makeRouteLock({ evidence }), schemaVersion: 2 }),
    );
    const dispatch = vi
      .fn()
      .mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, durationS: 0 });
    await expect(
      new WorkflowRuntime().executeWorkflow("gwrk-specify", "Specify", {
        nativeOnly: true,
        projectRoot: root,
        dispatcher: dispatch,
      }),
    ).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("passes provider-default mode to the backend in a project without a pin or a model override", async () => {
    const root = createTempProject({ project: { name: "gwrk" } });
    const dispatch = vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      durationS: 0,
    });
    await new WorkflowRuntime().executeWorkflow("gwrk-implement", "Implement", {
      nativeOnly: true,
      agent: "codex",
      projectRoot: root,
      dispatcher: dispatch,
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        routeMode: "provider-default",
        model: undefined,
      }),
    );
  });

  it("accepts explicit provider default on define spec with an unreadable lock", async () => {
    const root = createTempProject({ project: { name: "gwrk" } });
    const feature = "001-qualification";
    fs.mkdirSync(path.join(root, "specs", feature), { recursive: true });
    fs.mkdirSync(path.join(root, ".gwrk/models/route-lock.local.json"), {
      recursive: true,
    });
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const dispatch = vi.spyOn(agentTransport, "dispatchToAgent");
    const errors: string[] = [];
    const code = await runCli(
      [
        "define",
        "spec",
        feature,
        "Write a specification",
        "--route",
        "provider-default",
        "--dry-run",
      ],
      { stderr: (chunk) => errors.push(chunk) },
    );
    expect(code, errors.join("")).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("requires current hashes before declaring a lock fresh", () => {
    const route = resolveQualifiedRoute({
      role: "define",
      scope: SCOPE,
      routeLock: makeRouteLock(),
      snapshot: makeSnapshot(),
    });
    expect(route.status).toBe("stale");
    expect(route.model).toBeUndefined();
  });

  it("stops callers before dispatch on an unavailable backend or stale evidence", () => {
    const root = createTempProject({ project: { name: "gwrk" } });
    const routeLock = makeRouteLock();
    const inputs = {
      routeLock,
      snapshot: makeSnapshot(),
      currentSuiteHashes: makePin().evidence,
      runnerProfile: "local",
    };
    for (const overrides of [
      { agent: "agy" },
      { agent: "claude" },
      { model: "never-evaluated" },
      { effort: "low" },
      { snapshot: null },
      {
        currentSuiteHashes: {
          fixtureSuiteHash: HASH_A,
          workflowPromptHashes: {},
        },
      },
    ]) {
      expect(() =>
        resolveAgent("define", root, { ...inputs, ...overrides }),
      ).toThrow(/unavailable_pin|stale|requalif/i);
    }
  });

  it("treats an unreadable lock as an error and allows explicit provider default", () => {
    const root = createTempProject({ project: { name: "gwrk" } });
    const lock = path.join(root, ".gwrk/models/route-lock.local.json");
    fs.mkdirSync(lock, { recursive: true });
    expect(() =>
      resolveAgent("define", root, { runnerProfile: "local" }),
    ).toThrow();
    expect(
      resolveAgent("define", root, {
        runnerProfile: "local",
        routeMode: "provider-default",
        agent: "codex",
      }),
    ).toMatchObject({
      backend: "codex",
      routeMode: "provider-default",
      model: undefined,
    });
  });

  it("dispatches a qualified research command and rejects later project changes", async () => {
    const root = createTempProject({
      project: { name: "gwrk" },
      agents: { define: "codex", implement: "codex" },
    });
    const evidence = await projectEvidence(root);
    const pin = makePin({ evidence });
    const file = path.join(root, ".gwrk/models/route-lock.local.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(makeRouteLock({ evidence })));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
    const dispatch = vi
      .spyOn(agentTransport, "dispatchToAgent")
      .mockResolvedValue({
        exitCode: 0,
        stdout: '{"summary":"done","intents":[]}',
        stderr: "",
        durationS: 0,
        observedModel: "observed-id",
      });
    await researchCommandHandler({ initiative: "qualification", run: true });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        model: pin.modelId,
        effort: "high",
        routeMode: "pinned",
      }),
    );
    cwd.mockRestore();
    fs.writeFileSync(
      path.join(root, ".gwrk/architecture.md"),
      "New architecture",
    );
    expect(() => resolveAgent("define", root)).toThrow(/prompts-changed/);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("dispatches an implementation task using its runner's qualified route", async () => {
    const root = createTempProject({ project: { name: "gwrk" } });
    const feature = "001-qualification";
    const featureDir = path.join(root, "specs", feature);
    const task = {
      id: "T001",
      title: "Implement routing",
      description: "Use the pinned route",
      status: "open" as const,
      gateScript: "gates/T001-gate.sh",
      sp: 1,
    };
    saveTaskState(featureDir, {
      featureId: feature,
      createdAt: new Date().toISOString(),
      phases: [
        { id: "phase-01", title: "Routing", tasks: [task], sp_estimate: 1 },
      ],
    });
    const gates = path.join(featureDir, "gates");
    fs.mkdirSync(gates);
    fs.writeFileSync(
      path.join(featureDir, task.gateScript),
      '#!/bin/sh\ngrep -qx qualified "$0.output"\n',
      { mode: 0o755 },
    );
    const evidence = await projectEvidence(root);
    const pin = makePin({ role: "implement", evidence, fallbackRoutes: [] });
    const lock = path.join(root, ".gwrk/models/route-lock.local.json");
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(
      lock,
      JSON.stringify(makeRouteLock({}, { routes: { implement: pin } })),
    );
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(runLedger, "startRun").mockReturnValue(1);
    vi.spyOn(runLedger, "finishRun").mockImplementation(() => {});
    vi.spyOn(runLedger, "recordHistory").mockReturnValue(1);
    const dispatch = vi
      .spyOn(agentTransport, "dispatchToAgent")
      .mockImplementation(async () => {
        fs.writeFileSync(
          path.join(featureDir, `${task.gateScript}.output`),
          "qualified\n",
        );
        return {
          exitCode: 0,
          stdout: '{"summary":"done","intents":[]}',
          stderr: "",
          durationS: 0,
        };
      });
    await implementAction(feature, "1", {});
    expect(loadTaskState(featureDir).phases[0].tasks[0].status).toBe(
      "completed",
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: "gwrk-implement",
        agent: pin.backend,
        model: pin.modelId,
        effort: pin.effort,
        routeMode: "pinned",
        stdin: expect.stringContaining(task.id),
      }),
    );
  });

  it("expires a workspace pin after its inherited architecture instructions change", async () => {
    const owner = createTempProject({
      project: { name: "owner" },
      workspaces: { "packages/api": { type: "nodejs" } },
    });
    const root = path.join(owner, "packages/api");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "gwrk" } }),
    );
    fs.mkdirSync(path.join(owner, ".gwrk"), { recursive: true });
    const architecture = path.join(owner, ".gwrk/architecture.md");
    fs.writeFileSync(architecture, "Original architecture instructions");
    expect(resolveWorkspacePolicyRoots(root).policyDirs).toContain(
      fs.realpathSync(owner),
    );
    const evidence = await projectEvidence(root);
    const lock = path.join(root, ".gwrk/models/route-lock.local.json");
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, JSON.stringify(makeRouteLock({ evidence })));
    expect(resolveAgent("define", root).model).toBe("gpt-6.1-sol");
    fs.writeFileSync(architecture, "Revised architecture instructions");
    expect(() => resolveAgent("define", root)).toThrow(/prompts-changed/);
  });

  it("honors the provider-default CLI escape with an unreadable pin", async () => {
    const root = createTempProject({
      project: { name: "gwrk" },
      agents: { define: "codex", implement: "codex" },
    });
    fs.mkdirSync(path.join(root, ".gwrk/models/route-lock.local.json"), {
      recursive: true,
    });
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const dispatch = vi
      .spyOn(agentTransport, "dispatchToAgent")
      .mockResolvedValue({
        exitCode: 0,
        stdout: '{"summary":"done","intents":[]}',
        stderr: "",
        durationS: 0,
      });
    const errors: string[] = [];
    const code = await runCli(
      [
        "define",
        "research",
        "qualification",
        "--run",
        "--route",
        "provider-default",
      ],
      {
        stderr: (chunk) => errors.push(chunk),
      },
    );
    expect(code, errors.join("")).toBe(0);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        model: undefined,
        routeMode: "provider-default",
      }),
    );
  });

  it.each(["pinned", "provider-default"] as const)(
    "persists the identities and mode of a %s define spec dispatch",
    async (mode) => {
      const root = createTempProject({
        project: { name: "gwrk" },
        agents: { define: "codex", implement: "codex" },
      });
      vi.stubEnv("GIT_DIR", path.join(root, "unused.git"));
      const feature = "001-qualification";
      const featureDir = path.join(root, "specs", feature);
      fs.mkdirSync(featureDir, { recursive: true });
      if (mode === "pinned") {
        const evidence = await projectEvidence(root);
        const lock = path.join(root, ".gwrk/models/route-lock.local.json");
        fs.mkdirSync(path.dirname(lock), { recursive: true });
        fs.writeFileSync(lock, JSON.stringify(makeRouteLock({ evidence })));
      }
      vi.spyOn(process, "cwd").mockReturnValue(root);
      vi.spyOn(runLedger, "startRun").mockReturnValue(1);
      vi.spyOn(runLedger, "finishRun").mockImplementation(() => {});
      vi.spyOn(PlanStore.prototype, "handleDefineComplete").mockImplementation(
        () => {},
      );
      const dispatch = vi
        .spyOn(agentTransport, "dispatchToAgent")
        .mockResolvedValue({
          exitCode: 0,
          stdout: '{"summary":"done","intents":[]}',
          stderr: "",
          durationS: 0,
          observedModel: "runtime-revision",
        });
      const code = await runCli([
        "define",
        "spec",
        feature,
        "Write a specification",
      ]);
      expect(code).toBe(0);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(loadManifests(featureDir)).toEqual([
        expect.objectContaining({
          requestedModel:
            mode === "pinned" ? "gpt-6.1-sol" : "provider-default",
          ...(mode === "pinned" ? { requestedEffort: "high" } : {}),
          routeMode: mode,
          observedModel: "runtime-revision",
        }),
      ]);
    },
  );

  it("connects resolveAgent and WorkflowRuntime to forward typed model, effort, routeMode and return observedModel", async () => {
    const projectRoot = createTempProject({
      project: { name: "gwrk" },
      agents: { define: "agy", implement: "codex" },
    });
    const evidence = await projectEvidence(projectRoot);
    const modelsDir = path.join(projectRoot, ".gwrk", "models");
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.writeFileSync(
      path.join(modelsDir, "route-lock.local.json"),
      JSON.stringify(
        makeRouteLock(
          {},
          {
            routes: {
              define: makePin({ evidence }),
              review: makePin({
                role: "review",
                evidence,
                backend: "claude",
                provider: "anthropic",
                family: "claude-4",
                modelId: "claude-opus-4-6",
                effort: "medium",
                toolVersions: {
                  cliVersion: "2.1.322",
                  adapterVersion: "1.0.0",
                },
                fallbackRoutes: [],
              }),
            },
          },
        ),
        null,
        2,
      ),
      "utf8",
    );

    const resolvedDefine = resolveAgent("define", projectRoot, {
      runnerProfile: "local",
      snapshot: makeSnapshot(),
    });
    expect(resolvedDefine.backend).toBe("codex");
    expect(resolvedDefine.model).toBe("gpt-6.1-sol");
    expect(resolvedDefine.effort).toBe("high");
    expect(resolvedDefine.routeMode).toBe("pinned");
    expect(resolvedDefine.routeStatus).toBe("pinned");
    expect(resolvedDefine.preflightBanner).toContain("codex / gpt-6.1-sol");

    const resolvedReview = resolveRoleAgent("review", projectRoot, {
      runnerProfile: "local",
      snapshot: makeSnapshot(),
    });
    expect(resolvedReview.role).toBe("review");
    expect(resolvedReview.backend).toBe("claude");
    expect(resolvedReview.model).toBe("claude-opus-4-6");
    expect(resolvedReview.effort).toBe("medium");

    const dispatched: TaskDispatch[] = [];
    const runtime = new WorkflowRuntime();
    const pinnedResult = await runtime.executeWorkflow(
      "missing-native-workflow",
      "Run pinned dispatch",
      {
        projectRoot,
        nativeOnly: true,
        allowMissingPrompt: true,
        taskType: "define",
        agent: resolvedDefine.backend,
        model: resolvedDefine.model,
        effort: resolvedDefine.effort,
        routeMode: resolvedDefine.routeMode,
        dispatcher: async (task): Promise<TaskResult> => {
          dispatched.push(task);
          return {
            exitCode: 0,
            stdout: "done",
            stderr: "",
            durationS: 1,
            observedModel: "gpt-6.1-sol-2026-11",
          };
        },
      },
    );

    expect(dispatched[0]?.agent).toBe("codex");
    expect(dispatched[0]?.model).toBe("gpt-6.1-sol");
    expect(dispatched[0]?.effort).toBe("high");
    expect(dispatched[0]?.routeMode).toBe("pinned");
    expect(pinnedResult.observedModel).toBe("gpt-6.1-sol-2026-11");

    const providerDefault = resolveAgent("define", projectRoot, {
      runnerProfile: "local",
      routeMode: "provider-default",
      agent: "claude",
    });
    expect(providerDefault.routeMode).toBe("provider-default");
    expect(providerDefault.model).toBeUndefined();

    const defaultResult = await runtime.executeWorkflow(
      "missing-native-workflow",
      "Run provider-default dispatch",
      {
        projectRoot,
        nativeOnly: true,
        allowMissingPrompt: true,
        agent: providerDefault.backend,
        model: "should-not-be-forwarded",
        routeMode: providerDefault.routeMode,
        dispatcher: async (task): Promise<TaskResult> => {
          dispatched.push(task);
          return {
            exitCode: 0,
            stdout: "done",
            stderr: "",
            durationS: 1,
          };
        },
      },
    );

    expect(dispatched[1]?.agent).toBe("claude");
    expect(dispatched[1]?.model).toBeUndefined();
    expect(dispatched[1]?.routeMode).toBe("provider-default");
    expect(defaultResult.observedModel).toBe("unknown");
  });
});
