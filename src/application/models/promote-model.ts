/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import {
  type ModelCandidate,
  type ModelRole,
  type RunnerScope,
  assertNoSecretMaterial,
  checkCandidate,
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

interface EvaluationBundlePayload {
  readonly evaluationId: string;
  readonly role: ModelRole;
  readonly candidate: ModelCandidate;
  readonly incumbent?: ModelCandidate;
  readonly scope: RunnerScope;
  readonly suiteHashes?: {
    readonly fixtureSuiteHash: string;
    readonly workflowPromptHashes: Record<string, string>;
  };
  readonly judgeVerdictHashes?: readonly [string, string];
  readonly incumbentDigest: string | null;
  readonly promotionEvidence?: PromotionReplayEvidence;
  readonly comparisons?: readonly {
    readonly fixtureId?: string;
    readonly handoff?: {
      readonly from: string;
      readonly to: string;
      readonly planSource: "candidate" | "fixed";
    };
    readonly repeats: {
      readonly candidate: readonly {
        readonly repeatIndex: number;
        readonly durationMs?: number;
        readonly deterministicGatesPassed?: boolean;
        readonly gateChecks?: readonly {
          readonly checkId: string;
          readonly passed: boolean;
          readonly detail: string;
        }[];
      }[];
      readonly incumbent: readonly {
        readonly repeatIndex: number;
        readonly durationMs?: number;
        readonly deterministicGatesPassed?: boolean;
      }[];
    };
    readonly roleScore?: {
      readonly role: ModelRole;
      readonly candidateMedianMsToGreen?: number | null;
      readonly incumbentMedianMsToGreen?: number | null;
    };
  }[];
  readonly fallbackRoutes?: PinnedRoleRoute["fallbackRoutes"];
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

  if (!bundle.promotionEvidence) {
    return { promote: false, reason: "invalid-evaluation-evidence" };
  }

  const replayDecision = evaluateModelPromotion(bundle.promotionEvidence);
  if (!replayDecision.promote) {
    return { promote: false, reason: replayDecision.reason };
  }

  if (bundle.role === "implement") {
    const comparisons = bundle.comparisons;
    if (!Array.isArray(comparisons) || comparisons.length === 0) {
      return { promote: false, reason: "invalid-evaluation-evidence" };
    }
    const direct = comparisons.filter(({ handoff }) => !handoff);
    const fixed = comparisons.filter(
      ({ handoff }) => handoff?.planSource === "fixed",
    );
    const scoringComparisons = fixed.length > 0 ? fixed : direct;

    const validDurations = scoringComparisons.every(
      ({ repeats, roleScore }) => {
        if (!repeats?.candidate || !repeats?.incumbent) return false;
        const validCandidates = repeats.candidate.every(
          ({ durationMs }: { readonly durationMs?: number }) =>
            typeof durationMs === "number" &&
            Number.isFinite(durationMs) &&
            durationMs >= 0,
        );
        const validIncumbents = repeats.incumbent.every(
          ({ durationMs }: { readonly durationMs?: number }) =>
            typeof durationMs === "number" &&
            Number.isFinite(durationMs) &&
            durationMs >= 0,
        );
        if (!validCandidates || !validIncumbents) return false;
        if (roleScore?.role !== "implement") return false;
        const { candidateMedianMsToGreen, incumbentMedianMsToGreen } =
          roleScore;
        return (
          candidateMedianMsToGreen !== null &&
          incumbentMedianMsToGreen !== null &&
          Number.isFinite(candidateMedianMsToGreen) &&
          Number.isFinite(incumbentMedianMsToGreen) &&
          candidateMedianMsToGreen >= 0 &&
          incumbentMedianMsToGreen >= 0 &&
          candidateMedianMsToGreen < incumbentMedianMsToGreen
        );
      },
    );

    if (!validDurations) {
      return { promote: false, reason: "implementation-not-faster" };
    }
  }

  const suite = await deps.runner.loadSuite();
  const requiredHandoffs = suite.handoffs.filter(({ planSource }) =>
    bundle.role === "define"
      ? planSource === "candidate"
      : bundle.role === "implement" && planSource === "fixed",
  );

  if (bundle.role === "define" && requiredHandoffs.length > 0) {
    const comparisons = bundle.comparisons;
    if (!Array.isArray(comparisons)) {
      return { promote: false, reason: "missing-handoff-artifacts" };
    }
    for (const handoff of requiredHandoffs) {
      const matching = comparisons.find(
        (c) =>
          c.handoff?.from === handoff.from &&
          c.handoff?.to === handoff.to &&
          c.handoff?.planSource === handoff.planSource,
      );
      if (!matching) {
        return { promote: false, reason: "missing-handoff-artifacts" };
      }
      if (
        !matching.repeats?.candidate ||
        matching.repeats.candidate.length < Math.max(3, suite.repeats)
      ) {
        return { promote: false, reason: "insufficient-repeats" };
      }
      const allPassed = matching.repeats.candidate.every(
        (r: {
          readonly deterministicGatesPassed?: boolean;
          readonly gateChecks?: readonly { readonly passed: boolean }[];
        }) =>
          r.deterministicGatesPassed === true &&
          Array.isArray(r.gateChecks) &&
          r.gateChecks.length > 0 &&
          r.gateChecks.every(
            (gc: { readonly passed: boolean }) => gc.passed === true,
          ),
      );
      if (!allPassed) {
        return { promote: false, reason: "gate-failure" };
      }
    }
  }

  if (
    !Array.isArray(bundle.judgeVerdictHashes) ||
    bundle.judgeVerdictHashes.length !== 2
  ) {
    return { promote: false, reason: "invalid-evaluation-evidence" };
  }

  const snapshotHash = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");

  const adapterReport = snapshot.adapters.find(
    (a) => a.backend === bundle.candidate.backend,
  );
  const toolVersions = {
    cliVersion: adapterReport?.cliVersion || "unknown",
    adapterVersion: adapterReport?.adapterVersion || "unknown",
  };

  const incumbentPin = (activeLock?.document as RouteLockDocument | undefined)
    ?.routes?.[bundle.role];

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
  const activeDoc = activeLock?.document as RouteLockDocument | undefined;
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
