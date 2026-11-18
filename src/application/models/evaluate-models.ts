/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import {
  type BlindedOption,
  type JudgeVerdict,
  type ModelCandidate,
  type ModelRole,
  type PromotionDecision,
  type PromotionEvidence,
  type RoleScore,
  assertNoSecretMaterial,
  blindCandidate,
  evaluatePromotion,
  scoreRole,
} from "../../domain/model-qualification.js";
import type {
  FixtureRepeatEvidence,
  FixtureRepeatRequest,
  JudgeVerdictPacket,
  PromotionJudgePort,
  QualificationRunnerPort,
  StructuredJudgeVerdict,
} from "../../ports/model-qualification-port.js";

export function evaluateModelPromotion(
  evidence: Omit<PromotionEvidence, "judges"> & {
    readonly judges: readonly StructuredJudgeVerdict[];
  },
): PromotionDecision {
  const judges = evidence.judges.map(
    ({
      judgeBackend,
      judgeProvider,
      judgeFamily,
      judgeModelId,
      ...verdict
    }): JudgeVerdict => ({
      ...verdict,
      judge: {
        backend: judgeBackend,
        provider: judgeProvider,
        family: judgeFamily,
        modelId: judgeModelId,
      },
    }),
  );
  return evaluatePromotion({ ...evidence, judges });
}

export interface EvaluateModelsDeps {
  readonly runner: QualificationRunnerPort;
  readonly judge: PromotionJudgePort;
}

export interface EvaluateModelsInput {
  readonly evaluationId: string;
  readonly role: ModelRole;
  readonly candidate: ModelCandidate;
  readonly incumbent: ModelCandidate;
  readonly judges:
    | readonly [ModelCandidate, ModelCandidate]
    | readonly ModelCandidate[];
  readonly blindingSecret: string;
  readonly fixtures: readonly { readonly id: string }[];
  readonly handoffs?: readonly {
    readonly from: string;
    readonly to: string;
    readonly planSource: "candidate" | "fixed";
  }[];
  readonly artifactRoot?: string;
  readonly repeats?: number;
}

export interface EvaluationResult {
  readonly evaluationId: string;
  readonly role: ModelRole;
  readonly candidate: ModelCandidate;
  readonly incumbent: ModelCandidate;
  readonly candidateOption: BlindedOption;
  readonly decision: PromotionDecision;
  readonly repeats: {
    readonly candidate: readonly FixtureRepeatEvidence[];
    readonly incumbent: readonly FixtureRepeatEvidence[];
  };
  readonly roleScore?: RoleScore;
  readonly judges?: readonly StructuredJudgeVerdict[];
  readonly suiteHashes?: {
    readonly fixtureSuiteHash: string;
    readonly workflowPromptHashes: Record<string, string>;
  };
  readonly judgeVerdictHashes?: readonly [string, string];
}

function sanitizeIdentityText(
  text: string,
  routes: readonly ModelCandidate[],
  observedModels: readonly string[],
): string {
  let result = text;
  const tokens = new Set(observedModels.filter((model) => model !== "unknown"));
  for (const route of routes) {
    if (route.modelId) tokens.add(route.modelId);
    if (route.family) tokens.add(route.family);
    if (route.provider) tokens.add(route.provider);
    if (route.backend) tokens.add(route.backend);
  }
  const sortedTokens = [...tokens]
    .filter((token) => token.trim().length > 0)
    .sort((a, b) => b.length - a.length);

  for (const token of sortedTokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "gi"), "[redacted]");
  }
  return result;
}

const routeKeys = ["candidate", "incumbent"] as const;
type RouteKey = (typeof routeKeys)[number];

