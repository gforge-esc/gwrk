/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHmac } from "node:crypto";

export type ModelRole = "define" | "implement" | "review";
export type BlindedOption = "A" | "B";

export interface RunnerScope {
  readonly workspaceId: string;
  readonly runnerProfile: string;
  readonly platform: string;
  readonly arch: string;
}

export interface ModelCandidate {
  readonly backend: string;
  readonly provider: string;
  readonly family: string;
  readonly modelId: string;
  readonly effort?: string;
}

export interface DiscoveredModel extends Omit<ModelCandidate, "effort"> {
  readonly supportedEfforts: readonly string[];
  readonly isDefault: boolean;
  readonly hidden: boolean;
}

export interface AdapterDiscoveryReport {
  readonly backend: string;
  readonly status:
    | "available"
    | "auth_error"
    | "rate_limited"
    | "unavailable"
    | "unconfigured";
  readonly cliVersion: string;
  readonly adapterVersion: string;
  readonly supportsModelForwarding: boolean;
  readonly models: readonly DiscoveredModel[];
  readonly error?: string;
}

export interface DiscoverySnapshot {
  readonly scope: RunnerScope;
  readonly adapters: readonly AdapterDiscoveryReport[];
}

type CandidateCheck =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "runner-mismatch"
        | "model-alias"
        | "model-unavailable"
        | "effort-unavailable";
    };

export function isConcreteModel(modelId: string): boolean {
  return (
    typeof modelId === "string" &&
    modelId === modelId.trim() &&
    Boolean(modelId) &&
    !/^(auto|default|latest|unknown|opus|sonnet|haiku)$/i.test(modelId)
  );
}

function isCompleteRunnerScope(
  scope: RunnerScope | null | undefined,
): scope is RunnerScope {
  return (
    scope !== null &&
    scope !== undefined &&
    isNonBlankString(scope.workspaceId) &&
    isNonBlankString(scope.runnerProfile) &&
    isNonBlankString(scope.platform) &&
    isNonBlankString(scope.arch)
  );
}

export function checkCandidate(
  snapshot: DiscoverySnapshot,
  scope: RunnerScope,
  candidate: ModelCandidate,
): CandidateCheck {
  const snapshotScope = snapshot?.scope;
  if (
    !isCompleteRunnerScope(snapshotScope) ||
    !isCompleteRunnerScope(scope) ||
    snapshotScope.workspaceId !== scope.workspaceId ||
    snapshotScope.runnerProfile !== scope.runnerProfile ||
    snapshotScope.platform !== scope.platform ||
    snapshotScope.arch !== scope.arch
  ) {
    return { ok: false, reason: "runner-mismatch" };
  }
  if (!isNonBlankString(candidate?.backend))
    return { ok: false, reason: "model-unavailable" };
  if (!isConcreteModel(candidate.modelId))
    return { ok: false, reason: "model-alias" };
  if (
    !isNonBlankString(candidate.provider) ||
    !isNonBlankString(candidate.family) ||
    !Array.isArray(snapshot.adapters)
  )
    return { ok: false, reason: "model-unavailable" };
  const reports = snapshot.adapters.filter(
    (report) => report?.backend === candidate.backend,
  );
  const report: AdapterDiscoveryReport = reports[0];
  if (
    reports.length !== 1 ||
    report.status !== "available" ||
    report.supportsModelForwarding !== true ||
    !isNonBlankString(report.cliVersion) ||
    !isNonBlankString(report.adapterVersion) ||
    !Array.isArray(report.models)
  ) {
    return { ok: false, reason: "model-unavailable" };
  }
  const models: DiscoveredModel[] = report.models.filter(
    (model) =>
      model?.backend === candidate.backend &&
      model.modelId === candidate.modelId &&
      model.provider === candidate.provider &&
      model.family === candidate.family &&
      model.hidden === false,
  );
  if (models.length !== 1) return { ok: false, reason: "model-unavailable" };
  const { isDefault, supportedEfforts } = models[0];
  if (
    typeof isDefault !== "boolean" ||
    !Array.isArray(supportedEfforts) ||
    supportedEfforts.some((effort) => typeof effort !== "string")
  ) {
    return { ok: false, reason: "model-unavailable" };
  }
  if (
    candidate.effort !== undefined &&
    !supportedEfforts.includes(candidate.effort)
  ) {
    return { ok: false, reason: "effort-unavailable" };
  }
  return { ok: true };
}

