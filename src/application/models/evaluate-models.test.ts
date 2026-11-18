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
import { type EvaluateModelsDeps, evaluateModels } from "./evaluate-models.js";

const model = (
  backend: string,
  provider: string,
  family: string,
): ModelCandidate => ({ backend, provider, family, modelId: `${family}-v1` });

const candidate = model("candidate-backend", "provider-c", "candidate-family");
const incumbent = model("incumbent-backend", "provider-i", "incumbent-family");
const fixedImplementer = {
  ...model("fixed-backend", "fixed-provider", "fixed-family"),
  effort: "low",
};
const judges = [
  model("judge-a", "provider-a", "judge-family-a"),
  model("judge-b", "provider-b", "judge-family-b"),
] as const;

type TestHandoff = {
  from: string;
  to: string;
  planSource: "candidate" | "fixed";
};

function setup({
  gatePasses = true,
  handoffs = [],
  repeatFloor = 3,
}: {
  gatePasses?: boolean;
  handoffs?: TestHandoff[];
  repeatFloor?: number;
} = {}) {
  let fixtureSuiteHash = "fixture-hash";
  let workflowPromptHashes = { implement: "prompt-hash" };
  const runFixtureRepeat = vi.fn(async (request: FixtureRepeatRequest) => ({
    fixtureId: request.fixtureId,
    repeatIndex: request.repeatIndex,
    requestedModel: request.route.modelId,
    observedModel: "unknown",
    deterministicGatesPassed: gatePasses,
    fixtureInputs: { "spec.md": "Fixture requirements" },
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
    changeSuite: () => {
      fixtureSuiteHash = "changed-fixture-hash";
    },
    changePrompt: () => {
      workflowPromptHashes = { implement: "changed-prompt-hash" };
    },
    runFixtureRepeat,
    judgeComparison,
    deps: {
      runner: {
        loadSuite: async () => ({
          repeats: repeatFloor,
          handoffs,
          fixtures: [
            { id: "define-long-context", roles: ["define"] },
            { id: "implement-seeded-defect", roles: ["implement", "review"] },
          ],
        }),
        runFixtureRepeat,
        computeSuiteHashes: async () => ({
          fixtureSuiteHash,
          workflowPromptHashes,
        }),
      },
      judge: { judgeComparison },
    } satisfies EvaluateModelsDeps,
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

const candidateHandoff = {
  from: "define-long-context",
  to: "implement-seeded-defect",
  planSource: "candidate" as const,
};

const fixedHandoff = { ...candidateHandoff, planSource: "fixed" as const };
const defineHandoffInput = {
  ...input,
  role: "define" as const,
  fixtures: [{ id: candidateHandoff.from }],
  artifactRoot: "/art",
  fixedImplementer,
};

function winningImplementationVerdict(
  judge: ModelCandidate,
): StructuredJudgeVerdict {
  return {
    judgeBackend: judge.backend,
    judgeProvider: judge.provider,
    judgeFamily: judge.family,
    judgeModelId: judge.modelId,
    observedJudgeModel: "unknown",
    winner: blindCandidate(input.blindingSecret, input.evaluationId),
    optionARegression: false,
    optionBRegression: false,
    scores: { optionA: 80, optionB: 80 },
    citations: [
      {
        inputRef: "input:1:A:0:1",
        outputRef: "optionA",
        gateRef: "gate:1:A:0:1",
        claim: "Fixture behavior verified",
      },
    ],
  };
}

describe("model qualification orchestration", () => {
  it.each(["define", "review"] as const)(
    "supplies blinded elapsed duration after coverage for %s ranking",
    async (role) => {
      const { deps, runFixtureRepeat, judgeComparison } = setup();
      const original = runFixtureRepeat.getMockImplementation()!;
      runFixtureRepeat.mockImplementation(async (request) => ({
        ...(await original(request)),
        durationMs: request.route.modelId === candidate.modelId ? 250 : 400,
      }));
      await evaluateModels(deps, {
        ...input,
        role,
        fixtures: [
          {
            id:
              role === "define"
                ? "define-long-context"
                : "implement-seeded-defect",
          },
        ],
      });
      expect(judgeComparison).toHaveBeenCalledTimes(2);
      for (const [, packet] of judgeComparison.mock.calls) {
        expect(packet.gateEvidenceSummary).toContain("250ms elapsed");
        expect(packet.gateEvidenceSummary).toContain("400ms elapsed");
        expect(packet.gateEvidenceSummary).toContain("coverage");
        expect(packet.gateEvidenceSummary).toContain("secondary");
      }
    },
  );
  it.each(["requested identity", "observed identity", "incumbent gate"])(
    "rejects invalid repeat evidence before judging: %s",
    async (defect) => {
      const { deps, runFixtureRepeat, judgeComparison } = setup();
      runFixtureRepeat.mockImplementation(async (request) => ({
        fixtureId: request.fixtureId,
        repeatIndex: request.repeatIndex,
        requestedModel:
          defect === "requested identity"
            ? "other-model"
            : request.route.modelId,
        observedModel:
          defect === "observed identity" ? "other-model" : "unknown",
        deterministicGatesPassed: !(
          defect === "incumbent gate" &&
          request.route.modelId === incumbent.modelId
        ),
        fixtureInputs: { "spec.md": "Fixture requirements" },
        gateChecks: [
          {
            checkId: "candidate-gate",
            passed: true,
            detail: "expected output",
          },
        ],
        durationMs: 100,
        retries: 0,
        sanitizedOutput: "Routing evidence",
      }));
      const result = await evaluateModels(deps, input);
      expect(result.decision.promote).toBe(false);
      expect(judgeComparison).not.toHaveBeenCalled();
    },
  );

  it.each(["candidate", "incumbent"])(
    "rejects %s review route identity evidence before judging",
    async (side) => {
      const { deps, runFixtureRepeat, judgeComparison } = setup();
      const original = runFixtureRepeat.getMockImplementation()!;
      runFixtureRepeat.mockImplementation(async (request) => ({
        ...(await original(request)),
        gateChecks:
          request.route.modelId ===
          (side === "candidate" ? candidate : incumbent).modelId
            ? [
                {
                  checkId: "fixture-route-identity",
                  passed: false,
                  detail: "unexpected model",
                },
              ]
            : [
                {
                  checkId: "fixture-route-identity",
                  passed: true,
                  detail: "expected model",
                },
              ],
      }));
      const result = await evaluateModels(deps, { ...input, role: "review" });
      expect(result.decision.promote).toBe(false);
      expect(judgeComparison).not.toHaveBeenCalled();
    },
  );

  it.each(
    (["candidate", "incumbent"] as const).flatMap((side) =>
      ["failed", "empty"].map((kind) => ({ side, kind })),
    ),
  )(
    "TR-024 rejects $kind implementation checks despite a passing $side aggregate",
    async ({ side, kind }) => {
      const { deps, runFixtureRepeat, judgeComparison } = setup();
      const original = runFixtureRepeat.getMockImplementation()!;
      const failedModel = side === "candidate" ? candidate : incumbent;
      runFixtureRepeat.mockImplementation(async (request) => {
        const evidence = await original(request);
        const failed =
          request.route.modelId === failedModel.modelId &&
          request.repeatIndex === 1;
        return {
          ...evidence,
          durationMs: request.route.modelId === candidate.modelId ? 100 : 400,
          gateChecks:
            failed && kind === "empty"
              ? []
              : evidence.gateChecks.map((check) => ({
                  ...check,
                  passed: !failed,
                })),
        };
      });
      judgeComparison.mockImplementation(async (judge) =>
        winningImplementationVerdict(judge),
      );

      const result = await evaluateModels(deps, input);

      expect(result.decision).toEqual({
        promote: false,
        reason: "gate-failure",
      });
      expect(judgeComparison).not.toHaveBeenCalled();
    },
  );

  it("requires the suite-declared handoff even when callers supply only fixtures", async () => {
    const { deps, runFixtureRepeat, judgeComparison } = setup({
      handoffs: [candidateHandoff],
    });
    const result = await evaluateModels(deps, {
      ...input,
      role: "define",
      fixtures: [{ id: candidateHandoff.from }],
    });
    expect(result.decision).toEqual({
      promote: false,
      reason: "missing-handoff-artifacts",
    });
    expect(runFixtureRepeat).not.toHaveBeenCalled();
    expect(judgeComparison).not.toHaveBeenCalled();
  });

  it.each(["short count", "duplicate candidate", "duplicate incumbent"])(
    "rejects a %s even when a direct fixture shares the fixed handoff target",
    async (mode) => {
      const { deps, runFixtureRepeat, judgeComparison } = setup({
        repeatFloor: 4,
        handoffs: [{ ...candidateHandoff, planSource: "fixed" }],
      });
      const original = runFixtureRepeat.getMockImplementation()!;
      let calls = 0;
      runFixtureRepeat.mockImplementation(async (request) => {
        const inHandoff = calls++ >= 8;
        const duplicateRoute =
          mode === "duplicate candidate" ? candidate : incumbent;
        return {
          ...(await original(request)),
          repeatIndex:
            mode !== "short count" &&
            inHandoff &&
            request.route.modelId === duplicateRoute.modelId
              ? 0
              : request.repeatIndex,
        };
      });
      const result = await evaluateModels(deps, {
        ...input,
        repeats: mode === "short count" ? 3 : 4,
      });
      expect(result.decision).toEqual({
        promote: false,
        reason: "insufficient-repeats",
      });
      expect(judgeComparison).not.toHaveBeenCalled();
    },
  );

  it.each(["repeat", "judge"])(
    "rejects inputs changed during a %s",
    async (stage) => {
      const {
        deps,
        runFixtureRepeat,
        judgeComparison,
        changeSuite,
        changePrompt,
      } = setup();
      if (stage === "repeat") {
        const original = runFixtureRepeat.getMockImplementation()!;
        runFixtureRepeat.mockImplementation(async (request) => {
          changeSuite();
          return original(request);
        });
      } else {
        const original = judgeComparison.getMockImplementation()!;
        judgeComparison.mockImplementation(async (judge, packet) => {
          changePrompt();
          return original(judge, packet);
        });
      }

      const result = await evaluateModels(deps, input);
      expect(result.decision).toEqual({
        promote: false,
        reason: "stale-evaluation-inputs",
      });
      expect(judgeComparison).toHaveBeenCalledTimes(stage === "repeat" ? 0 : 2);
    },
  );

  it("blinds route identities in comparison IDs and observed model output", async () => {
    const { deps, runFixtureRepeat, judgeComparison } = setup();
    const original = runFixtureRepeat.getMockImplementation()!;
    runFixtureRepeat.mockImplementation(async (request) => ({
      ...(await original(request)),
      observedModel: request.route.modelId,
      sanitizedOutput: `Output from ${request.route.modelId}`,
    }));
    await evaluateModels(deps, {
      ...input,
      evaluationId: `comparison-${candidate.modelId}-${incumbent.modelId}`,
    });
    expect(judgeComparison).toHaveBeenCalledTimes(2);
    for (const [, packet] of judgeComparison.mock.calls) {
      const serialized = JSON.stringify(packet);
      expect(serialized).not.toContain(candidate.modelId);
      expect(serialized).not.toContain(incumbent.modelId);
    }
  });

  it.each([true, false])(
    "attributes implementation evidence to the implementer with candidate gates passing=%s",
    async (candidatePasses) => {
      const { deps, runFixtureRepeat, judgeComparison } = setup({
        handoffs: [fixedHandoff],
      });
      const original = runFixtureRepeat.getMockImplementation()!;
      runFixtureRepeat.mockImplementation(async (request) => {
        const isCandidate = request.route.modelId === candidate.modelId;
        return {
          ...(await original(request)),
          deterministicGatesPassed:
            request.role === "define" || !isCandidate || candidatePasses,
          durationMs: request.role === "define" ? 900 : isCandidate ? 100 : 400,
        };
      });

      const result = await evaluateModels(deps, input);

      expect(
        result.repeats.candidate.map(({ requestedModel }) => requestedModel),
      ).toEqual(Array(6).fill(candidate.modelId));
      expect(
        result.repeats.incumbent.map(({ requestedModel }) => requestedModel),
      ).toEqual(Array(6).fill(incumbent.modelId));
      expect(result.roleScore).toEqual({
        role: "implement",
        candidateMedianMsToGreen: candidatePasses ? 100 : null,
        incumbentMedianMsToGreen: 400,
        speedup: candidatePasses ? 4 : null,
      });
      expect(result.decision).toEqual({
        promote: false,
        reason: candidatePasses ? "invalid-citations" : "gate-failure",
      });
      expect(judgeComparison).toHaveBeenCalledTimes(candidatePasses ? 2 : 0);
      if (candidatePasses) {
        const [, packet] = judgeComparison.mock.calls[0];
        expect(packet.fixtureSummary).not.toContain(candidateHandoff.from);
        expect(packet.fixtureSummary).toContain(candidateHandoff.to);
        expect(packet.gateEvidenceSummary).toContain("candidate-gate");
      }
    },
  );

  it("requires a passing define prerequisite for each candidate handoff implementation", async () => {
    const { deps, runFixtureRepeat, judgeComparison } = setup({
      handoffs: [candidateHandoff],
    });
    const original = runFixtureRepeat.getMockImplementation()!;
    runFixtureRepeat.mockImplementation(async (request) => ({
      ...(await original(request)),
      deterministicGatesPassed:
        request.role !== "define" ||
        request.route.modelId !== candidate.modelId,
    }));

    const result = await evaluateModels(deps, defineHandoffInput);

    expect(result.decision).toEqual({ promote: false, reason: "gate-failure" });
    expect(judgeComparison).not.toHaveBeenCalled();
    expect(
      runFixtureRepeat.mock.calls.some(
        ([request]) =>
          request.role === "implement" &&
          request.handoffArtifactDir?.includes("/candidate/"),
      ),
    ).toBe(false);
  });

  it.each(["candidate", "incumbent"])(
    "rejects a route mismatch on the %s generated-plan handoff before judging",
    async (side) => {
      const { deps, runFixtureRepeat, judgeComparison } = setup({
        handoffs: [candidateHandoff],
      });
      const original = runFixtureRepeat.getMockImplementation()!;
      runFixtureRepeat.mockImplementation(async (request) => ({
        ...(await original(request)),
        observedModel:
          request.handoffArtifactDir?.includes(`/${side}/`) &&
          request.repeatIndex === 0
            ? "other-model"
            : request.route.modelId,
      }));

      const result = await evaluateModels(deps, defineHandoffInput);

      expect(result.decision).toEqual({
        promote: false,
        reason: "gate-failure",
      });
      expect(judgeComparison).not.toHaveBeenCalled();
    },
  );

  it("checks secrets in prerequisite define evidence before calling judges", async () => {
    const { deps, runFixtureRepeat, judgeComparison } = setup({
      handoffs: [candidateHandoff],
    });
    const original = runFixtureRepeat.getMockImplementation()!;
    runFixtureRepeat.mockImplementation(async (request) => ({
      ...(await original(request)),
      sanitizedOutput:
        request.role === "define"
          ? "Authorization: Bearer fixture-sensitive-value"
          : "Implementation output",
    }));

    await expect(evaluateModels(deps, defineHandoffInput)).rejects.toThrow(
      "Secret material",
    );
    expect(judgeComparison).not.toHaveBeenCalled();
  });

  it("requires three distinct repeats for each executed handoff target", async () => {
    const { deps, runFixtureRepeat } = setup({ handoffs: [candidateHandoff] });
    const original = runFixtureRepeat.getMockImplementation()!;
    runFixtureRepeat.mockImplementation(async (request) => ({
      ...(await original(request)),
      repeatIndex: request.handoffArtifactDir ? 0 : request.repeatIndex,
    }));

    const result = await evaluateModels(deps, defineHandoffInput);

    expect(result.decision).toEqual({
      promote: false,
      reason: "insufficient-repeats",
    });
  });

  it.each([undefined, "/art"])(
    "skips handoffs for review with artifact root %s",
    async (artifactRoot) => {
      const { deps, runFixtureRepeat, judgeComparison } = setup({
        handoffs: [candidateHandoff],
      });

      await evaluateModels(deps, {
        ...input,
        role: "review",
        artifactRoot,
      });

      expect(runFixtureRepeat).toHaveBeenCalledTimes(6);
      expect(
        runFixtureRepeat.mock.calls.every(
          ([request]) => request.role === "review",
        ),
      ).toBe(true);
      expect(judgeComparison.mock.calls[0][1].fixtureSummary).not.toContain(
        candidateHandoff.from,
      );
    },
  );

  it("reports insufficient repeats for an empty role-scoped fixture selection", async () => {
    const { deps, runFixtureRepeat, judgeComparison } = setup();

    const result = await evaluateModels(deps, { ...input, role: "define" });

    expect(result.decision).toEqual({
      promote: false,
      reason: "insufficient-repeats",
    });
    expect(runFixtureRepeat).not.toHaveBeenCalled();
    expect(judgeComparison).not.toHaveBeenCalled();
  });

  it("keeps candidate and incumbent role scores outside blinded judge packets", async () => {
    const { deps, judgeComparison } = setup();
    const result = await evaluateModels(deps, input);
    expect(result.roleScore).toBeDefined();
    expect(judgeComparison).toHaveBeenCalledTimes(2);
    for (const [, packet] of judgeComparison.mock.calls) {
      expect(packet).not.toHaveProperty("roleScore");
      expect(JSON.stringify(packet)).not.toContain("candidateMedianMsToGreen");
      expect(JSON.stringify(packet)).not.toContain("incumbentMedianMsToGreen");
    }
  });

  it.each([true, false])(
    "rejects secret fixture evidence before judge dispatch with gatePasses=%s",
    async (gatePasses) => {
      const { deps, runFixtureRepeat, judgeComparison } = setup({ gatePasses });
      const original = runFixtureRepeat.getMockImplementation()!;
      runFixtureRepeat.mockImplementation(async (request) => ({
        ...(await original(request)),
        sanitizedOutput: "Authorization: Bearer fixture-sensitive-value",
      }));
      await expect(evaluateModels(deps, input)).rejects.toThrow(
        "Secret material",
      );
      expect(judgeComparison).not.toHaveBeenCalled();
    },
  );

  it("rejects a candidate-plan handoff when the source run has no generated artifacts", async () => {
    const { deps, judgeComparison } = setup({ handoffs: [candidateHandoff] });
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

  it.each([
    {
      field: "substituted route",
      override: winningImplementationVerdict(
        model("judge-c", "provider-c-alt", "judge-family-c"),
      ),
    },
    { field: "backend", override: { judgeBackend: "judge-c" } },
    { field: "provider", override: { judgeProvider: "provider-c-alt" } },
    { field: "family", override: { judgeFamily: "judge-family-c" } },
    { field: "model", override: { judgeModelId: "judge-family-c-v1" } },
    {
      field: "observed model",
      override: { observedJudgeModel: "judge-family-c-v1" },
    },
    {
      field: "unknown observation",
      override: { observedJudgeModel: "unknown" },
      acceptsVerdict: true,
    },
  ])(
    "TR-020 validates the second judge's $field",
    async ({ override, acceptsVerdict }) => {
      const { deps, runFixtureRepeat, judgeComparison } = setup();
      const original = runFixtureRepeat.getMockImplementation()!;
      runFixtureRepeat.mockImplementation(async (request) => ({
        ...(await original(request)),
        durationMs: request.route.modelId === candidate.modelId ? 100 : 400,
      }));
      judgeComparison.mockImplementation(async (judge) => ({
        ...winningImplementationVerdict(judge),
        ...(judge === judges[1] ? override : {}),
      }));

      const result = await evaluateModels(deps, input);

      expect(judgeComparison.mock.calls.map(([judge]) => judge)).toEqual(
        judges,
      );
      if (acceptsVerdict) {
        expect(result.decision).toEqual({ promote: true });
        expect(result.judges?.[1].observedJudgeModel).toBe("unknown");
        return;
      }
      expect(result.decision).toEqual({
        promote: false,
        reason: "judge-dependence",
      });
      expect(result.judges).toBeUndefined();
      expect(result.judgeVerdictHashes).toBeUndefined();
    },
  );

  it.each([
    { label: "slower", candidateMs: 400, incumbentMs: 100, promote: false },
    { label: "tied", candidateMs: 100, incumbentMs: 100, promote: false },
    {
      label: "missing finite incumbent timing",
      candidateMs: 100,
      incumbentMs: Number.POSITIVE_INFINITY,
      promote: false,
    },
    { label: "faster", candidateMs: 100, incumbentMs: 400, promote: true },
  ])(
    "TR-021 uses fixed-plan timings when the candidate is $label",
    async ({ candidateMs, incumbentMs, promote }) => {
      const { deps, runFixtureRepeat, judgeComparison } = setup({
        handoffs: [fixedHandoff],
      });
      const original = runFixtureRepeat.getMockImplementation()!;
      let calls = 0;
      runFixtureRepeat.mockImplementation(async (request) => {
        const times =
          calls++ < 6
            ? { candidate: 25, incumbent: 50 }
            : { candidate: candidateMs, incumbent: incumbentMs };
        const route =
          request.route.modelId === candidate.modelId
            ? "candidate"
            : "incumbent";
        return {
          ...(await original(request)),
          durationMs: times[route],
        };
      });
      judgeComparison.mockImplementation(async (judge) => ({
        ...winningImplementationVerdict(judge),
        observedJudgeModel: judge === judges[0] ? judge.modelId : "unknown",
      }));

      const result = await evaluateModels(deps, input);

      expect(result.comparisons?.[0]?.roleScore).toMatchObject({
        candidateMedianMsToGreen: 25,
        incumbentMedianMsToGreen: 50,
      });
      expect(result.roleScore).toMatchObject({
        candidateMedianMsToGreen: candidateMs,
        incumbentMedianMsToGreen: incumbentMs,
      });
      expect(
        result.repeats.candidate.every(
          (repeat) => repeat.deterministicGatesPassed,
        ),
      ).toBe(true);
      expect(
        result.repeats.incumbent.every(
          (repeat) => repeat.deterministicGatesPassed,
        ),
      ).toBe(true);
      expect(judgeComparison).toHaveBeenCalledTimes(2);
      expect(
        result.judges?.map(({ observedJudgeModel }) => observedJudgeModel),
      ).toEqual([judges[0].modelId, "unknown"]);
      expect(result.decision).toEqual(
        promote
          ? { promote: true }
          : { promote: false, reason: "implementation-not-faster" },
      );
    },
  );

  it("runs both plan authors on one fixed implementer and scores fixed-plan routes separately", async () => {
    const { deps, runFixtureRepeat, judgeComparison } = setup({
      handoffs: [candidateHandoff, fixedHandoff],
    });
    const original = runFixtureRepeat.getMockImplementation()!;
    runFixtureRepeat.mockImplementation(async (request) => ({
      ...(await original(request)),
      durationMs: request.handoffArtifactDir
        ? 999
        : request.role === "define"
          ? 800
          : request.route.modelId === candidate.modelId
            ? 100
            : 400,
      observedModel: request.route.modelId,
      sanitizedOutput: request.handoffArtifactDir
        ? `Generated plan run on ${fixedImplementer.modelId}`
        : "Direct evidence",
      deterministicGatesPassed:
        !request.handoffArtifactDir?.includes("/incumbent/"),
      gateChecks: [
        {
          checkId: request.handoffArtifactDir
            ? "generated-plan-gate"
            : "candidate-gate",
          passed: true,
          detail: "ok",
        },
      ],
    }));
    const expectedOption = blindCandidate(
      input.blindingSecret,
      input.evaluationId,
    );
    const defaultVerdict = judgeComparison.getMockImplementation()!;
    judgeComparison.mockImplementation(async (judge, packet) => ({
      ...(await defaultVerdict(judge, packet)),
      winner: expectedOption,
      citations: [
        {
          inputRef:
            packet.role === "define" ? "input:2:A:0:1" : "input:1:A:0:1",
          outputRef: "optionA",
          gateRef: packet.role === "define" ? "gate:2:A:0:1" : "gate:1:A:0:1",
          claim: "Fixture behavior verified",
        },
      ],
    }));
    const fixtureRequest = (
      route: ModelCandidate,
      fixtureId: string,
      role: FixtureRepeatRequest["role"],
      repeatIndex: number,
    ) => ({
      fixtureId,
      role,
      repeatIndex,
      route: {
        backend: route.backend,
        modelId: route.modelId,
        effort: route.effort,
      },
    });
    const indices = [0, 1, 2];
    const authors = [
      { name: "candidate", route: candidate },
      { name: "incumbent", route: incumbent },
    ];
    const artifactDir = (name: string, index: number) =>
      `/art/${name}/${candidateHandoff.from}/repeat-${index}`;

    const definition = await evaluateModels(deps, {
      ...input,
      role: "define",
      fixtures: [{ id: candidateHandoff.from }],
      fixedImplementer,
      artifactRoot: "/art",
    });
    const defineCalls = runFixtureRepeat.mock.calls.map(([request]) => request);
    expect(defineCalls.filter(({ role }) => role === "define")).toEqual(
      indices.flatMap((index) =>
        authors.map(({ name, route }) => ({
          ...fixtureRequest(route, candidateHandoff.from, "define", index),
          artifactOutputDir: artifactDir(name, index),
        })),
      ),
    );
    expect(defineCalls.filter(({ role }) => role === "implement")).toEqual(
      indices.flatMap((index) =>
        authors.map(({ name }) => ({
          ...fixtureRequest(
            fixedImplementer,
            candidateHandoff.to,
            "implement",
            index,
          ),
          handoffArtifactDir: artifactDir(name, index),
        })),
      ),
    );
    expect(definition.decision).toEqual({ promote: true });
    expect(definition.comparisons).toContainEqual(
      expect.objectContaining({
        handoff: candidateHandoff,
        gatePassRate: { candidate: 1, incumbent: 0 },
      }),
    );
    for (const [, packet] of judgeComparison.mock.calls) {
      expect(JSON.stringify(packet)).not.toMatch(
        /fixed-backend|fixed-provider|fixed-family|resolved-fixed-model/,
      );
      expect(packet.gateEvidenceSummary).toContain(
        expectedOption === "A"
          ? "Option A gate pass rate 1, Option B gate pass rate 0"
          : "Option A gate pass rate 0, Option B gate pass rate 1",
      );
    }

    runFixtureRepeat.mockClear();
    judgeComparison.mockClear();
    let directCalls = 0;
    runFixtureRepeat.mockImplementation(async (request) => ({
      ...(await original(request)),
      durationMs:
        directCalls++ < 6
          ? 999
          : request.route.modelId === candidate.modelId
            ? 100
            : 400,
    }));
    const implementation = await evaluateModels(deps, input);
    expect(runFixtureRepeat.mock.calls.flat()).toEqual(
      [0, 1].flatMap(() =>
        indices.flatMap((index) =>
          authors.map(({ route }) =>
            fixtureRequest(route, candidateHandoff.to, "implement", index),
          ),
        ),
      ),
    );
    expect(implementation.decision).toEqual({ promote: true });
    expect(implementation.suiteHashes).toEqual(
      await deps.runner.computeSuiteHashes(),
    );
    expect(implementation.roleScore).toEqual({
      role: "implement",
      candidateMedianMsToGreen: 100,
      incumbentMedianMsToGreen: 400,
      speedup: 4,
    });
    expect(implementation.comparisons).toContainEqual(
      expect.objectContaining({
        handoff: fixedHandoff,
        roleScore: implementation.roleScore,
      }),
    );
    for (const [, packet] of judgeComparison.mock.calls) {
      expect(packet.gateEvidenceSummary).toContain(
        expectedOption === "A"
          ? "Option A 100ms to green, Option B 400ms to green"
          : "Option A 400ms to green, Option B 100ms to green",
      );
    }
  });

  it("narrows fixtures to those declaring the evaluation role and avoids dispatching mismatched fixtures", async () => {
    const { deps, runFixtureRepeat } = setup();
    const result = await evaluateModels(deps, {
      ...input,
      role: "define",
      fixtures: [
        { id: "define-long-context" },
        { id: "implement-seeded-defect" },
        { id: "undeclared-fixture" },
      ],
    });

    const calls = runFixtureRepeat.mock.calls.map(([req]) => req);
    expect(calls.map(({ fixtureId }) => fixtureId)).not.toContain(
      "undeclared-fixture",
    );
    const implementAsDefine = calls.filter(
      (req) =>
        req.fixtureId === "implement-seeded-defect" && req.role === "define",
    );
    expect(implementAsDefine).toHaveLength(0);
    expect(result.decision).toEqual({
      promote: false,
      reason: "invalid-citations",
    });
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

  it.each([
    {
      route: "candidate",
      failedModel: candidate,
      failedIndices: [0, 1, 2],
      aggregatePasses: false,
    },
    {
      route: "incumbent",
      failedModel: incumbent,
      failedIndices: [0, 1, 2],
      aggregatePasses: false,
    },
    {
      route: "incumbent",
      failedModel: incumbent,
      failedIndices: [1],
      aggregatePasses: false,
    },
    {
      route: "incumbent",
      failedModel: incumbent,
      failedIndices: [1],
      aggregatePasses: true,
    },
  ])(
    "TR-026 scores definition coverage when $route fails reference checks at $failedIndices (aggregate passes: $aggregatePasses)",
    async ({ failedModel, failedIndices, aggregatePasses }) => {
      const { deps, runFixtureRepeat, judgeComparison } = setup({
        handoffs: [candidateHandoff],
      });
      const original = runFixtureRepeat.getMockImplementation()!;
      runFixtureRepeat.mockImplementation(async (request) => {
        const evidence = await original(request);
        if (request.role !== "define") return { ...evidence, durationMs: 200 };
        const referencePassed =
          request.route.modelId !== failedModel.modelId ||
          !failedIndices.includes(request.repeatIndex);
        return {
          ...evidence,
          deterministicGatesPassed: referencePassed || aggregatePasses,
          gateChecks: [
            { checkId: "spec-ref-ADR-001", passed: true, detail: "ok" },
            {
              checkId: "spec-ref-ADR-002",
              passed: referencePassed,
              detail: "coverage",
            },
            { checkId: "plan-ref-queue", passed: true, detail: "ok" },
            { checkId: "plan-ref-test", passed: true, detail: "ok" },
          ],
        };
      });

      const result = await evaluateModels(deps, defineHandoffInput);
      const allIndices = [0, 1, 2];
      const passedIndices = allIndices.filter(
        (index) => !failedIndices.includes(index),
      );
      const requests = runFixtureRepeat.mock.calls.map(([request]) => request);
      for (const route of [candidate, incumbent]) {
        expect(
          requests
            .filter(
              (request) =>
                request.role === "define" &&
                request.route.modelId === route.modelId,
            )
            .map(({ repeatIndex }) => repeatIndex),
        ).toEqual(allIndices);
      }
      const handoffIndices = (side: "candidate" | "incumbent") =>
        requests
          .filter(
            (request) =>
              request.role === "implement" &&
              request.handoffArtifactDir?.startsWith(`/art/${side}/`),
          )
          .map(({ repeatIndex }) => repeatIndex);

      const passedChecks =
        failedModel === candidate ? 12 - failedIndices.length : 12;
      expect(result.roleScore).toEqual({
        role: "define",
        coverage: passedChecks / 12,
        passedChecks,
        totalChecks: 12,
      });
      if (failedModel === candidate) {
        expect(result.decision).toEqual({
          promote: false,
          reason: "gate-failure",
        });
        expect(judgeComparison).not.toHaveBeenCalled();
        expect(handoffIndices("candidate")).toEqual([]);
        return;
      }

      expect(handoffIndices("candidate")).toEqual(allIndices);
      expect(handoffIndices("incumbent")).toEqual(passedIndices);
      expect(requests).toHaveLength(9 + passedIndices.length);
      expect(judgeComparison).toHaveBeenCalledTimes(2);
      const handoff = result.comparisons?.find(
        (comparison) => comparison.handoff?.planSource === "candidate",
      );
      const incumbentRate = passedIndices.length / 3;
      expect(handoff).toMatchObject({
        gatePassRate: { candidate: 1, incumbent: incumbentRate },
        skippedIncumbentRepeatIndices: failedIndices,
      });
      expect(
        handoff?.repeats.incumbent.map(({ repeatIndex }) => repeatIndex),
      ).toEqual(passedIndices);
      const incumbentCoverage = (12 - failedIndices.length) / 12;
      const incumbentOption = result.candidateOption === "A" ? "B" : "A";
      for (const [, packet] of judgeComparison.mock.calls) {
        expect(packet.gateEvidenceSummary).toContain(
          result.candidateOption === "A"
            ? `Option A coverage 1, Option B coverage ${incumbentCoverage}`
            : `Option A coverage ${incumbentCoverage}, Option B coverage 1`,
        );
        expect(packet.gateEvidenceSummary).toContain(
          result.candidateOption === "A"
            ? `Option A gate pass rate 1, Option B gate pass rate ${incumbentRate}`
            : `Option A gate pass rate ${incumbentRate}, Option B gate pass rate 1`,
        );
        expect(packet.gateEvidenceSummary).toContain(
          `Option ${incumbentOption} skipped repeat indices ${failedIndices.join(", ")}`,
        );
        expect(packet.gateEvidenceSummary).toContain(
          `Option ${incumbentOption} ${passedIndices.length > 0 ? "200ms elapsed" : "no elapsed evidence"}`,
        );
      }
    },
  );

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
        fixtureInputs: { "spec.md": "Fixture requirements" },
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
              inputRef: "input:1:A:0:1",
              outputRef: "optionA",
              gateRef: "gate:1:A:0:1",
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
