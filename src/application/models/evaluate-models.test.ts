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
      {
        checkId: "candidate-gate",
        passed: gatePasses,
        detail: "expected output",
      },
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
        loadSuite: async () => ({
          fixtures: [
            { id: "define-long-context", roles: ["define"] },
            { id: "implement-seeded-defect", roles: ["implement", "review"] },
          ],
        }),
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
    expect(result.decision).toEqual({
      promote: false,
      reason: "missing-handoff-artifacts",
    });
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
            outputRef: "optionA",
            gateRef: "candidate-gate",
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
      artifactRoot: "/art",
    };

    const result = await evaluateModels(deps, handoffInput);

    const defineCalls = runFixtureRepeat.mock.calls
      .map(([req]) => req)
      .filter((req) => req.fixtureId === "define-long-context");
    expect(defineCalls.length).toBe(6);
    for (const call of defineCalls) {
      expect(call.handoffArtifactDir).toBeUndefined();
      expect(call.artifactOutputDir).toBeDefined();
      expect(call.artifactOutputDir).toBe(
        call.route.modelId === candidate.modelId
          ? `/art/candidate/define-long-context/repeat-${call.repeatIndex}`
          : `/art/incumbent/define-long-context/repeat-${call.repeatIndex}`,
      );
    }

    const candidatePlanCalls = runFixtureRepeat.mock.calls
      .map(([req]) => req)
      .filter(
        (req) =>
          req.fixtureId === "implement-seeded-defect" &&
          req.handoffArtifactDir !== undefined,
      );
    expect(candidatePlanCalls.length).toBe(6);

    const incumbentImplementCalls = candidatePlanCalls.filter(
      (req) => req.route.modelId === incumbent.modelId,
    );
    expect(incumbentImplementCalls.length).toBe(3);
    for (const call of incumbentImplementCalls) {
      expect(call.handoffArtifactDir).toBe(
        `/art/candidate/define-long-context/repeat-${call.repeatIndex}`,
      );
    }

    const candidateImplementCalls = candidatePlanCalls.filter(
      (req) => req.route.modelId === candidate.modelId,
    );
    expect(candidateImplementCalls.length).toBe(3);
    for (const call of candidateImplementCalls) {
      expect(call.handoffArtifactDir).toBe(
        `/art/incumbent/define-long-context/repeat-${call.repeatIndex}`,
      );
    }

    const fixedPlanCalls = runFixtureRepeat.mock.calls
      .map(([req]) => req)
      .filter(
        (req) =>
          req.fixtureId === "implement-seeded-defect" &&
          req.handoffArtifactDir === undefined,
      );
    expect(fixedPlanCalls.length).toBe(6);
    for (const call of fixedPlanCalls) {
      expect(call.handoffArtifactDir).toBeUndefined();
    }

    expect(judgeComparison).toHaveBeenCalledTimes(2);
    expect(result.decision).toEqual({ promote: true });
    expect(result.candidateOption).toBe(expectedOption);
  });

  it("narrows fixtures to those declaring the evaluation role and avoids dispatching mismatched fixtures", async () => {
    const { deps, runFixtureRepeat } = setup();
    const result = await evaluateModels(deps, {
      ...input,
      role: "define",
      fixtures: [
        { id: "define-long-context" },
        { id: "implement-seeded-defect" },
      ],
    });

    const calls = runFixtureRepeat.mock.calls.map(([req]) => req);
    const implementAsDefine = calls.filter(
      (req) =>
        req.fixtureId === "implement-seeded-defect" && req.role === "define",
    );
    expect(implementAsDefine).toHaveLength(0);
    expect(result.decision.reason).not.toBe("gate-failure");
  });

  it("rejects generic citations that do not cite supplied artifacts", async () => {
    const { deps, judgeComparison } = setup();
    judgeComparison.mockImplementation(
      async (judge: ModelCandidate): Promise<StructuredJudgeVerdict> => ({
        judgeBackend: judge.backend,
        judgeProvider: judge.provider,
        judgeFamily: judge.family,
        judgeModelId: judge.modelId,
        observedJudgeModel: "unknown",
        winner: "A",
        optionARegression: false,
        optionBRegression: false,
        scores: { optionA: 90, optionB: 70 },
        citations: [
          {
            inputRef: "input",
            outputRef: "output",
            gateRef: "gate",
            claim: "Generic citation",
          },
        ],
      }),
    );

    const result = await evaluateModels(deps, input);
    expect(result.decision).toEqual({
      promote: false,
      reason: "invalid-citations",
    });
  });

  it("computes roleScore for define coverage and includes it in gateEvidenceSummary", async () => {
    const { deps, runFixtureRepeat, judgeComparison } = setup();
    runFixtureRepeat.mockImplementation(async (request) => ({
      fixtureId: request.fixtureId,
      repeatIndex: request.repeatIndex,
      requestedModel: request.route.modelId,
      observedModel: "unknown",
      deterministicGatesPassed: true,
      gateChecks: [
        { checkId: "spec-ref-ADR-001", passed: true, detail: "ok" },
        { checkId: "spec-ref-ADR-002", passed: false, detail: "missing" },
        { checkId: "plan-ref-queue", passed: true, detail: "ok" },
        { checkId: "plan-ref-test", passed: true, detail: "ok" },
      ],
      durationMs: 100,
      retries: 0,
      sanitizedOutput: "define output",
    }));

    let capturedPacket: JudgeVerdictPacket | undefined;
    judgeComparison.mockImplementation(async (judge, packet) => {
      capturedPacket = packet;
      return {
        judgeBackend: judge.backend,
        judgeProvider: judge.provider,
        judgeFamily: judge.family,
        judgeModelId: judge.modelId,
        observedJudgeModel: "unknown",
        winner: "tie",
        optionARegression: false,
        optionBRegression: false,
        scores: { optionA: 80, optionB: 80 },
        citations: [],
      };
    });

    const result = await evaluateModels(deps, {
      ...input,
      role: "define",
      fixtures: [{ id: "define-long-context" }],
    });

    expect(result.roleScore).toBeDefined();
    expect(result.roleScore?.role).toBe("define");
    if (result.roleScore?.role === "define") {
      expect(result.roleScore.coverage).toBe(0.75);
      expect(result.roleScore.passedChecks).toBe(9);
      expect(result.roleScore.totalChecks).toBe(12);
    }
    expect(capturedPacket?.gateEvidenceSummary).toContain("coverage 0.75");
  });

  it("computes roleScore for implement time-to-green and speedup", async () => {
    const { deps, runFixtureRepeat } = setup();
    runFixtureRepeat.mockImplementation(async (request) => {
      const isCandidate = request.route.modelId === candidate.modelId;
      const durations = isCandidate ? [100, 150, 200] : [300, 400, 500];
      return {
        fixtureId: request.fixtureId,
        repeatIndex: request.repeatIndex,
        requestedModel: request.route.modelId,
        observedModel: "unknown",
        deterministicGatesPassed: true,
        gateChecks: [{ checkId: "candidate-gate", passed: true, detail: "ok" }],
        durationMs: durations[request.repeatIndex],
        retries: 0,
        sanitizedOutput: "implement output",
      };
    });

    const result = await evaluateModels(deps, input);
    expect(result.roleScore).toBeDefined();
    expect(result.roleScore?.role).toBe("implement");
    if (result.roleScore?.role === "implement") {
      expect(result.roleScore.candidateMedianMsToGreen).toBe(150);
      expect(result.roleScore.incumbentMedianMsToGreen).toBe(400);
      expect(result.roleScore.speedup).toBeCloseTo(400 / 150);
    }
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
              outputRef: "optionA",
              gateRef: "candidate-gate",
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