export function blindCandidate(
  key: string,
  comparisonId: string,
): BlindedOption {
  if (!key || !comparisonId)
    throw new Error("Blinding requires a key and comparison identity.");
  const digest = createHmac("sha256", key).update(comparisonId).digest();
  return (digest[0] & 1) === 0 ? "A" : "B";
}

export interface JudgeVerdict {
  readonly judge: ModelCandidate;
  readonly observedJudgeModel: string;
  readonly winner: BlindedOption | "tie";
  readonly optionARegression: boolean;
  readonly optionBRegression: boolean;
  readonly scores: { readonly optionA: number; readonly optionB: number };
  readonly citations: readonly {
    readonly inputRef: string;
    readonly outputRef: string;
    readonly gateRef: string;
    readonly claim: string;
  }[];
}

export interface PromotionEvidence {
  readonly candidateOption: BlindedOption;
  readonly requiredFixtures: readonly string[];
  readonly repeats: readonly {
    readonly fixtureId: string;
    readonly repeatIndex: number;
    readonly gatesPassed: boolean;
  }[];
  readonly judges: readonly JudgeVerdict[];
  readonly refs: {
    readonly input: readonly string[];
    readonly output: readonly string[];
    readonly gate: readonly string[];
  };
}

export type PromotionDecision =
  | { promote: true }
  | {
      promote: false;
      reason:
        | "gate-failure"
        | "insufficient-repeats"
        | "judge-dependence"
        | "invalid-citations"
        | "judge-non-regression";
    };

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function evaluatePromotion(input: PromotionEvidence): PromotionDecision {
  if (input.candidateOption !== "A" && input.candidateOption !== "B")
    return { promote: false, reason: "judge-non-regression" };
  if (
    !Array.isArray(input.repeats) ||
    input.repeats.some((repeat) => repeat?.gatesPassed !== true)
  )
    return { promote: false, reason: "gate-failure" };
  if (
    !Array.isArray(input.requiredFixtures) ||
    input.requiredFixtures.length === 0 ||
    input.requiredFixtures.some((fixture) => !isNonBlankString(fixture)) ||
    input.repeats.some(
      (repeat) =>
        !isNonBlankString(repeat.fixtureId) ||
        !Number.isSafeInteger(repeat.repeatIndex) ||
        repeat.repeatIndex < 0,
    ) ||
    input.requiredFixtures.some((fixture) => {
      const indices = new Set(
        input.repeats
          .filter((repeat) => repeat.fixtureId === fixture)
          .map((repeat) => repeat.repeatIndex),
      );
      return indices.size < 3;
    })
  ) {
    return { promote: false, reason: "insufficient-repeats" };
  }

  if (!Array.isArray(input.judges) || input.judges.length !== 2)
    return { promote: false, reason: "judge-dependence" };
  const normalize = (value: unknown) =>
    typeof value === "string" ? value.trim().toLowerCase() : "";
  const providers = new Set(
    input.judges.map((verdict) => normalize(verdict?.judge?.provider)),
  );
  const families = new Set(
    input.judges.map((verdict) => normalize(verdict?.judge?.family)),
  );
  if (
    providers.size !== 2 ||
    families.size !== 2 ||
    providers.has("") ||
    families.has("") ||
    providers.has("unknown") ||
    families.has("unknown") ||
    input.judges.some(
      (verdict) =>
        !isNonBlankString(verdict?.judge?.backend) ||
        !isConcreteModel(verdict.judge.modelId) ||
        (verdict.observedJudgeModel !== "unknown" &&
          verdict.observedJudgeModel !== verdict.judge.modelId),
    )
  ) {
    return { promote: false, reason: "judge-dependence" };
  }
  const [firstJudge, secondJudge] = input.judges;
  if (
    firstJudge.judge.backend === secondJudge.judge.backend &&
    firstJudge.judge.modelId === secondJudge.judge.modelId
  ) {
    return { promote: false, reason: "judge-dependence" };
  }

  if (
    !Array.isArray(input.refs?.input) ||
    !Array.isArray(input.refs?.output) ||
    !Array.isArray(input.refs?.gate)
  )
    return { promote: false, reason: "invalid-citations" };
  const refs = {
    input: new Set(input.refs.input),
    output: new Set(input.refs.output),
    gate: new Set(input.refs.gate),
  };
  if (
    input.judges.some(
      (verdict) =>
        !Array.isArray(verdict.citations) ||
        verdict.citations.length === 0 ||
        verdict.citations.some(
          (citation: JudgeVerdict["citations"][number]) =>
            !isNonBlankString(citation?.claim) ||
            !isNonBlankString(citation.inputRef) ||
            !isNonBlankString(citation.outputRef) ||
            !isNonBlankString(citation.gateRef) ||
            !refs.input.has(citation.inputRef) ||
            !refs.output.has(citation.outputRef) ||
            !refs.gate.has(citation.gateRef),
        ),
    )
  ) {
    return { promote: false, reason: "invalid-citations" };
  }

  const validScore = (score: unknown) =>
    typeof score === "number" &&
    Number.isFinite(score) &&
    score >= 0 &&
    score <= 100;
  if (
    input.judges.some(
      (verdict) =>
        verdict.winner !== input.candidateOption ||
        typeof verdict.optionARegression !== "boolean" ||
        typeof verdict.optionBRegression !== "boolean" ||
        (input.candidateOption === "A"
          ? verdict.optionARegression
          : verdict.optionBRegression) !== false ||
        !validScore(verdict.scores?.optionA) ||
        !validScore(verdict.scores?.optionB),
    )
  ) {
    return { promote: false, reason: "judge-non-regression" };
  }
  return { promote: true };
}

