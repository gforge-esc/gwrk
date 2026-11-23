/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import {
  type ModelCandidate,
  type ModelRole,
  type RunnerScope,
  type ScoredRepeat,
  assertNoSecretMaterial,
  checkCandidate,
  eligibleRoutesDigest,
  qualificationStaleness,
  scoreRole,
} from "../../domain/model-qualification.js";
import type {
  QualificationRunnerPort,
  RouteLockStorePort,
} from "../../ports/model-qualification-port.js";
import {
  type PromotionReplayEvidence,
  evaluateModelPromotion,
} from "./evaluate-models.js";

export interface PinnedRoleRoute {
  readonly role: "define" | "implement" | "review" | "judge";
  readonly routeMode: "pinned" | "provider-default";
  readonly backend: string;
  readonly provider: string;
  readonly family: string;
  readonly modelId: string;
  readonly effort?: string;
  readonly fallbackRoutes: readonly {
    readonly backend: string;
    readonly provider: string;
    readonly family: string;
    readonly modelId: string;
    readonly effort?: string;
    readonly evaluationId: string;
  }[];
  readonly toolVersions: {
    readonly cliVersion: string;
    readonly adapterVersion: string;
  };
  readonly evidence: {
    readonly evaluationId: string;
    readonly snapshotHash: string;
    readonly evaluationBundleHash: string;
    readonly fixtureSuiteHash: string;
    readonly workflowPromptHashes: Record<string, string>;
    readonly judgeVerdictHashes: readonly [string, string];
  };
}

export interface RouteLockDocument {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly runnerProfile: string;
  readonly updatedAt: string;
  readonly routes: Partial<
    Record<"define" | "implement" | "review", PinnedRoleRoute>
  >;
  readonly judges?: readonly [PinnedRoleRoute, PinnedRoleRoute];
  readonly previousLock?: Omit<RouteLockDocument, "previousLock">;
}

export interface PromoteModelDeps {
  readonly store: RouteLockStorePort;
  readonly runner: QualificationRunnerPort;
}

export interface PromoteModelInput {
  readonly scope: RunnerScope;
  readonly evaluationId: string;
  readonly bundle?: unknown;
  readonly nowIso?: string;
}

export type PromoteModelResult =
  | {
      readonly promote: true;
      readonly digest: string;
      readonly document: RouteLockDocument;
    }
  | { readonly promote: false; readonly reason: string };

interface BundleRepeat {
  readonly fixtureId?: string;
  readonly repeatIndex: number;
  readonly durationMs?: number;
  readonly deterministicGatesPassed?: boolean;
  readonly gateChecks?: readonly {
    readonly checkId: string;
    readonly passed: boolean;
    readonly detail: string;
  }[];
}

interface BundleComparison {
  readonly fixtureId?: string;
  readonly handoff?: {
    readonly from: string;
    readonly to: string;
    readonly planSource: "candidate" | "fixed";
  };
  readonly repeats: {
    readonly candidate: readonly BundleRepeat[];
    readonly incumbent: readonly BundleRepeat[];
  };
  readonly skippedIncumbentRepeatIndices?: readonly number[];
  readonly roleScore?: {
    readonly role: ModelRole;
    readonly candidateMedianMsToGreen?: number | null;
    readonly incumbentMedianMsToGreen?: number | null;
  };
}

interface EvaluationBundlePayload {
  readonly evaluationId: string;
  readonly role: ModelRole;
  readonly candidate: ModelCandidate;
  readonly incumbent?: ModelCandidate;
  readonly scope: RunnerScope;
  readonly snapshotHash?: string;
  readonly eligibleRoutesDigest?: string;
  readonly toolVersions?: {
    readonly cliVersion: string;
    readonly adapterVersion: string;
  };
  readonly suiteHashes?: {
    readonly fixtureSuiteHash: string;
    readonly workflowPromptHashes: Record<string, string>;
  };
  readonly judgeVerdictHashes?: readonly [string, string];
  readonly incumbentDigest: string | null;
  readonly promotionEvidence?: PromotionReplayEvidence;
  readonly comparisons?: readonly BundleComparison[];
  readonly fallbackRoutes?: PinnedRoleRoute["fallbackRoutes"];
}

