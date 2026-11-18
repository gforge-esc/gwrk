/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";
import {
  type ModelCandidate,
  blindCandidate,
} from "../../domain/model-qualification.js";
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
  it("rejects a candidate-plan handoff when the source run has no generated artifacts", async () => {
    const { deps, judgeComparison } = setup();
    const winner = blindCandidate(input.blindingSecret, input.evaluationId);
    judgeComparison.mockImplementation(async (judge) => ({
      judgeBackend: judge.backend,
      judgeProvider: judge.provider,
      judgeFamily: judge.family,
      judgeModelId: judge.modelId,
      observedJudgeModel: "unknown",
      winner,
      optionARegression: false,
      optionBRegression: false,
      scores: {
        optionA: winner === "A" ? 95 : 70,
        optionB: winner === "B" ? 95 : 70,
      },
      citations: [
        {
          inputRef: "define-long-context",
          outputRef: "output",
          gateRef: "behavior",
          claim: "Equivalent fixture behavior",
        },
      ],
    }));
    const result = await evaluateModels(deps, {
      ...input,
      role: "define",
      fixtures: [{ id: "define-long-context" }],
      handoffs: [
        {
          from: "define-long-context",
          to: "implement-seeded-defect",
          planSource: "candidate",
        },
      ],
    });
    expect(result.decision).toEqual({ promote: false, reason: "gate-failure" });
    expect(judgeComparison).not.toHaveBeenCalled();
  });

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

  it("executes three repeats per fixture and scores both define and implement handoff directions", async () => {
    const expectedOption = blindCandidate(
      "fixture-blinding-key",
      "eval-handoff",
    );
    const { deps, runFixtureRepeat, judgeComparison } = setup({
      gatePasses: true,
    });

    judgeComparison.mockImplementation(
      async (judge: ModelCandidate): Promise<StructuredJudgeVerdict> => ({
        judgeBackend: judge.backend,
        judgeProvider: judge.provider,
        judgeFamily: judge.family,
        judgeModelId: judge.modelId,
        observedJudgeModel: "unknown",
        winner: expectedOption,
        optionARegression: false,
        optionBRegression: false,
        scores: {
          optionA: expectedOption === "A" ? 95 : 70,
          optionB: expectedOption === "B" ? 95 : 70,
        },
        citations: [
          {
            inputRef: "define-long-context",
            outputRef: "output",
            gateRef: "behavior",
            claim: "Plan coverage verified",
          },
        ],
      }),
    );

    const handoffInput = {
      evaluationId: "eval-handoff",
      role: "define" as const,
      candidate,
      incumbent,
      judges,
      blindingSecret: "fixture-blinding-key",
      fixtures: [{ id: "define-long-context" }],
      handoffs: [
        {
          from: "define-long-context",
          to: "implement-seeded-defect",
          planSource: "candidate" as const,
        },
        {
          from: "define-long-context",
          to: "implement-seeded-defect",
          planSource: "fixed" as const,
        },
      ],
      handoffArtifactDir: "/tmp/fake-artifacts",
    };

    const result = await evaluateModels(deps, handoffInput);

    // 1 base fixture + 2 handoff fixtures = 3 fixture runs * 3 repeats = 9 runs per route
    const candidateCalls = runFixtureRepeat.mock.calls
      .map(([req]) => req)
      .filter((req) => req.route.modelId === candidate.modelId);
    expect(candidateCalls.length).toBe(9);

    const defineCalls = candidateCalls.filter(
      (req) => req.fixtureId === "define-long-context",
    );
    expect(defineCalls.map((r) => r.repeatIndex).sort()).toEqual([0, 1, 2]);

    const implementCalls = candidateCalls.filter(
      (req) => req.fixtureId === "implement-seeded-defect",
    );
    expect(implementCalls.length).toBe(6);

    expect(judgeComparison).toHaveBeenCalledTimes(2);
    expect(result.decision).toEqual({ promote: true });
    expect(result.candidateOption).toBe(expectedOption);
  });

  it("enforces distinct judge providers and families and rejects dependent configurations", async () => {
    const { deps, judgeComparison } = setup();

    const dependentProviderJudges = [
      model("judge-a", "same-provider", "family-a"),
      model("judge-b", "same-provider", "family-b"),
    ] as const;

    const providerResult = await evaluateModels(deps, {
      ...input,
      judges: dependentProviderJudges,
    });

    expect(providerResult.decision).toEqual({
      promote: false,
      reason: "judge-dependence",
    });
    expect(judgeComparison).not.toHaveBeenCalled();

    const dependentFamilyJudges = [
      model("judge-a", "provider-a", "same-family"),
      model("judge-b", "provider-b", "same-family"),
    ] as const;

    const familyResult = await evaluateModels(deps, {
      ...input,
      judges: dependentFamilyJudges,
    });

    expect(familyResult.decision).toEqual({
      promote: false,
      reason: "judge-dependence",
    });
    expect(judgeComparison).not.toHaveBeenCalled();
  });

  it("retains incumbent on judge disagreement or candidate regression", async () => {
    const expectedOption = blindCandidate("fixture-blinding-key", "eval-split");
    const { deps, judgeComparison } = setup();

    let callCount = 0;
    judgeComparison.mockImplementation(
      async (judge: ModelCandidate): Promise<StructuredJudgeVerdict> => {
        callCount += 1;
        return {
          judgeBackend: judge.backend,
          judgeProvider: judge.provider,
          judgeFamily: judge.family,
          judgeModelId: judge.modelId,
          observedJudgeModel: "unknown",
          winner: callCount === 1 ? expectedOption : "tie",
          optionARegression: false,
          optionBRegression: false,
          scores: { optionA: 80, optionB: 80 },
          citations: [
            {
              inputRef: "implement-seeded-defect",
              outputRef: "output",
              gateRef: "behavior",
              claim: "Split verdict",
            },
          ],
        };
      },
    );

    const result = await evaluateModels(deps, {
      ...input,
      evaluationId: "eval-split",
    });

    expect(result.decision).toEqual({
      promote: false,
      reason: "judge-non-regression",
    });
  });
});
