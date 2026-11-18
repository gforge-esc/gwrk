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
  QualificationSuite,
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
  readonly fixedImplementer?: ModelCandidate;
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
  readonly repeats: Readonly<ComparisonRepeats>;
  readonly comparisons?: readonly EvaluationComparison[];
  readonly roleScore?: RoleScore;
  readonly judges?: readonly StructuredJudgeVerdict[];
  readonly suiteHashes?: {
    readonly fixtureSuiteHash: string;
    readonly workflowPromptHashes: Record<string, string>;
  };
  readonly judgeVerdictHashes?: readonly [string, string];
}

type Handoff = QualificationSuite["handoffs"][number];
type ComparisonRepeats = Record<RouteKey, readonly FixtureRepeatEvidence[]>;
type SuiteHashes = Awaited<
  ReturnType<QualificationRunnerPort["computeSuiteHashes"]>
>;

interface EvaluationComparison {
  readonly fixtureId: string;
  readonly handoff?: Handoff;
  readonly repeats: ComparisonRepeats;
  readonly roleScore?: RoleScore;
  readonly gatePassRate?: Readonly<Record<RouteKey, number>>;
}

function sameSuiteHashes(initial: SuiteHashes, current: SuiteHashes): boolean {
  return (
    initial.fixtureSuiteHash === current.fixtureSuiteHash &&
    Object.keys(initial.workflowPromptHashes).length ===
      Object.keys(current.workflowPromptHashes).length &&
    Object.entries(initial.workflowPromptHashes).every(
      ([workflow, hash]) => current.workflowPromptHashes[workflow] === hash,
    )
  );
}

function matchesJudgeRoute(
  verdict: StructuredJudgeVerdict,
  route: ModelCandidate,
): boolean {
  return (
    verdict?.judgeBackend === route.backend &&
    verdict.judgeProvider === route.provider &&
    verdict.judgeFamily === route.family &&
    verdict.judgeModelId === route.modelId &&
    (verdict.observedJudgeModel === route.modelId ||
      verdict.observedJudgeModel === "unknown")
  );
}