export interface QualificationFingerprint {
  readonly fixtureSuiteHash: string;
  readonly workflowPromptHashes: Readonly<Record<string, string>>;
  readonly cliVersion: string;
  readonly adapterVersion: string;
}

type StalenessReason =
  | "fixtures-changed"
  | "prompts-changed"
  | "tools-changed"
  | "model-unavailable";

export function qualificationStaleness(
  pinned: QualificationFingerprint,
  current: QualificationFingerprint,
  modelAvailable: boolean,
): StalenessReason[] {
  const reasons: StalenessReason[] = [];
  if (pinned.fixtureSuiteHash !== current.fixtureSuiteHash)
    reasons.push("fixtures-changed");
  const promptNames = new Set([
    ...Object.keys(pinned.workflowPromptHashes),
    ...Object.keys(current.workflowPromptHashes),
  ]);
  if (
    [...promptNames].some(
      (name) =>
        pinned.workflowPromptHashes[name] !==
        current.workflowPromptHashes[name],
    )
  )
    reasons.push("prompts-changed");
  if (
    pinned.cliVersion !== current.cliVersion ||
    pinned.adapterVersion !== current.adapterVersion
  )
    reasons.push("tools-changed");
  if (!modelAvailable) reasons.push("model-unavailable");
  return reasons;
}

const secretPattern =
  /(?:^|[^a-z0-9])(?:bearer\s+[^\s"]+|sk-|AIza|gh[pousr]_|github_pat_|xox[baprs]-|xapp-)|[\w.+-]+@[\w.-]+\.[a-z]{2,}|"(?:authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|password)"\s*:/i;
const headerPattern = /\b(?:authorization|set-cookie|cookie)[ \t]*:/i;

export function assertNoSecretMaterial(
  value: unknown,
  knownSecrets: readonly string[] = [],
): void {
  let secretInText = false;
  const serialized =
    JSON.stringify(value, (key, entry: unknown) => {
      if (
        headerPattern.test(key) ||
        secretPattern.test(key) ||
        (typeof entry === "string" &&
          (headerPattern.test(entry) || secretPattern.test(entry)))
      ) {
        secretInText = true;
      }
      return entry;
    }) ?? "";
  if (
    secretInText ||
    secretPattern.test(serialized) ||
    knownSecrets.some(
      (secret) =>
        Boolean(secret) &&
        serialized.includes(JSON.stringify(secret).slice(1, -1)),
    )
  ) {
    throw new Error("Secret material found in model qualification evidence.");
  }
}
