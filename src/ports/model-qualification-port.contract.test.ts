/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { expect, expectTypeOf, it } from "vitest";
import type { JudgeVerdict } from "../domain/model-qualification.js";
import type {
  PromotionJudgePort,
  QualificationRunnerPort,
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

it("exposes the documented smoke, repeat and judge contracts to consumers", async () => {
  const smoke: SmokeProbePort = {
    async runSmokeProbe({ backend, modelId, effort }) {
      return {
        backend,
        requestedModel: modelId,
        requestedEffort: effort,
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

  const repeat = await runner.runFixtureRepeat({
    fixtureId: "fixture",
    role: "implement",
    repeatIndex: 0,
    route,
  });
  expect(repeat.requestedModel).toBe(route.modelId);

  const result = await judge.judgeComparison(judgeRoute, {
    comparisonId: "comparison",
    role: "implement",
    fixtureSummary: "fixture",
    optionA: "first output",
    optionB: "second output",
    gateEvidenceSummary: "Both passed",
  });
  const { judgeBackend, judgeProvider, judgeFamily, judgeModelId, ...verdict } =
    result;
  const domainVerdict: JudgeVerdict = {
    ...verdict,
    judge: {
      backend: judgeBackend,
      provider: judgeProvider,
      family: judgeFamily,
      modelId: judgeModelId,
    },
  };
  expect(domainVerdict.judge).toEqual(judgeRoute);
  expect(domainVerdict.observedJudgeModel).toBe("unknown");
  expectTypeOf(result).toEqualTypeOf<StructuredJudgeVerdict>();
  expectTypeOf<
    Omit<StructuredJudgeVerdict, "observedJudgeModel">
  >().not.toMatchTypeOf<StructuredJudgeVerdict>();
});
