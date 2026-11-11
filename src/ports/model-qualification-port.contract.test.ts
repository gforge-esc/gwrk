/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { expect, expectTypeOf, it } from "vitest";
import { evaluateModelPromotion } from "../application/models/evaluate-models.js";
import type {
  AdapterDiscoveryReport,
  DiscoveredModel,
  RunnerScope,
} from "../domain/model-qualification.js";
import type {
  ModelCatalogPort,
  PromotionJudgePort,
  QualificationRunnerPort,
  RouteLockStorePort,
  SmokeProbePort,
  StructuredJudgeVerdict,
} from "./model-qualification-port.js";

const scope = {
  workspaceId: "workspace",
  runnerProfile: "local",
  platform: "linux",
  arch: "x64",
};
const route = { backend: "cli", modelId: "model-v1", effort: "high" };
const judgeRoute = {
  backend: "judge-cli",
  provider: "judge-provider",
  family: "judge-family",
  modelId: "judge-v1",
};

interface PublishedDiscoverySnapshot {
  readonly scope: RunnerScope;
  readonly adapters: readonly AdapterDiscoveryReport[];
}

interface PublishedRouteLockReads {
  readDiscoverySnapshot(
    scope: RunnerScope,
  ): Promise<PublishedDiscoverySnapshot | null>;
  readRouteLock(
    scope: RunnerScope,
  ): Promise<{ digest: string; document: unknown } | null>;
}

it("exposes the documented catalog and lock store contracts to consumers", async () => {
  const catalog: ModelCatalogPort = {
    async discoverCatalog() {
      return [];
    },
  };
  const snapshot = { scope, adapters: [] };
  const incumbent = { digest: "incumbent-digest", document: { routes: {} } };
  const reader: PublishedRouteLockReads = {
    async readDiscoverySnapshot() {
      return snapshot;
    },
    async readRouteLock() {
      return incumbent;
    },
  };
  const store: RouteLockStorePort = {
    ...reader,
    async writeDiscoverySnapshot() {
      return "snapshot-digest";
    },
    async writeEvaluationBundle() {
      return "evaluation-digest";
    },
    async readEvaluationBundle() {
      return null;
    },
    async writeRouteLockAtomic() {
      return "lock-digest";
    },
  };

  const reports: AdapterDiscoveryReport[] = await catalog.discoverCatalog({
    scope,
    nowIso: "2026-11-11T00:00:00Z",
  });
  expect(reports).toEqual([]);

  expectTypeOf<AdapterDiscoveryReport["models"]>().toEqualTypeOf<
    readonly DiscoveredModel[]
  >();
  expectTypeOf<DiscoveredModel["supportedEfforts"]>().toEqualTypeOf<
    readonly string[]
  >();
  const consumer: PublishedRouteLockReads = store;
  expect(await consumer.readDiscoverySnapshot(scope)).toEqual(snapshot);
  expect(await consumer.readRouteLock(scope)).toEqual(incumbent);

  const unvalidatedSnapshot: unknown = snapshot;
  const snapshotDigest: string = await store.writeDiscoverySnapshot(
    scope,
    unvalidatedSnapshot,
  );
  expect(snapshotDigest).toBe("snapshot-digest");

  const lock: unknown = {
    document: { schemaVersion: 1, routes: {} },
    expectedIncumbentDigest: null,
  };
  const digest: string = await store.writeRouteLockAtomic(scope, lock);
  expect(digest).toBe("lock-digest");
});

it("exposes the documented smoke, repeat and judge contracts to consumers", async () => {
  const smoke: SmokeProbePort = {
    async runSmokeProbe({ backend, modelId, effort }) {
      return {
        backend,
        requestedModel: modelId,
        ...(effort === undefined ? {} : { requestedEffort: effort }),
        observedModel: "unknown",
        status: "passed",
        schemaValid: true,
        exitCode: 0,
        durationMs: 1,
      };
    },
  };
  const runner: QualificationRunnerPort = {
    async computeSuiteHashes() {
      return { fixtureSuiteHash: "suite", workflowPromptHashes: {} };
    },
    async runFixtureRepeat({ fixtureId, repeatIndex, route }) {
      return {
        fixtureId,
        repeatIndex,
        requestedModel: route.modelId,
        observedModel: "unknown",
        deterministicGatesPassed: true,
        gateChecks: [{ checkId: "fixture", passed: true, detail: "Passed" }],
        durationMs: 1,
        retries: 0,
        sanitizedOutput: "fixture output",
      };
    },
  };
  const judge: PromotionJudgePort = {
    async judgeComparison({ backend, provider, family, modelId }) {
      return {
        judgeBackend: backend,
        judgeProvider: provider,
        judgeFamily: family,
        judgeModelId: modelId,
        observedJudgeModel: "unknown",
        winner: "B",
        optionARegression: false,
        optionBRegression: false,
        scores: { optionA: 80, optionB: 90 },
        citations: [
          {
            inputRef: "input",
            outputRef: "output",
            gateRef: "gate",
            claim: "Passed",
          },
        ],
      };
    },
  };

  const probe = await smoke.runSmokeProbe({ scope, ...route, timeoutMs: 100 });
  expect(probe.backend).toBe(route.backend);
  expect(probe.requestedModel).toBe(route.modelId);
  expect(probe.requestedEffort).toBe(route.effort);

  const probeWithoutEffort = await smoke.runSmokeProbe({
    scope,
    backend: route.backend,
    modelId: route.modelId,
    timeoutMs: 100,
  });
  expect(probeWithoutEffort).not.toHaveProperty("requestedEffort");

  const repeat = await runner.runFixtureRepeat({
    fixtureId: "fixture",
    role: "implement",
    repeatIndex: 0,
    route: { backend: route.backend, modelId: route.modelId },
  });
  expect(repeat.requestedModel).toBe(route.modelId);
  expectTypeOf(repeat.gateChecks).toEqualTypeOf<
    { checkId: string; passed: boolean; detail: string }[]
  >();

  const result = await judge.judgeComparison(judgeRoute, {
    comparisonId: "comparison",
    role: "implement",
    fixtureSummary: "fixture",
    optionA: "first output",
    optionB: "second output",
    gateEvidenceSummary: "Both passed",
  });
  expect(result).toMatchObject({
    judgeBackend: judgeRoute.backend,
    judgeProvider: judgeRoute.provider,
    judgeFamily: judgeRoute.family,
    judgeModelId: judgeRoute.modelId,
    observedJudgeModel: "unknown",
  });
  expectTypeOf(result).toEqualTypeOf<StructuredJudgeVerdict>();
  expectTypeOf<
    Omit<StructuredJudgeVerdict, "observedJudgeModel">
  >().not.toMatchTypeOf<StructuredJudgeVerdict>();

  const secondJudge = {
    ...result,
    judgeBackend: "other-cli",
    judgeProvider: "other-provider",
    judgeFamily: "other-family",
    judgeModelId: "other-v1",
    observedJudgeModel: "other-v1",
  };
  expect(
    evaluateModelPromotion({
      candidateOption: "B",
      requiredFixtures: [repeat.fixtureId],
      repeats: [0, 1, 2].map((repeatIndex) => ({
        fixtureId: repeat.fixtureId,
        repeatIndex,
        gatesPassed: repeat.deterministicGatesPassed,
      })),
      judges: [result, secondJudge],
      refs: { input: ["input"], output: ["output"], gate: ["gate"] },
    }),
  ).toEqual({ promote: true });
});