function hasRepeatFloor(
  comparison: EvaluationComparison,
  floor: number,
): boolean {
  return routeKeys.every((route) => {
    const indices = comparison.repeats[route].map(
      ({ repeatIndex }) => repeatIndex,
    );
    return (
      comparison.repeats[route].every(
        ({ fixtureId }) => fixtureId === comparison.fixtureId,
      ) &&
      indices.every((index) => Number.isSafeInteger(index) && index >= 0) &&
      new Set(indices).size >= floor
    );
  });
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
  const metadata = {
    evaluationId: input.evaluationId,
    role: input.role,
    candidate: input.candidate,
    incumbent: input.incumbent,
  };
  const candidateOption = blindCandidate(
    input.blindingSecret,
    input.evaluationId,
  );
  const comparisons: EvaluationComparison[] = [];
  const resultFor = (decision: PromotionDecision): EvaluationResult => ({
    ...metadata,
    candidateOption,
    decision,
    comparisons,
    repeats: {
      candidate: comparisons.flatMap(({ repeats }) => repeats.candidate),
      incumbent: comparisons.flatMap(({ repeats }) => repeats.incumbent),
    },
  });
  const routes = [input.candidate, input.incumbent];
  const fixedImplementer =
    input.role === "define" ? input.fixedImplementer : undefined;
  if (fixedImplementer) routes.push(fixedImplementer);
  assertNoSecretMaterial({ ...metadata, routes });

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
    return resultFor({ promote: false, reason: "judge-dependence" });
  }

  const initialHashes = await deps.runner.computeSuiteHashes();
  const suiteHashes: SuiteHashes = {
    fixtureSuiteHash: initialHashes.fixtureSuiteHash,
    workflowPromptHashes: { ...initialHashes.workflowPromptHashes },
  };
  const inputsAreCurrent = async () =>
    sameSuiteHashes(suiteHashes, await deps.runner.computeSuiteHashes());
  const suite = await deps.runner.loadSuite();
  const roleMap = new Map<string, readonly ModelRole[]>(
    suite.fixtures.map((f) => [f.id, f.roles]),
  );
  const directFixtures = new Set(
    input.fixtures
      .map(({ id }) => id)
      .filter((id) => roleMap.get(id)?.includes(input.role)),
  );
  if (directFixtures.size === 0) {
    return resultFor({ promote: false, reason: "insufficient-repeats" });
  }

  const handoffs = suite.handoffs.filter(({ planSource }) =>
    input.role === "define"
      ? planSource === "candidate"
      : input.role === "implement" && planSource === "fixed",
  );
  for (const { from, to } of handoffs) {
    if (
      !roleMap.get(from)?.includes("define") ||
      !roleMap.get(to)?.includes("implement")
    ) {
      throw new Error(
        `Handoff requires a define fixture and an implement fixture: ${from} to ${to}`,
      );
    }
    if (input.role === "define") directFixtures.add(from);
  }
  if (input.role === "define" && handoffs.length > 0) {
    if (!input.artifactRoot) {
      return resultFor({ promote: false, reason: "missing-handoff-artifacts" });
    }
    if (!fixedImplementer) {
      return resultFor({ promote: false, reason: "missing-fixed-implementer" });
    }
  }

  const repeatFloor = Math.max(3, suite.repeats);
  const repeatCount = input.repeats ?? repeatFloor;
  if (!Number.isSafeInteger(repeatCount) || repeatCount < 1) {
    return resultFor({ promote: false, reason: "insufficient-repeats" });
  }
  const definitions = new Map<string, ComparisonRepeats>();
  const artifactDir = (
    route: RouteKey,
    fixtureId: string,
    repeatIndex: number,
  ) =>
    input.artifactRoot
      ? `${input.artifactRoot}/${route}/${fixtureId}/repeat-${repeatIndex}`
      : undefined;

  const runRepeat = async (
    route: ModelCandidate,
    request: Omit<FixtureRepeatRequest, "route">,
  ) => {
    const { backend, modelId, effort } = route;
    const evidence = await deps.runner.runFixtureRepeat({
      ...request,
      route: { backend, modelId, effort },
    });
    assertNoSecretMaterial(evidence);
    const identityMatches =
      evidence.requestedModel === modelId &&
      (evidence.observedModel === "unknown" ||
        evidence.observedModel === modelId);
    return identityMatches
      ? evidence
      : {
          ...evidence,
          deterministicGatesPassed: false,
          gateChecks: [
            ...evidence.gateChecks,
            {
              checkId: "fixture-route-identity",
              passed: false,
              detail:
                "Repeat model identity does not match the dispatched route",
            },
          ],
        };
  };

  for (const fixtureId of directFixtures) {
    const repeats = { candidate: [], incumbent: [] } as Record<
      RouteKey,
      FixtureRepeatEvidence[]
    >;
    for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
      for (const route of routeKeys) {
        const artifactOutputDir =
          input.role === "define"
            ? artifactDir(route, fixtureId, repeatIndex)
            : undefined;
        repeats[route].push(
          await runRepeat(input[route], {
            fixtureId,
            role: input.role,
            repeatIndex,
            ...(artifactOutputDir ? { artifactOutputDir } : {}),
          }),
        );
      }
    }
    comparisons.push({
      fixtureId,
      repeats,
      roleScore: scoreRole(input.role, repeats.candidate, repeats.incumbent),
    });
    if (input.role === "define") definitions.set(fixtureId, repeats);
  }

  for (const handoff of handoffs) {
    const { from, to: fixtureId, planSource } = handoff;
    const repeats = { candidate: [], incumbent: [] } as Record<
      RouteKey,
      FixtureRepeatEvidence[]
    >;
    const prerequisite = definitions.get(from);
    for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
      for (const route of routeKeys) {
        if (planSource === "candidate") {
          if (
            !fixedImplementer ||
            !prerequisite?.[route][repeatIndex]?.deterministicGatesPassed
          )
            continue;
          repeats[route].push(
            await runRepeat(fixedImplementer, {
              fixtureId,
              role: "implement",
              repeatIndex,
              handoffArtifactDir: artifactDir(route, from, repeatIndex),
            }),
          );
        } else {
          repeats[route].push(
            await runRepeat(input[route], {
              fixtureId,
              role: "implement",
              repeatIndex,
            }),
          );
        }
      }
    }
    if (planSource === "candidate") {
      const rate = (route: RouteKey) =>
        repeatCount > 0
          ? repeats[route].filter(
              ({ deterministicGatesPassed }) => deterministicGatesPassed,
            ).length / repeatCount
          : 0;
      comparisons.push({
        fixtureId,
        handoff,
        repeats,
        gatePassRate: {
          candidate: rate("candidate"),
          incumbent: rate("incumbent"),
        },
      });
    } else {
      comparisons.push({
        fixtureId,
        handoff,
        repeats,
        roleScore: scoreRole("implement", repeats.candidate, repeats.incumbent),
      });
    }
  }

  const direct = comparisons.filter(({ handoff }) => !handoff);
  const fixed = comparisons.filter(
    ({ handoff }) => handoff?.planSource === "fixed",
  );
  const scoringComparisons = fixed.length > 0 ? fixed : direct;
  const roleScore =
    input.role === "implement"
      ? scoringComparisons.length === 1
        ? scoringComparisons[0].roleScore
        : undefined
      : scoreRole(
          input.role,
          direct.flatMap(({ repeats }) => repeats.candidate),
          direct.flatMap(({ repeats }) => repeats.incumbent),
        );
  const reject = (
    reason: Extract<PromotionDecision, { promote: false }>["reason"],
  ): EvaluationResult => ({
    ...resultFor({ promote: false, reason }),
    roleScore,
  });

  if (!(await inputsAreCurrent())) return reject("stale-evaluation-inputs");
  const routeMismatch = comparisons.some(({ repeats }) =>
    routeKeys.some((route) =>
      repeats[route].some(({ gateChecks }) =>
        gateChecks.some(
          ({ checkId, passed }) =>
            checkId === "fixture-route-identity" && !passed,
        ),
      ),
    ),
  );
  if (
    routeMismatch ||
    comparisons.some(({ repeats }) =>
      [
        ...repeats.candidate,
        ...(input.role === "implement" ? repeats.incumbent : []),
      ].some(
        ({ deterministicGatesPassed, gateChecks }) =>
          !deterministicGatesPassed ||
          gateChecks.length === 0 ||
          gateChecks.some(({ passed }) => !passed),
      ),
    )
  ) {
    return reject("gate-failure");
  }
  if (
    !comparisons.every((comparison) => hasRepeatFloor(comparison, repeatFloor))
  ) {
    return reject("insufficient-repeats");
  }

  const left = candidateOption === "A" ? "candidate" : "incumbent";
  const right = candidateOption === "A" ? "incumbent" : "candidate";
  const allRepeats = comparisons.flatMap(({ repeats }) => [
    ...repeats.candidate,
    ...repeats.incumbent,
  ]);
  const observedModels = allRepeats.map(({ observedModel }) => observedModel);
  const redact = (text: string) =>
    sanitizeIdentityText(text, routes, observedModels);
  const inputArtifacts: { ref: string; path: string; content: string }[] = [];
  const gateArtifacts: {
    ref: string;
    checkId: string;
    passed: boolean;
    detail: string;
  }[] = [];
  for (const [index, { repeats }] of comparisons.entries()) {
    for (const [option, route] of [
      ["A", left],
      ["B", right],
    ] as const) {
      for (const { repeatIndex, fixtureInputs, gateChecks } of repeats[route]) {
        const scope = `${index + 1}:${option}:${repeatIndex}`;
        for (const [ordinal, [path, content]] of Object.entries(
          fixtureInputs,
        ).entries()) {
          inputArtifacts.push({
            ref: `input:${scope}:${ordinal + 1}`,
            path: redact(path),
            content: redact(content),
          });
        }
        for (const [
          ordinal,
          { checkId, passed, detail },
        ] of gateChecks.entries()) {
          gateArtifacts.push({
            ref: `gate:${scope}:${ordinal + 1}`,
            checkId: redact(checkId),
            passed,
            detail: redact(detail),
          });
        }
      }
    }
  }
  const comparisonLabels = comparisons.map(({ fixtureId, handoff }, index) => {
    const description =
      handoff?.planSource === "candidate"
        ? `Generated plan ${handoff.from} to ${fixtureId}`
        : handoff
          ? `Fixed plan ${fixtureId}`
          : fixtureId;
    return `Comparison ${index + 1}: ${redact(description)}`;
  });
  const outputFor = (route: RouteKey) =>
    comparisons
      .map((comparison, index) =>
        [
          comparisonLabels[index],
          ...comparison.repeats[route].map(
            ({ repeatIndex, sanitizedOutput }) =>
              `Repeat ${repeatIndex}\n${redact(sanitizedOutput)}`,
          ),
        ].join("\n\n"),
      )
      .join("\n\n");
  const outputs = { optionA: outputFor(left), optionB: outputFor(right) };
  const gateSummaries = comparisons.map(
    ({ gatePassRate, roleScore, repeats }, index) => {
      const label = comparisonLabels[index];
      if (gatePassRate) {
        return `${label}: Option A gate pass rate ${gatePassRate[left]}, Option B gate pass rate ${gatePassRate[right]}`;
      }
      if (roleScore?.role === "implement") {
        const times = {
          candidate: roleScore.candidateMedianMsToGreen,
          incumbent: roleScore.incumbentMedianMsToGreen,
        };
        const time = (route: RouteKey) =>
          times[route] === null
            ? "no green repeats"
            : `${times[route]}ms to green`;
        return `${label}: Option A ${time(left)}, Option B ${time(right)}`;
      }
      const coverage = (route: RouteKey) => {
        const score = scoreRole(input.role, repeats[route], []);
        return "coverage" in score ? score.coverage : 0;
      };
      return `${label}: Option A coverage ${coverage(left)}, Option B coverage ${coverage(right)}`;
    },
  );

  const packet: JudgeVerdictPacket = {
    comparisonId: redact(input.evaluationId),
    role: input.role,
    fixtureSummary: [
      ...comparisonLabels,
      "Fixture input artifacts:",
      ...inputArtifacts.map((artifact) => JSON.stringify(artifact)),
    ].join("\n"),
    ...outputs,
    gateEvidenceSummary: [
      ...gateSummaries,
      "Gate result artifacts:",
      ...gateArtifacts.map((artifact) => JSON.stringify(artifact)),
    ].join("\n"),
  };

  assertNoSecretMaterial(packet);
  const verdict1 = await deps.judge.judgeComparison(input.judges[0], packet);
  if (!matchesJudgeRoute(verdict1, input.judges[0]))
    return reject("judge-dependence");
  assertNoSecretMaterial(packet);
  const verdict2 = await deps.judge.judgeComparison(input.judges[1], packet);
  if (!matchesJudgeRoute(verdict2, input.judges[1]))
    return reject("judge-dependence");
  assertNoSecretMaterial([verdict1, verdict2]);
  if (!(await inputsAreCurrent())) return reject("stale-evaluation-inputs");

  const comparisonKeys = comparisons.map((_, index) => String(index));
  let decision = evaluateModelPromotion({
    candidateOption,
    requiredFixtures: comparisonKeys,
    repeats: comparisons.flatMap(({ repeats }, index) =>
      repeats.candidate.map((repeat) => ({
        fixtureId: comparisonKeys[index],
        repeatIndex: repeat.repeatIndex,
        gatesPassed: repeat.deterministicGatesPassed,
      })),
    ),
    judges: [verdict1, verdict2],
    refs: {
      input: inputArtifacts.map(({ ref }) => ref),
      output: Object.keys(outputs),
      gate: gateArtifacts.map(({ ref }) => ref),
    },
  });

  if (
    decision.promote &&
    input.role === "implement" &&
    !scoringComparisons.every(({ roleScore }) => {
      if (roleScore?.role !== "implement") return false;
      const { candidateMedianMsToGreen, incumbentMedianMsToGreen } = roleScore;
      return (
        candidateMedianMsToGreen !== null &&
        incumbentMedianMsToGreen !== null &&
        Number.isFinite(candidateMedianMsToGreen) &&
        Number.isFinite(incumbentMedianMsToGreen) &&
        candidateMedianMsToGreen < incumbentMedianMsToGreen
      );
    })
  ) {
    decision = { promote: false, reason: "implementation-not-faster" };
  }

  const judgeVerdictHashes: [string, string] = [
    createHash("sha256").update(JSON.stringify(verdict1)).digest("hex"),
    createHash("sha256").update(JSON.stringify(verdict2)).digest("hex"),
  ];

  const result: EvaluationResult = {
    ...resultFor(decision),
    roleScore,
    judges: [verdict1, verdict2],
    suiteHashes,
    judgeVerdictHashes,
  };

  assertNoSecretMaterial(result);
  return result;
}
