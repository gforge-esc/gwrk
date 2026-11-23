/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DiscoverySnapshot,
  type RunnerScope,
  eligibleRoutesDigest,
} from "../../domain/model-qualification.js";
import { WorkflowRuntime } from "../../plugins/workflow-runtime.js";
import type { RouteLockStorePort } from "../../ports/model-qualification-port.js";
import type { TaskDispatch, TaskResult } from "../../utils/agent.js";
import { resolveAgent, resolveRoleAgent } from "../../utils/resolve-agent.js";
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

afterEach(() => {
  vi.restoreAllMocks();
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

  it("connects resolveAgent and WorkflowRuntime to forward typed model, effort, routeMode and return observedModel", async () => {
    const projectRoot = createTempProject({
      project: { name: "gwrk" },
      agents: { define: "agy", implement: "codex" },
    });
    const modelsDir = path.join(projectRoot, ".gwrk", "models");
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.writeFileSync(
      path.join(modelsDir, "route-lock.local.json"),
      JSON.stringify(
        makeRouteLock(
          {},
          {
            routes: {
              define: makePin(),
              review: makePin({
                role: "review",
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