export async function evaluateModels(
  deps: EvaluateModelsDeps,
  input: EvaluateModelsInput,
): Promise<EvaluationResult> {
  if (
    !Array.isArray(input.judges) ||
    input.judges.length !== 2 ||
    !input.judges[0]?.provider ||
    !input.judges[1]?.provider ||
    !input.judges[0]?.family ||
    !input.judges[1]?.family ||
    input.judges[0].provider.trim().toLowerCase() ===
      input.judges[1].provider.trim().toLowerCase() ||
    input.judges[0].family.trim().toLowerCase() ===
      input.judges[1].family.trim().toLowerCase()
  ) {
    return {
      evaluationId: input.evaluationId,
      role: input.role,
      candidate: input.candidate,
      incumbent: input.incumbent,
      candidateOption: "A",
      decision: { promote: false, reason: "judge-dependence" },
      repeats: { candidate: [], incumbent: [] },
    };
  }

  const handoffs = input.role === "review" ? [] : (input.handoffs ?? []);
  if (handoffs.length > 0 && !input.artifactRoot) {
    return {
      evaluationId: input.evaluationId,
      role: input.role,
      candidate: input.candidate,
      incumbent: input.incumbent,
      candidateOption: "A",
      decision: { promote: false, reason: "missing-handoff-artifacts" },
      repeats: { candidate: [], incumbent: [] },
    };
  }

  const suite = await deps.runner.loadSuite();
  const roleMap = new Map<string, readonly ModelRole[]>(
    suite.fixtures.map((f) => [f.id, f.roles]),
  );
  const narrowedFixtures = input.fixtures.filter((f) => {
    const roles = roleMap.get(f.id);
    return Array.isArray(roles) && roles.includes(input.role);
  });

  for (const { from, to } of handoffs) {
    if (
      !roleMap.get(from)?.includes("define") ||
      !roleMap.get(to)?.includes("implement")
    ) {
      throw new Error(
        `Handoff requires a define fixture and an implement fixture: ${from} to ${to}`,
      );
    }
  }

  const repeatCount = input.repeats ?? 3;
  const repeats: Record<RouteKey, FixtureRepeatEvidence[]> = {
    candidate: [],
    incumbent: [],
  };
  const defineRepeats = new Map<string, FixtureRepeatEvidence>();
  const requiredFixtures = new Set(narrowedFixtures.map(({ id }) => id));
  const inputRefs = new Set(requiredFixtures);

  const artifactDir = (
    route: RouteKey,
    fixtureId: string,
    repeatIndex: number,
  ) =>
    input.artifactRoot
      ? `${input.artifactRoot}/${route}/${fixtureId}/repeat-${repeatIndex}`
      : undefined;

  const runRepeat = async (
    routeKey: RouteKey,
    request: Omit<FixtureRepeatRequest, "route">,
  ) => {
    const { backend, modelId, effort } = input[routeKey];
    const evidence = await deps.runner.runFixtureRepeat({
      ...request,
      route: { backend, modelId, effort },
    });
    assertNoSecretMaterial(evidence);
    return evidence;
  };

  const runDefine = async (
    route: RouteKey,
    fixtureId: string,
    repeatIndex: number,
  ) => {
    const key = `${route}:${repeatIndex}:${fixtureId}`;
    const cached = defineRepeats.get(key);
    if (cached) return cached;
    const evidence = await runRepeat(route, {
      fixtureId,
      role: "define",
      repeatIndex,
      artifactOutputDir: artifactDir(route, fixtureId, repeatIndex),
    });
    defineRepeats.set(key, evidence);
    return evidence;
  };

  for (const { id: fixtureId } of narrowedFixtures) {
    for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
      for (const route of routeKeys) {
        const evidence =
          input.role === "define"
            ? await runDefine(route, fixtureId, repeatIndex)
            : await runRepeat(route, {
                fixtureId,
                role: input.role,
                repeatIndex,
              });
        repeats[route].push(evidence);
      }
    }
  }

  let candidatePrerequisitesPassed = true;
  for (const { from, to, planSource } of handoffs) {
    requiredFixtures.add(to);
    inputRefs.add(from);
    inputRefs.add(to);
    for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
      const definitions = {
        candidate: await runDefine("candidate", from, repeatIndex),
        incumbent: await runDefine("incumbent", from, repeatIndex),
      };

      for (const implementer of routeKeys) {
        const planAuthor =
          implementer === "candidate" ? "incumbent" : "candidate";
        const comparisonRoute =
          input.role === "define" && planSource === "candidate"
            ? planAuthor
            : implementer;
        let handoffArtifactDir: string | undefined;
        if (planSource === "candidate") {
          if (!definitions[planAuthor].deterministicGatesPassed) {
            if (comparisonRoute === "candidate")
              candidatePrerequisitesPassed = false;
            continue;
          }
          handoffArtifactDir = artifactDir(planAuthor, from, repeatIndex);
        }
        const evidence = await runRepeat(implementer, {
          fixtureId: to,
          role: "implement",
          repeatIndex,
          handoffArtifactDir,
        });
        repeats[comparisonRoute].push(evidence);
      }
    }
  }

  const { candidate: candidateRepeats, incumbent: incumbentRepeats } = repeats;
  assertNoSecretMaterial({
    evaluationId: input.evaluationId,
    candidate: input.candidate,
    incumbent: input.incumbent,
    repeats,
  });
  const roleScore = scoreRole(input.role, candidateRepeats, incumbentRepeats);
  const candidateGatesPassed =
    candidatePrerequisitesPassed &&
    candidateRepeats.every(
      (repeat) => repeat.deterministicGatesPassed === true,
    );

  if (!candidateGatesPassed || candidateRepeats.length === 0) {
    return {
      evaluationId: input.evaluationId,
      role: input.role,
      candidate: input.candidate,
      incumbent: input.incumbent,
      candidateOption: "A",
      decision: {
        promote: false,
        reason: candidateGatesPassed ? "insufficient-repeats" : "gate-failure",
      },
      repeats,
      roleScore,
    };
  }

  const candidateOption = blindCandidate(
    input.blindingSecret,
    input.evaluationId,
  );

  const candidateOutputs = candidateRepeats
    .map((repeat) => repeat.sanitizedOutput)
    .join("\n\n");
  const incumbentOutputs = incumbentRepeats
    .map((repeat) => repeat.sanitizedOutput)
    .join("\n\n");

  const rawOptionA =
    candidateOption === "A" ? candidateOutputs : incumbentOutputs;
  const rawOptionB =
    candidateOption === "A" ? incumbentOutputs : candidateOutputs;

  const observedModels = [
    ...candidateRepeats,
    ...incumbentRepeats,
    ...defineRepeats.values(),
  ].map(({ observedModel }) => observedModel);
  const redact = (text: string) =>
    sanitizeIdentityText(
      text,
      [input.candidate, input.incumbent],
      observedModels,
    );
  const gateRefs = new Set(
    [...candidateRepeats, ...incumbentRepeats].flatMap((repeat) =>
      repeat.gateChecks.map(({ checkId }) => checkId),
    ),
  );
  const fixtureSummary = redact(
    `Fixture evaluation for ${[...inputRefs].join(", ")} on role ${input.role}`,
  );

  let rawGateEvidenceSummary = "";

  if (roleScore.role === "define") {
    const candidateScore = roleScore;
    const incumbentScore = scoreRole(
      "define",
      incumbentRepeats,
      candidateRepeats,
    ) as Extract<RoleScore, { role: "define" }>;
    const optACoverage =
      candidateOption === "A"
        ? candidateScore.coverage
        : incumbentScore.coverage;
    const optBCoverage =
      candidateOption === "A"
        ? incumbentScore.coverage
        : candidateScore.coverage;
    rawGateEvidenceSummary = `Option A coverage ${optACoverage}, Option B coverage ${optBCoverage}`;
  } else if (roleScore.role === "implement") {
    const optAMs =
      candidateOption === "A"
        ? roleScore.candidateMedianMsToGreen
        : roleScore.incumbentMedianMsToGreen;
    const optBMs =
      candidateOption === "A"
        ? roleScore.incumbentMedianMsToGreen
        : roleScore.candidateMedianMsToGreen;
    rawGateEvidenceSummary = `Option A ${optAMs}ms to green, Option B ${optBMs}ms`;
  } else {
    const candidateScore = roleScore;
    const incumbentScore = scoreRole(
      "review",
      incumbentRepeats,
      candidateRepeats,
    ) as Extract<RoleScore, { role: "review" }>;
    const optACoverage =
      candidateOption === "A"
        ? candidateScore.coverage
        : incumbentScore.coverage;
    const optBCoverage =
      candidateOption === "A"
        ? incumbentScore.coverage
        : candidateScore.coverage;
    rawGateEvidenceSummary = `Option A coverage ${optACoverage}, Option B coverage ${optBCoverage}`;
  }

  const packet: JudgeVerdictPacket = {
    comparisonId: redact(input.evaluationId),
    role: input.role,
    fixtureSummary,
    optionA: redact(rawOptionA),
    optionB: redact(rawOptionB),
    gateEvidenceSummary: redact(
      `${rawGateEvidenceSummary}\nGate checks: ${[...gateRefs].join(", ")}`,
    ),
  };

  assertNoSecretMaterial(packet);
  const verdict1 = await deps.judge.judgeComparison(input.judges[0], packet);
  const verdict2 = await deps.judge.judgeComparison(input.judges[1], packet);

  const decision = evaluateModelPromotion({
    candidateOption,
    requiredFixtures: [...requiredFixtures],
    repeats: candidateRepeats.map((repeat) => ({
      fixtureId: repeat.fixtureId,
      repeatIndex: repeat.repeatIndex,
      gatesPassed: repeat.deterministicGatesPassed,
    })),
    judges: [verdict1, verdict2],
    refs: {
      input: [...inputRefs].map(redact),
      output: ["optionA", "optionB"],
      gate: [...gateRefs].map(redact),
    },
  });

  const suiteHashes = await deps.runner.computeSuiteHashes();
  const judgeVerdictHashes: [string, string] = [
    createHash("sha256").update(JSON.stringify(verdict1)).digest("hex"),
    createHash("sha256").update(JSON.stringify(verdict2)).digest("hex"),
  ];

  const result: EvaluationResult = {
    evaluationId: input.evaluationId,
    role: input.role,
    candidate: input.candidate,
    incumbent: input.incumbent,
    candidateOption,
    decision,
    repeats: { candidate: candidateRepeats, incumbent: incumbentRepeats },
    roleScore,
    judges: [verdict1, verdict2],
    suiteHashes,
    judgeVerdictHashes,
  };

  assertNoSecretMaterial(result);
  return result;
}