const VALID_ROLES = new Set<ModelRole>(["define", "implement", "review"]);
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

function isPassingGateRepeat(repeat: BundleRepeat | null | undefined): boolean {
  return (
    repeat?.deterministicGatesPassed === true &&
    Array.isArray(repeat.gateChecks) &&
    repeat.gateChecks.length > 0 &&
    repeat.gateChecks.every((gc) => gc?.passed === true)
  );
}

function validateRepeatSet(
  repeats: readonly BundleRepeat[] | undefined,
  expectedFixtureId: string,
  repeatFloor: number,
  options: {
    readonly requirePassingGates: boolean;
    readonly skippedIndices?: readonly number[];
  },
): "ok" | "insufficient-repeats" | "gate-failure" {
  if (!Array.isArray(repeats)) return "insufficient-repeats";
  const indices: number[] = [];
  for (const repeat of repeats) {
    if (
      !repeat ||
      repeat.fixtureId !== expectedFixtureId ||
      !Number.isSafeInteger(repeat.repeatIndex) ||
      repeat.repeatIndex < 0
    ) {
      return "insufficient-repeats";
    }
    indices.push(repeat.repeatIndex);
  }
  if (options.skippedIndices) {
    if (!Array.isArray(options.skippedIndices)) return "insufficient-repeats";
    for (const skipped of options.skippedIndices) {
      if (!Number.isSafeInteger(skipped) || skipped < 0) {
        return "insufficient-repeats";
      }
      indices.push(skipped);
    }
  }
  const distinct = new Set(indices);
  if (distinct.size !== indices.length || distinct.size < repeatFloor) {
    return "insufficient-repeats";
  }
  if (
    options.requirePassingGates &&
    !repeats.every((repeat) => isPassingGateRepeat(repeat))
  ) {
    return "gate-failure";
  }
  return "ok";
}

function toScoredRepeats(
  repeats: readonly BundleRepeat[],
): ScoredRepeat[] | null {
  const scored: ScoredRepeat[] = [];
  for (const repeat of repeats) {
    if (
      typeof repeat.durationMs !== "number" ||
      !Number.isFinite(repeat.durationMs) ||
      repeat.durationMs < 0 ||
      typeof repeat.deterministicGatesPassed !== "boolean" ||
      !Array.isArray(repeat.gateChecks)
    ) {
      return null;
    }
    scored.push({
      durationMs: repeat.durationMs,
      deterministicGatesPassed: repeat.deterministicGatesPassed,
      gateChecks: repeat.gateChecks,
    });
  }
  return scored;
}

function matchesIncumbentPin(
  incumbent: ModelCandidate | undefined,
  pin: PinnedRoleRoute,
): boolean {
  if (!incumbent) return false;
  return (
    incumbent.backend === pin.backend &&
    incumbent.provider === pin.provider &&
    incumbent.family === pin.family &&
    incumbent.modelId === pin.modelId &&
    (incumbent.effort || undefined) === (pin.effort || undefined)
  );
}

