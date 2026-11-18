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
): string {
  let result = text;
  const tokens = new Set<string>();
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

  if (
    Array.isArray(input.handoffs) &&
    input.handoffs.length > 0 &&
    !input.artifactRoot
  ) {
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

  const repeatCount = input.repeats ?? 3;
  const candidateRepeats: FixtureRepeatEvidence[] = [];
  const incumbentRepeats: FixtureRepeatEvidence[] = [];
  const definedFixtures = new Set<string>();

  for (const fixture of narrowedFixtures) {
    if (input.role === "define") {
      definedFixtures.add(fixture.id);
    }
    for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
      const candidateRepeat = await deps.runner.runFixtureRepeat({
        fixtureId: fixture.id,
        role: input.role,
        repeatIndex,
        route: {
          backend: input.candidate.backend,
          modelId: input.candidate.modelId,
          effort: input.candidate.effort,
        },
        artifactOutputDir:
          input.role === "define" && input.artifactRoot
            ? `${input.artifactRoot}/candidate/${fixture.id}/repeat-${repeatIndex}`
            : undefined,
      });
      candidateRepeats.push(candidateRepeat);

      const incumbentRepeat = await deps.runner.runFixtureRepeat({
        fixtureId: fixture.id,
        role: input.role,
        repeatIndex,
        route: {
          backend: input.incumbent.backend,
          modelId: input.incumbent.modelId,
          effort: input.incumbent.effort,
        },
        artifactOutputDir:
          input.role === "define" && input.artifactRoot
            ? `${input.artifactRoot}/incumbent/${fixture.id}/repeat-${repeatIndex}`
            : undefined,
      });
      incumbentRepeats.push(incumbentRepeat);
    }
  }

  if (Array.isArray(input.handoffs) && input.handoffs.length > 0) {
    const definedOutputs = new Set<string>();
    for (const fixtureId of definedFixtures) {
      for (let i = 0; i < repeatCount; i += 1) {
        definedOutputs.add(`${fixtureId}:${i}`);
      }
    }

    for (const handoff of input.handoffs) {
      for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
        if (!definedOutputs.has(`${handoff.from}:${repeatIndex}`)) {
          await deps.runner.runFixtureRepeat({
            fixtureId: handoff.from,
            role: "define",
            repeatIndex,
            route: {
              backend: input.candidate.backend,
              modelId: input.candidate.modelId,
              effort: input.candidate.effort,
            },
            artifactOutputDir: input.artifactRoot
              ? `${input.artifactRoot}/candidate/${handoff.from}/repeat-${repeatIndex}`
              : undefined,
          });
          await deps.runner.runFixtureRepeat({
            fixtureId: handoff.from,
            role: "define",
            repeatIndex,
            route: {
              backend: input.incumbent.backend,
              modelId: input.incumbent.modelId,
              effort: input.incumbent.effort,
            },
            artifactOutputDir: input.artifactRoot
              ? `${input.artifactRoot}/incumbent/${handoff.from}/repeat-${repeatIndex}`
              : undefined,
          });
          definedOutputs.add(`${handoff.from}:${repeatIndex}`);
        }

        if (handoff.planSource === "candidate") {
          const incumbentImplement = await deps.runner.runFixtureRepeat({
            fixtureId: handoff.to,
            role: "implement",
            repeatIndex,
            route: {
              backend: input.incumbent.backend,
              modelId: input.incumbent.modelId,
              effort: input.incumbent.effort,
            },
            handoffArtifactDir: input.artifactRoot
              ? `${input.artifactRoot}/candidate/${handoff.from}/repeat-${repeatIndex}`
              : undefined,
          });
          candidateRepeats.push(incumbentImplement);

          const candidateImplement = await deps.runner.runFixtureRepeat({
            fixtureId: handoff.to,
            role: "implement",
            repeatIndex,
            route: {
              backend: input.candidate.backend,
              modelId: input.candidate.modelId,
              effort: input.candidate.effort,
            },
            handoffArtifactDir: input.artifactRoot
              ? `${input.artifactRoot}/incumbent/${handoff.from}/repeat-${repeatIndex}`
              : undefined,
          });
          incumbentRepeats.push(candidateImplement);
        } else {
          const candidateHandoff = await deps.runner.runFixtureRepeat({
            fixtureId: handoff.to,
            role: "implement",
            repeatIndex,
            route: {
              backend: input.candidate.backend,
              modelId: input.candidate.modelId,
              effort: input.candidate.effort,
            },
            handoffArtifactDir: undefined,
          });
          candidateRepeats.push(candidateHandoff);

          const incumbentHandoff = await deps.runner.runFixtureRepeat({
            fixtureId: handoff.to,
            role: "implement",
            repeatIndex,
            route: {
              backend: input.incumbent.backend,
              modelId: input.incumbent.modelId,
              effort: input.incumbent.effort,
            },
            handoffArtifactDir: undefined,
          });
          incumbentRepeats.push(incumbentHandoff);
        }
      }
    }
  }

  assertNoSecretMaterial({ candidateRepeats, incumbentRepeats });

  const candidateGatesPassed =
    candidateRepeats.length > 0 &&
    candidateRepeats.every(
      (repeat) => repeat.deterministicGatesPassed === true,
    );

  const roleScore = scoreRole(input.role, candidateRepeats, incumbentRepeats);

  if (!candidateGatesPassed) {
    return {
      evaluationId: input.evaluationId,
      role: input.role,
      candidate: input.candidate,
      incumbent: input.incumbent,
      candidateOption: "A",
      decision: { promote: false, reason: "gate-failure" },
      repeats: { candidate: candidateRepeats, incumbent: incumbentRepeats },
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

  const routesToRedact: ModelCandidate[] = [
    input.candidate,
    input.incumbent,
    ...[...candidateRepeats, ...incumbentRepeats]
      .filter(
        ({ observedModel }) => observedModel && observedModel !== "unknown",
      )
      .map(({ observedModel }) => ({
        backend: "",
        provider: "",
        family: "",
        modelId: observedModel,
      })),
  ];
  const optionA = sanitizeIdentityText(rawOptionA, routesToRedact);
  const optionB = sanitizeIdentityText(rawOptionB, routesToRedact);

  const fixtureSummary = sanitizeIdentityText(
    `Fixture evaluation for ${narrowedFixtures.map((fixture) => fixture.id).join(", ")} on role ${input.role}`,
    routesToRedact,
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

  const gateEvidenceSummary = sanitizeIdentityText(
    rawGateEvidenceSummary,
    routesToRedact,
  );

  const packet: JudgeVerdictPacket = {
    comparisonId: sanitizeIdentityText(input.evaluationId, routesToRedact),
    role: input.role,
    fixtureSummary,
    optionA,
    optionB,
    gateEvidenceSummary,
  };

  assertNoSecretMaterial(packet);
  const verdict1 = await deps.judge.judgeComparison(input.judges[0], packet);
  const verdict2 = await deps.judge.judgeComparison(input.judges[1], packet);

  const inputRefs = new Set<string>();
  for (const fixture of narrowedFixtures) {
    inputRefs.add(fixture.id);
  }
  if (Array.isArray(input.handoffs)) {
    for (const handoff of input.handoffs) {
      inputRefs.add(handoff.from);
      inputRefs.add(handoff.to);
    }
  }

  const outputRefs = new Set<string>(["optionA", "optionB"]);

  const gateRefs = new Set<string>();
  for (const repeat of [...candidateRepeats, ...incumbentRepeats]) {
    for (const check of repeat.gateChecks) {
      gateRefs.add(check.checkId);
    }
  }

  const decision = evaluateModelPromotion({
    candidateOption,
    requiredFixtures: narrowedFixtures.map((fixture) => fixture.id),
    repeats: candidateRepeats.map((repeat) => ({
      fixtureId: repeat.fixtureId,
      repeatIndex: repeat.repeatIndex,
      gatesPassed: repeat.deterministicGatesPassed,
    })),
    judges: [verdict1, verdict2],
    refs: {
      input: [...inputRefs],
      output: [...outputRefs],
      gate: [...gateRefs],
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
