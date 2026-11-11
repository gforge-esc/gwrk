/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";
import type { ModelCandidate } from "../../domain/model-qualification.js";
import type {
  FixtureRepeatRequest,
  JudgeVerdictPacket,
  StructuredJudgeVerdict,
} from "../../ports/model-qualification-port.js";
import { evaluateModels } from "./evaluate-models.js";

const model = (
  backend: string,
  provider: string,
  family: string,
): ModelCandidate => ({ backend, provider, family, modelId: `${family}-v1` });

const candidate = model("candidate-backend", "provider-c", "candidate-family");
const incumbent = model("incumbent-backend", "provider-i", "incumbent-family");
const judges = [
  model("judge-a", "provider-a", "judge-family-a"),
  model("judge-b", "provider-b", "judge-family-b"),
] as const;

function setup({ gatePasses = true } = {}) {
  const runFixtureRepeat = vi.fn(async (request: FixtureRepeatRequest) => ({
    fixtureId: request.fixtureId,
    repeatIndex: request.repeatIndex,
    requestedModel: request.route.modelId,
    observedModel: "unknown",
    deterministicGatesPassed: gatePasses,
    gateChecks: [
      { checkId: "behavior", passed: gatePasses, detail: "expected output" },
    ],
    durationMs: 100,
    retries: 0,
    sanitizedOutput: request.route.modelId,
  }));
  const judgeComparison = vi.fn(
    async (
      judge: ModelCandidate,
      _packet: JudgeVerdictPacket,
    ): Promise<StructuredJudgeVerdict> => ({
      judgeBackend: judge.backend,
      judgeProvider: judge.provider,
      judgeFamily: judge.family,
      judgeModelId: judge.modelId,
      observedJudgeModel: "unknown",
      winner: "tie",
      optionARegression: false,
      optionBRegression: false,
      scores: { optionA: 5, optionB: 5 },
      citations: [
        {
          inputRef: "unseen",
          outputRef: "unseen",
          gateRef: "unseen",
          claim: "unsupported",
        },
      ],
    }),
  );
  return {
    runFixtureRepeat,
    judgeComparison,
    deps: {
      runner: {
        runFixtureRepeat,
        computeSuiteHashes: async () => ({
          fixtureSuiteHash: "fixture-hash",
          workflowPromptHashes: { implement: "prompt-hash" },
        }),
      },
      judge: { judgeComparison },
    },
  };
}

const input = {
  evaluationId: "fixture-evaluation",
  role: "implement" as const,
  candidate,
  incumbent,
  judges,
  blindingSecret: "fixture-blinding-key",
  fixtures: [{ id: "implement-seeded-defect" }],
};

describe("model qualification orchestration", () => {
  it("runs each route three times and skips judges when behavior fails", async () => {
    const { deps, runFixtureRepeat, judgeComparison } = setup({
      gatePasses: false,
    });
    const result = await evaluateModels(deps, input);

    for (const route of [candidate, incumbent]) {
      expect(
        runFixtureRepeat.mock.calls
          .map(([request]) => request)
          .filter(
            (request) =>
              request.route === route ||
              request.route.modelId === route.modelId,
          )
          .map(({ repeatIndex }) => repeatIndex)
          .sort(),
      ).toEqual([0, 1, 2]);
    }
    expect(judgeComparison).not.toHaveBeenCalled();
    expect(result.decision).toEqual({ promote: false, reason: "gate-failure" });
  });

  it("excludes route identities from both judge packets and rejects unsupported citations", async () => {
    const { deps, judgeComparison } = setup();
    const result = await evaluateModels(deps, input);

    expect(judgeComparison.mock.calls.map(([judge]) => judge)).toEqual([
      ...judges,
    ]);
    for (const [, packet] of judgeComparison.mock.calls) {
      const evidence = JSON.stringify(packet);
      for (const route of [candidate, incumbent]) {
        for (const identity of [
          route.backend,
          route.provider,
          route.family,
          route.modelId,
        ]) {
          expect(evidence).not.toContain(identity);
        }
      }
    }
    expect(result.decision).toEqual({
      promote: false,
      reason: "invalid-citations",
    });
  });
});