export async function promoteModel(
  deps: PromoteModelDeps,
  input: PromoteModelInput,
): Promise<PromoteModelResult> {
  assertNoSecretMaterial(input);

  let rawBundle = input.bundle;
  if (!rawBundle) {
    try {
      rawBundle = await deps.store.readEvaluationBundle(input.evaluationId);
    } catch {
      return { promote: false, reason: "evaluation-bundle-not-found" };
    }
  }

  if (!rawBundle || typeof rawBundle !== "object") {
    return { promote: false, reason: "invalid-evaluation-evidence" };
  }

  assertNoSecretMaterial(rawBundle);
  const bundle = rawBundle as EvaluationBundlePayload;

  if (bundle.evaluationId !== input.evaluationId) {
    return { promote: false, reason: "evaluation-id-mismatch" };
  }

  if (!VALID_ROLES.has(bundle.role)) {
    return { promote: false, reason: "invalid-evaluation-evidence" };
  }

  if (
    !bundle.scope ||
    bundle.scope.workspaceId !== input.scope.workspaceId ||
    bundle.scope.runnerProfile !== input.scope.runnerProfile ||
    bundle.scope.platform !== input.scope.platform ||
    bundle.scope.arch !== input.scope.arch
  ) {
    return { promote: false, reason: "runner-mismatch" };
  }

  const snapshot = await deps.store.readDiscoverySnapshot(input.scope);
  if (!snapshot) {
    return { promote: false, reason: "model-unavailable" };
  }
  assertNoSecretMaterial(snapshot);

  const candidateCheck = checkCandidate(
    snapshot,
    input.scope,
    bundle.candidate,
  );
  if (!candidateCheck.ok) {
    return { promote: false, reason: candidateCheck.reason };
  }

  const currentHashes = await deps.runner.computeSuiteHashes();
  if (
    !bundle.suiteHashes ||
    bundle.suiteHashes.fixtureSuiteHash !== currentHashes.fixtureSuiteHash ||
    !bundle.suiteHashes.workflowPromptHashes ||
    Object.keys(bundle.suiteHashes.workflowPromptHashes).length !==
      Object.keys(currentHashes.workflowPromptHashes).length ||
    Object.entries(bundle.suiteHashes.workflowPromptHashes).some(
      ([wf, hash]) => currentHashes.workflowPromptHashes[wf] !== hash,
    )
  ) {
    return { promote: false, reason: "stale-evaluation-inputs" };
  }

  const activeLock = await deps.store.readRouteLock(input.scope);
  const currentIncumbentDigest = activeLock?.digest ?? null;
  if (bundle.incumbentDigest !== currentIncumbentDigest) {
    return { promote: false, reason: "incumbent-changed" };
  }

  const activeDoc = activeLock?.document as RouteLockDocument | undefined;
  const incumbentPin = activeDoc?.routes?.[bundle.role];
  if (incumbentPin && !matchesIncumbentPin(bundle.incumbent, incumbentPin)) {
    return { promote: false, reason: "incumbent-changed" };
  }

  if (!bundle.promotionEvidence) {
    return { promote: false, reason: "invalid-evaluation-evidence" };
  }

  const replayDecision = evaluateModelPromotion(bundle.promotionEvidence);
  if (!replayDecision.promote) {
    return { promote: false, reason: replayDecision.reason };
  }

  if (
    !Array.isArray(bundle.judgeVerdictHashes) ||
    bundle.judgeVerdictHashes.length !== 2 ||
    !Array.isArray(bundle.promotionEvidence.judges) ||
    bundle.promotionEvidence.judges.length !== 2
  ) {
    return { promote: false, reason: "invalid-evaluation-evidence" };
  }
  const expectedVerdictHashes: [string, string] = [
    createHash("sha256")
      .update(JSON.stringify(bundle.promotionEvidence.judges[0]))
      .digest("hex"),
    createHash("sha256")
      .update(JSON.stringify(bundle.promotionEvidence.judges[1]))
      .digest("hex"),
  ];
  if (
    bundle.judgeVerdictHashes[0] !== expectedVerdictHashes[0] ||
    bundle.judgeVerdictHashes[1] !== expectedVerdictHashes[1]
  ) {
    return { promote: false, reason: "invalid-evaluation-evidence" };
  }

  const suite = await deps.runner.loadSuite();
  const repeatFloor = Math.max(3, suite.repeats);
  if (!Array.isArray(bundle.comparisons) || bundle.comparisons.length === 0) {
    return { promote: false, reason: "invalid-evaluation-evidence" };
  }
  const comparisons: readonly BundleComparison[] = bundle.comparisons;

  const requiredHandoffs = suite.handoffs.filter(({ planSource }) =>
    bundle.role === "define"
      ? planSource === "candidate"
      : bundle.role === "implement" && planSource === "fixed",
  );

  for (const handoff of requiredHandoffs) {
    const matching = comparisons.find(
      (c) =>
        c.handoff?.from === handoff.from &&
        c.handoff?.to === handoff.to &&
        c.handoff?.planSource === handoff.planSource &&
        c.fixtureId === handoff.to,
    );
    if (!matching) {
      return { promote: false, reason: "missing-handoff-artifacts" };
    }
    const candidateStatus = validateRepeatSet(
      matching.repeats?.candidate,
      handoff.to,
      repeatFloor,
      { requirePassingGates: true },
    );
    if (candidateStatus !== "ok") {
      return { promote: false, reason: candidateStatus };
    }
    const incumbentStatus = validateRepeatSet(
      matching.repeats?.incumbent,
      handoff.to,
      repeatFloor,
      {
        requirePassingGates: bundle.role === "implement",
        skippedIndices:
          handoff.planSource === "candidate"
            ? matching.skippedIncumbentRepeatIndices
            : undefined,
      },
    );
    if (incumbentStatus !== "ok") {
      return { promote: false, reason: incumbentStatus };
    }
  }

  if (bundle.role === "implement") {
    const direct = comparisons.filter(({ handoff }) => !handoff);
    const fixed = comparisons.filter(
      ({ handoff }) => handoff?.planSource === "fixed",
    );
    const scoringComparisons = requiredHandoffs.length > 0 ? fixed : direct;
    if (scoringComparisons.length === 0) {
      return { promote: false, reason: "invalid-evaluation-evidence" };
    }

    for (const comparison of scoringComparisons) {
      if (!comparison.fixtureId) {
        return { promote: false, reason: "invalid-evaluation-evidence" };
      }
      const candStatus = validateRepeatSet(
        comparison.repeats?.candidate,
        comparison.fixtureId,
        repeatFloor,
        { requirePassingGates: true },
      );
      if (candStatus !== "ok") {
        return { promote: false, reason: candStatus };
      }
      const incStatus = validateRepeatSet(
        comparison.repeats?.incumbent,
        comparison.fixtureId,
        repeatFloor,
        { requirePassingGates: true },
      );
      if (incStatus !== "ok") {
        return { promote: false, reason: incStatus };
      }
      const candidateScored = toScoredRepeats(comparison.repeats.candidate);
      const incumbentScored = toScoredRepeats(comparison.repeats.incumbent);
      if (!candidateScored || !incumbentScored) {
        return { promote: false, reason: "implementation-not-faster" };
      }
      const recomputed = scoreRole(
        "implement",
        candidateScored,
        incumbentScored,
      );
      if (
        recomputed.role !== "implement" ||
        recomputed.candidateMedianMsToGreen === null ||
        recomputed.incumbentMedianMsToGreen === null ||
        !Number.isFinite(recomputed.candidateMedianMsToGreen) ||
        !Number.isFinite(recomputed.incumbentMedianMsToGreen) ||
        recomputed.candidateMedianMsToGreen < 0 ||
        recomputed.incumbentMedianMsToGreen < 0 ||
        recomputed.candidateMedianMsToGreen >=
          recomputed.incumbentMedianMsToGreen
      ) {
        return { promote: false, reason: "implementation-not-faster" };
      }
    }
  }

  const requiredDirectFixtures = suite.fixtures.filter((f) =>
    f.roles.includes(bundle.role),
  );
  if (requiredDirectFixtures.length === 0) {
    return { promote: false, reason: "invalid-evaluation-evidence" };
  }
  for (const fixture of requiredDirectFixtures) {
    const matching = comparisons.find(
      (c) => !c.handoff && c.fixtureId === fixture.id,
    );
    if (!matching) {
      return { promote: false, reason: "insufficient-repeats" };
    }
    const candidateStatus = validateRepeatSet(
      matching.repeats?.candidate,
      fixture.id,
      repeatFloor,
      { requirePassingGates: true },
    );
    if (candidateStatus !== "ok") {
      return { promote: false, reason: candidateStatus };
    }
    const incumbentStatus = validateRepeatSet(
      matching.repeats?.incumbent,
      fixture.id,
      repeatFloor,
      { requirePassingGates: bundle.role === "implement" },
    );
    if (incumbentStatus !== "ok") {
      return { promote: false, reason: incumbentStatus };
    }
  }

  if (bundle.promotionEvidence.requiredFixtures.length !== comparisons.length) {
    return { promote: false, reason: "invalid-evaluation-evidence" };
  }
  const requiredKeySet = new Set(bundle.promotionEvidence.requiredFixtures);
  if (
    requiredKeySet.size !== comparisons.length ||
    bundle.promotionEvidence.repeats.some(
      (r) => !requiredKeySet.has(r.fixtureId),
    )
  ) {
    return { promote: false, reason: "invalid-evaluation-evidence" };
  }
  for (let i = 0; i < comparisons.length; i += 1) {
    const comparison = comparisons[i];
    if (!comparison.fixtureId) {
      return { promote: false, reason: "invalid-evaluation-evidence" };
    }
    const compCandStatus = validateRepeatSet(
      comparison.repeats?.candidate,
      comparison.fixtureId,
      repeatFloor,
      { requirePassingGates: true },
    );
    if (compCandStatus !== "ok") {
      return { promote: false, reason: compCandStatus };
    }
    const evidenceKey = bundle.promotionEvidence.requiredFixtures[i];
    const evidenceRepeats = bundle.promotionEvidence.repeats.filter(
      (r) => r.fixtureId === evidenceKey,
    );
    const compIndices = comparison.repeats.candidate
      .map((r) => r.repeatIndex)
      .sort((a, b) => a - b);
    const evIndices = evidenceRepeats
      .map((r) => r.repeatIndex)
      .sort((a, b) => a - b);
    if (
      compIndices.length !== evIndices.length ||
      compIndices.some((idx, pos) => evIndices[pos] !== idx)
    ) {
      return { promote: false, reason: "invalid-evaluation-evidence" };
    }
  }

  const currentSnapshotHash = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
  const currentEligibleDigest = eligibleRoutesDigest(snapshot, input.scope);
  const adapterReport = snapshot.adapters.find(
    (a) => a.backend === bundle.candidate.backend,
  );
  const currentToolVersions = {
    cliVersion: adapterReport?.cliVersion || "",
    adapterVersion: adapterReport?.adapterVersion || "",
  };

  if (
    typeof bundle.snapshotHash !== "string" ||
    !SHA256_HEX_RE.test(bundle.snapshotHash) ||
    typeof bundle.eligibleRoutesDigest !== "string" ||
    !SHA256_HEX_RE.test(bundle.eligibleRoutesDigest) ||
    !bundle.toolVersions ||
    typeof bundle.toolVersions.cliVersion !== "string" ||
    !bundle.toolVersions.cliVersion.trim() ||
    typeof bundle.toolVersions.adapterVersion !== "string" ||
    !bundle.toolVersions.adapterVersion.trim()
  ) {
    return { promote: false, reason: "stale-evaluation-inputs" };
  }

  const stalenessReasons = qualificationStaleness(
    {
      fixtureSuiteHash: bundle.suiteHashes.fixtureSuiteHash,
      workflowPromptHashes: bundle.suiteHashes.workflowPromptHashes,
      cliVersion: bundle.toolVersions.cliVersion,
      adapterVersion: bundle.toolVersions.adapterVersion,
      eligibleRoutesDigest: bundle.eligibleRoutesDigest,
    },
    {
      fixtureSuiteHash: currentHashes.fixtureSuiteHash,
      workflowPromptHashes: currentHashes.workflowPromptHashes,
      cliVersion: currentToolVersions.cliVersion,
      adapterVersion: currentToolVersions.adapterVersion,
      eligibleRoutesDigest: currentEligibleDigest,
    },
    candidateCheck.ok,
  );
  if (
    stalenessReasons.length > 0 ||
    bundle.snapshotHash !== currentSnapshotHash
  ) {
    return {
      promote: false,
      reason: stalenessReasons[0] ?? "stale-evaluation-inputs",
    };
  }

  const snapshotHash = bundle.snapshotHash;
  const toolVersions = {
    cliVersion: bundle.toolVersions.cliVersion,
    adapterVersion: bundle.toolVersions.adapterVersion,
  };

  const fallbackRoutes: Array<{
    backend: string;
    provider: string;
    family: string;
    modelId: string;
    effort?: string;
    evaluationId: string;
  }> = [];

  if (incumbentPin?.evidence?.evaluationId) {
    fallbackRoutes.push({
      backend: incumbentPin.backend,
      provider: incumbentPin.provider,
      family: incumbentPin.family,
      modelId: incumbentPin.modelId,
      ...(incumbentPin.effort ? { effort: incumbentPin.effort } : {}),
      evaluationId: incumbentPin.evidence.evaluationId,
    });
  }

  if (Array.isArray(incumbentPin?.fallbackRoutes)) {
    for (const fb of incumbentPin.fallbackRoutes) {
      if (
        !fallbackRoutes.some(
          (r) =>
            r.backend === fb.backend &&
            r.modelId === fb.modelId &&
            r.effort === fb.effort &&
            r.evaluationId === fb.evaluationId,
        )
      ) {
        fallbackRoutes.push(fb);
      }
    }
  }

  const finalFallbacks = fallbackRoutes.filter(
    (r) =>
      !(
        r.backend === bundle.candidate.backend &&
        r.modelId === bundle.candidate.modelId &&
        (r.effort || undefined) === (bundle.candidate.effort || undefined)
      ),
  );

  const evaluationBundleHash = createHash("sha256")
    .update(JSON.stringify(rawBundle))
    .digest("hex");

  const newPin: PinnedRoleRoute = {
    role: bundle.role,
    routeMode: "pinned",
    backend: bundle.candidate.backend,
    provider: bundle.candidate.provider,
    family: bundle.candidate.family,
    modelId: bundle.candidate.modelId,
    ...(bundle.candidate.effort ? { effort: bundle.candidate.effort } : {}),
    fallbackRoutes: finalFallbacks,
    toolVersions,
    evidence: {
      evaluationId: bundle.evaluationId,
      snapshotHash,
      evaluationBundleHash,
      fixtureSuiteHash: bundle.suiteHashes.fixtureSuiteHash,
      workflowPromptHashes: bundle.suiteHashes.workflowPromptHashes,
      judgeVerdictHashes: bundle.judgeVerdictHashes,
    },
  };

  const nowIso = input.nowIso ?? new Date().toISOString();
  let previousLock: Omit<RouteLockDocument, "previousLock"> | undefined;
  if (activeDoc) {
    const { previousLock: _discard, ...base } = activeDoc;
    previousLock = base;
  }

  const newDocument: RouteLockDocument = {
    schemaVersion: 1,
    workspaceId: input.scope.workspaceId,
    runnerProfile: input.scope.runnerProfile,
    updatedAt: nowIso,
    routes: {
      ...(activeDoc?.routes ?? {}),
      [bundle.role]: newPin,
    },
    ...(activeDoc?.judges ? { judges: activeDoc.judges } : {}),
    ...(previousLock ? { previousLock } : {}),
  };

  assertNoSecretMaterial(newDocument);

  try {
    const newDigest = await deps.store.writeRouteLockAtomic(input.scope, {
      document: newDocument,
      expectedIncumbentDigest: currentIncumbentDigest,
    });
    return { promote: true, digest: newDigest, document: newDocument };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      error.message === "incumbent-changed"
    ) {
      return { promote: false, reason: "incumbent-changed" };
    }
    throw error;
  }
}

export async function rollbackRouteLock(
  deps: { readonly store: RouteLockStorePort },
  scope: RunnerScope,
): Promise<
  | {
      readonly ok: true;
      readonly digest: string;
      readonly document: RouteLockDocument;
    }
  | { readonly ok: false; readonly reason: string }
> {
  const activeLock = await deps.store.readRouteLock(scope);
  if (!activeLock) {
    return { ok: false, reason: "no-active-lock" };
  }

  const document = activeLock.document as RouteLockDocument;
  if (!document.previousLock) {
    return { ok: false, reason: "no-previous-lock" };
  }

  const previousDocument = document.previousLock as RouteLockDocument;
  assertNoSecretMaterial(previousDocument);

  try {
    const newDigest = await deps.store.writeRouteLockAtomic(scope, {
      document: previousDocument,
      expectedIncumbentDigest: activeLock.digest,
    });
    return { ok: true, digest: newDigest, document: previousDocument };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      error.message === "incumbent-changed"
    ) {
      return { ok: false, reason: "incumbent-changed" };
    }
    throw error;
  }
}
