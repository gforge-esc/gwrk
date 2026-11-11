/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import type {
  DeliveryRecipient,
  EnrolledProject,
  ProjectSlackBinding,
  SlackFeatureThread,
} from "./project-registry.js";

export interface HarvestSlackRecipient extends DeliveryRecipient {
  surface: "slack";
  workspaceId: string;
  channelId: string;
}

export function isHarvestSlackRecipient(
  recipient: DeliveryRecipient,
): recipient is HarvestSlackRecipient {
  return (
    recipient.surface === "slack" &&
    Boolean(recipient.workspaceId?.trim() && recipient.channelId?.trim())
  );
}

export function resolveHarvestSlackRecipient(input: {
  projectId: string;
  featureId: string;
  recipient: DeliveryRecipient | null;
  binding: ProjectSlackBinding | null;
  thread?: SlackFeatureThread;
}): HarvestSlackRecipient | null {
  const { projectId, featureId, recipient, binding, thread } = input;
  if (
    !binding ||
    recipient?.surface !== "slack" ||
    recipient.projectId !== projectId ||
    (recipient.workspaceId !== undefined &&
      recipient.workspaceId !== binding.workspaceId) ||
    (recipient.channelId !== undefined &&
      recipient.channelId !== binding.channelId)
  ) {
    return null;
  }
  const threadMatches =
    thread?.projectId === projectId &&
    thread.featureId === featureId &&
    thread.workspaceId === binding.workspaceId &&
    thread.channelId === binding.channelId;
  return {
    ...recipient,
    surface: "slack",
    workspaceId: binding.workspaceId,
    channelId: binding.channelId,
    threadTs: threadMatches
      ? thread.rootTs
      : recipient.channelId === binding.channelId
        ? recipient.threadTs
        : undefined,
  };
}

export const DeliverySourceSchema = z.enum([
  "github_webhook",
  "github_poller",
  "manual_cli",
]);
export type DeliverySource = z.infer<typeof DeliverySourceSchema>;

export const HarvestTerminalEventSchema = z.enum(["merged", "closed_unmerged"]);
export type HarvestTerminalEvent = z.infer<typeof HarvestTerminalEventSchema>;

export const HarvestStageNameSchema = z.enum([
  "git_sync",
  "gate_verify",
  "learning_record",
  "slack_delivery",
  "branch_cleanup",
]);
export type HarvestStageName = z.infer<typeof HarvestStageNameSchema>;

export const HarvestStageStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "gate_failed",
  "forecast_missing",
  "uncertain",
  "blocked_tip_mismatch",
  "skipped_no_target",
  "retryable_failure",
  "failed",
]);
export type HarvestStageStatus = z.infer<typeof HarvestStageStatusSchema>;

export const HarvestOperationStatusSchema = z.enum([
  "accepted",
  "running",
  "completed",
  "gate_failed",
  "delivery_pending",
  "cleanup_blocked",
  "closed_unmerged",
  "failed",
]);
export type HarvestOperationStatus = z.infer<
  typeof HarvestOperationStatusSchema
>;

export const OutboxStatusSchema = z.enum([
  "pending",
  "sending",
  "uncertain",
  "delivered",
  "skipped_no_target",
  "failed",
]);
export type OutboxStatus = z.infer<typeof OutboxStatusSchema>;

export interface HarvestCandidateInput {
  source: DeliverySource;
  deliveryId: string;
  repoSlug: string | null;
  /** Repository established by checkout verification for a manual commit. */
  checkoutRepoSlug?: string | null;
  headRepoSlug: string | null;
  baseBranch: string;
  headBranch: string | null;
  expectedHeadSha: string | null;
  prNumber: number | null;
  prUrl: string | null;
  terminalEvent: HarvestTerminalEvent;
  mergeCommitSha: string | null;
  terminalAt: string;
  explicitFeatureId?: string;
  explicitPhaseId?: string;
  recipient?: DeliveryRecipient | null;
}

export interface HarvestStageReceipt {
  operationId: string;
  phaseKey: string;
  stage: HarvestStageName;
  status: HarvestStageStatus;
  leaseEpoch: number;
  attemptCount: number;
  evidenceJson: string | null;
  error: string | null;
  updatedAt: string;
  completedAt: string | null;
}

interface HarvestTarget {
  featureId: string;
  phaseId: string | null;
}

type HarvestPullRequestIdentity = {
  repoSlug: string | null;
  baseBranch: string;
  prNumber: number;
  terminalEvent: HarvestTerminalEvent;
  mergeCommitSha: string | null;
};

type HarvestWorkScope = HarvestTarget & { workKey: string };

type VerifiedLocalHarvestTarget = HarvestWorkScope & {
  kind: "local_commit";
  repoSlug: string | null;
};

type VerifiedPullRequestTarget = HarvestWorkScope & {
  kind: "pull_request";
  repoSlug: string;
  pullRequestIdentity: Readonly<HarvestPullRequestIdentity>;
  requestedPhaseId?: string;
};

export function computeHarvestWorkKey(
  input: HarvestTarget & HarvestPullRequestIdentity,
): string {
  const mergeSha =
    input.terminalEvent === "merged"
      ? (input.mergeCommitSha?.trim().toLowerCase() ?? null)
      : null;
  return `harvest:${JSON.stringify([
    input.repoSlug?.toLowerCase() ?? null,
    input.baseBranch,
    input.prNumber,
    input.terminalEvent,
    mergeSha,
    input.featureId,
    input.phaseId,
  ])}`;
}

function isSameRepository(
  projectRepoSlug: string | null,
  candidateRepoSlug: string | null,
): boolean {
  return (
    !!projectRepoSlug?.trim() &&
    !!candidateRepoSlug &&
    projectRepoSlug.toLowerCase() === candidateRepoSlug.toLowerCase()
  );
}

function normalizePhaseId(phaseId: string): string {
  return phaseId.replace(
    /^phase-(\d+)$/,
    (_, digits: string) => `phase-${digits.padStart(2, "0")}`,
  );
}

export function scopeManualHarvestToPhases(
  candidate: HarvestCandidateInput,
  phaseIds: readonly string[],
): HarvestCandidateInput[] {
  if (
    candidate.source !== "manual_cli" ||
    candidate.prNumber !== null ||
    candidate.explicitPhaseId !== undefined
  ) {
    return [candidate];
  }
  return [...new Set(phaseIds.map(normalizePhaseId))].map((phaseId) => ({
    ...candidate,
    deliveryId: JSON.stringify([candidate.deliveryId, phaseId]),
    explicitPhaseId: phaseId,
  }));
}

/** Use phase IDs discovered at the verified merge checkout. */
export function scopeVerifiedMergeToPhases(
  {
    featureId,
    phaseId,
    workKey,
    requestedPhaseId,
    pullRequestIdentity,
  }: VerifiedPullRequestTarget,
  phaseIds: readonly string[],
): HarvestWorkScope[] {
  const covered = [...new Set(phaseIds.map(normalizePhaseId))];
  if (requestedPhaseId !== undefined && !covered.includes(requestedPhaseId)) {
    return [];
  }
  if (phaseId !== null || pullRequestIdentity.terminalEvent !== "merged") {
    return [{ featureId, phaseId, workKey }];
  }
  const selected =
    requestedPhaseId === undefined ? covered : [requestedPhaseId];
  return selected.map((phaseId) => ({
    featureId,
    phaseId,
    workKey: computeHarvestWorkKey({
      ...pullRequestIdentity,
      featureId,
      phaseId,
    }),
  }));
}

function parseHarvestBranch(headBranch: string | null): HarvestTarget | null {
  const branch = /^(?:feat|phase)\/(.+)$/.exec(headBranch ?? "");
  if (!branch || branch[1].includes("/")) return null;

  const phase = /^(.+)-(phase-\d+)(?:--dispatch-[a-f0-9]{64})?$/.exec(
    branch[1],
  );
  return phase
    ? { featureId: phase[1], phaseId: normalizePhaseId(phase[2]) }
    : { featureId: branch[1], phaseId: null };
}

function matchesPullRequestUrl(
  prUrl: string,
  projectRepoSlug: string | null,
  prNumber: number,
): boolean {
  try {
    const url = new URL(prUrl);
    const path = /^\/([^/]+\/[^/]+)\/pull\/([0-9]+)$/.exec(url.pathname);
    return (
      url.origin === "https://github.com" &&
      url.username === "" &&
      url.password === "" &&
      path !== null &&
      isSameRepository(projectRepoSlug, path[1]) &&
      path[2] === String(prNumber)
    );
  } catch {
    return false;
  }
}

const fullGitObjectId = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

type HarvestRepositoryScope = {
  projectId: string;
  repoSlug: string | null;
  trunkBranch: string;
};

type HarvestCommitScope = HarvestTarget &
  HarvestRepositoryScope & {
    prNumber: number | null;
    terminalEvent: HarvestTerminalEvent;
    mergeCommitSha: string | null;
  };

export function sharesHarvestRepositoryScope(
  existing: HarvestRepositoryScope,
  incoming: HarvestRepositoryScope,
): boolean {
  return (
    existing.projectId === incoming.projectId &&
    existing.trunkBranch === incoming.trunkBranch &&
    ((existing.repoSlug === null && incoming.repoSlug === null) ||
      isSameRepository(existing.repoSlug, incoming.repoSlug))
  );
}

function sharesMergedCommitScope(
  existing: HarvestCommitScope,
  incoming: HarvestCommitScope,
): boolean {
  const commit = existing.mergeCommitSha?.trim().toLowerCase();
  return (
    existing.terminalEvent === "merged" &&
    incoming.terminalEvent === "merged" &&
    existing.repoSlug !== null &&
    sharesHarvestRepositoryScope(existing, incoming) &&
    existing.featureId === incoming.featureId &&
    existing.phaseId === incoming.phaseId &&
    commit !== undefined &&
    fullGitObjectId.test(commit) &&
    commit === incoming.mergeCommitSha?.trim().toLowerCase()
  );
}

export function canCorrelateHarvestIntake(
  existing: HarvestCommitScope,
  incoming: HarvestCommitScope,
): boolean {
  return (
    (existing.prNumber === null) !== (incoming.prNumber === null) &&
    sharesMergedCommitScope(existing, incoming)
  );
}

type HarvestRepositoryPull = Pick<
  HarvestCandidateInput,
  "repoSlug" | "prNumber" | "terminalEvent"
> & { projectId: string };

export function isStaleHarvestClose(
  existing: HarvestRepositoryPull,
  incoming: HarvestRepositoryPull,
): boolean {
  return (
    existing.terminalEvent === "merged" &&
    incoming.terminalEvent === "closed_unmerged" &&
    existing.projectId === incoming.projectId &&
    existing.prNumber !== null &&
    existing.prNumber === incoming.prNumber &&
    isSameRepository(existing.repoSlug, incoming.repoSlug)
  );
}

export function verifyHarvestTarget(
  project: EnrolledProject,
  candidate: HarvestCandidateInput,
):
  | ({ ok: true } & (VerifiedLocalHarvestTarget | VerifiedPullRequestTarget))
  | {
      ok: false;
      code:
        | "REPO_MISMATCH"
        | "LOCAL_CHECKOUT_REQUIRED"
        | "INVALID_PR_NUMBER"
        | "PR_URL_MISMATCH"
        | "NOT_CONFIGURED_TRUNK"
        | "NOT_FEATURE_BRANCH"
        | "MISSING_MERGE_SHA"
        | "INVALID_MERGE_SHA"
        | "PHASE_MISMATCH";
      reason: string;
    } {
  const repoSlug = project.repoSlug?.toLowerCase() ?? null;
  if (candidate.source === "manual_cli" && candidate.prNumber === null) {
    if (!project.localRoot) {
      return {
        ok: false,
        code: "LOCAL_CHECKOUT_REQUIRED",
        reason: "Local harvest requires an enrolled checkout",
      };
    }
    const suppliedRepositories = [
      candidate.repoSlug,
      candidate.checkoutRepoSlug,
    ];
    if (
      suppliedRepositories.some(
        (slug) => slug != null && !isSameRepository(repoSlug, slug),
      )
    ) {
      return {
        ok: false,
        code: "REPO_MISMATCH",
        reason: "Local checkout repository differs from enrollment",
      };
    }
    if (candidate.baseBranch !== project.trunkBranch) {
      return {
        ok: false,
        code: "NOT_CONFIGURED_TRUNK",
        reason: "Local checkout does not target the configured trunk",
      };
    }
    if (candidate.prUrl !== null || candidate.terminalEvent !== "merged") {
      return {
        ok: false,
        code: "INVALID_PR_NUMBER",
        reason: "Pull request URL or closure requires a pull request number",
      };
    }
    const featureId = candidate.explicitFeatureId;
    if (!featureId || !/^[a-z0-9][a-z0-9_-]*$/i.test(featureId)) {
      return {
        ok: false,
        code: "NOT_FEATURE_BRANCH",
        reason: "Local harvest requires an explicit feature ID",
      };
    }
    const requestedPhase = candidate.explicitPhaseId;
    if (requestedPhase !== undefined && !/^phase-\d+$/.test(requestedPhase)) {
      return { ok: false, code: "PHASE_MISMATCH", reason: "Invalid phase ID" };
    }
    const commit = candidate.mergeCommitSha?.trim().toLowerCase();
    if (!commit) {
      return {
        ok: false,
        code: "MISSING_MERGE_SHA",
        reason: "Local harvest requires a commit",
      };
    }
    if (!fullGitObjectId.test(commit)) {
      return {
        ok: false,
        code: "INVALID_MERGE_SHA",
        reason: "Commit must be a full hexadecimal Git object ID",
      };
    }
    const phaseId =
      requestedPhase === undefined ? null : normalizePhaseId(requestedPhase);
    const checkoutRepoSlug =
      (candidate.checkoutRepoSlug ?? candidate.repoSlug)?.toLowerCase() ?? null;
    return {
      ok: true,
      kind: "local_commit",
      featureId,
      phaseId,
      repoSlug: checkoutRepoSlug,
      workKey: `harvest-local:${JSON.stringify([project.projectId, checkoutRepoSlug, project.trunkBranch, commit, featureId, phaseId])}`,
    };
  }

  if (repoSlug === null || !isSameRepository(repoSlug, candidate.repoSlug)) {
    return {
      ok: false,
      code: "REPO_MISMATCH",
      reason: "Pull request repository differs from enrollment",
    };
  }
  const prNumber = candidate.prNumber;
  if (prNumber === null || !Number.isSafeInteger(prNumber) || prNumber <= 0) {
    return {
      ok: false,
      code: "INVALID_PR_NUMBER",
      reason: "Pull request number must be a positive safe integer",
    };
  }
  if (
    candidate.prUrl !== null &&
    !matchesPullRequestUrl(candidate.prUrl, project.repoSlug, prNumber)
  ) {
    return {
      ok: false,
      code: "PR_URL_MISMATCH",
      reason: "Pull request URL must match the enrolled repository and number",
    };
  }
  if (candidate.baseBranch !== project.trunkBranch) {
    return {
      ok: false,
      code: "NOT_CONFIGURED_TRUNK",
      reason: "Pull request does not target the configured trunk",
    };
  }
  const target = parseHarvestBranch(candidate.headBranch);
  if (
    !target ||
    candidate.headBranch === project.trunkBranch ||
    (candidate.explicitFeatureId !== undefined &&
      candidate.explicitFeatureId !== target.featureId)
  ) {
    return {
      ok: false,
      code: "NOT_FEATURE_BRANCH",
      reason: "Pull request head does not identify the requested feature",
    };
  }
  const requestedPhaseId =
    candidate.explicitPhaseId === undefined
      ? undefined
      : normalizePhaseId(candidate.explicitPhaseId);
  const needsCheckoutCoverage =
    candidate.source === "manual_cli" &&
    candidate.terminalEvent === "merged" &&
    target.phaseId === null &&
    requestedPhaseId !== undefined;
  if (
    requestedPhaseId !== undefined &&
    requestedPhaseId !== target.phaseId &&
    !needsCheckoutCoverage
  ) {
    return {
      ok: false,
      code: "PHASE_MISMATCH",
      reason: "Pull request head does not identify the requested phase",
    };
  }
  const terminalEvent = candidate.terminalEvent;
  const mergeCommitSha =
    terminalEvent === "merged"
      ? (candidate.mergeCommitSha?.trim().toLowerCase() ?? null)
      : null;
  if (terminalEvent === "merged") {
    if (!mergeCommitSha) {
      return {
        ok: false,
        code: "MISSING_MERGE_SHA",
        reason: "Merged pull request requires a merge commit",
      };
    }
    if (!fullGitObjectId.test(mergeCommitSha)) {
      return {
        ok: false,
        code: "INVALID_MERGE_SHA",
        reason: "Merge commit must be a full hexadecimal Git object ID",
      };
    }
  }

  const pullRequestIdentity = {
    repoSlug,
    baseBranch: project.trunkBranch,
    prNumber,
    terminalEvent,
    mergeCommitSha,
  };
  return {
    ok: true,
    kind: "pull_request",
    ...target,
    repoSlug,
    pullRequestIdentity,
    ...(needsCheckoutCoverage ? { requestedPhaseId } : {}),
    workKey: computeHarvestWorkKey({ ...pullRequestIdentity, ...target }),
  };
}

interface HarvestIntakeIdentity extends HarvestWorkScope {
  projectId: string;
  repoSlug: string | null;
  trunkBranch: string;
  prNumber: number | null;
  prUrl: string | null;
  headRepoSlug: string | null;
  headBranch: string | null;
  expectedHeadSha: string | null;
  terminalEvent: HarvestTerminalEvent;
  mergeCommitSha: string | null;
  terminalAt: string;
}

/** Check the full batch against enrollment and checkout coverage before any write. */
export function verifyHarvestIntakeOperations(
  project: EnrolledProject,
  candidate: HarvestCandidateInput,
  checkoutPhaseIds: readonly string[] | undefined,
  operations: readonly HarvestIntakeIdentity[],
): boolean {
  const verified = verifyHarvestTarget(project, candidate);
  if (!verified.ok) return false;

  let scopes: HarvestWorkScope[] = [verified];
  if (verified.kind === "pull_request") {
    scopes = scopeVerifiedMergeToPhases(verified, checkoutPhaseIds ?? []);
  } else if (verified.phaseId === null) {
    scopes = [];
    for (const scoped of scopeManualHarvestToPhases(
      candidate,
      checkoutPhaseIds ?? [],
    )) {
      const result = verifyHarvestTarget(project, scoped);
      if (!result.ok) return false;
      scopes.push(result);
    }
  }

  const mergeCommitSha =
    verified.kind === "pull_request"
      ? verified.pullRequestIdentity.mergeCommitSha
      : (candidate.mergeCommitSha?.trim().toLowerCase() ?? null);
  return (
    operations.length > 0 &&
    operations.length === scopes.length &&
    operations.every((operation, index) => {
      const scope = scopes[index];
      return (
        operation.projectId === project.projectId &&
        operation.repoSlug === verified.repoSlug &&
        operation.trunkBranch === project.trunkBranch &&
        operation.featureId === scope.featureId &&
        operation.phaseId === scope.phaseId &&
        operation.workKey === scope.workKey &&
        operation.prNumber === candidate.prNumber &&
        operation.prUrl === candidate.prUrl &&
        operation.headRepoSlug === candidate.headRepoSlug &&
        operation.headBranch === candidate.headBranch &&
        operation.expectedHeadSha === candidate.expectedHeadSha &&
        operation.terminalEvent === candidate.terminalEvent &&
        operation.mergeCommitSha === mergeCommitSha &&
        operation.terminalAt === candidate.terminalAt
      );
    })
  );
}

export interface HarvestStagePlanEntry {
  phaseKey: string;
  stage: HarvestStageName;
  initialStatus: "pending" | "skipped_no_target";
}

export function planHarvestStages(input: {
  terminalEvent: HarvestTerminalEvent;
  phaseIds: readonly string[];
  hasSlackTarget: boolean;
  hasRemoteBranchTarget: boolean;
}): HarvestStagePlanEntry[] {
  const phaseKeys = [...new Set(input.phaseIds)];
  if (input.terminalEvent === "closed_unmerged") {
    return (phaseKeys.length ? phaseKeys : ["feature"]).map((phaseKey) => ({
      phaseKey,
      stage: "learning_record",
      initialStatus: "pending",
    }));
  }

  return phaseKeys.flatMap((phaseKey) =>
    HarvestStageNameSchema.options.map((stage) => ({
      phaseKey,
      stage,
      initialStatus:
        (stage === "slack_delivery" && !input.hasSlackTarget) ||
        (stage === "branch_cleanup" && !input.hasRemoteBranchTarget)
          ? "skipped_no_target"
          : "pending",
    })),
  );
}

export function isCompleteHarvestStagePlan(input: {
  terminalEvent: HarvestTerminalEvent;
  phaseIds: readonly string[];
  hasSlackTarget: boolean;
  hasRemoteBranchTarget: boolean;
  stages: readonly HarvestStagePlanEntry[];
}): boolean {
  const expected = planHarvestStages(input);
  const stageKey = ({
    phaseKey,
    stage,
    initialStatus,
  }: HarvestStagePlanEntry) => JSON.stringify([phaseKey, stage, initialStatus]);
  const remaining = new Set(expected.map(stageKey));
  return (
    remaining.size > 0 &&
    input.stages.length === remaining.size &&
    input.stages.every((entry) => remaining.delete(stageKey(entry)))
  );
}

function stageFinished({ stage, status }: HarvestStageReceipt): boolean {
  return (
    status === "succeeded" ||
    (stage === "learning_record" && status === "forecast_missing") ||
    ((stage === "slack_delivery" || stage === "branch_cleanup") &&
      status === "skipped_no_target")
  );
}

const stageForOutcome: Partial<Record<HarvestStageStatus, HarvestStageName>> = {
  gate_failed: "gate_verify",
  forecast_missing: "learning_record",
  uncertain: "slack_delivery",
  blocked_tip_mismatch: "branch_cleanup",
};

export function isValidHarvestStageTransition(
  receipt: HarvestStageReceipt,
  status: HarvestStageStatus,
): boolean {
  const requiredStage = stageForOutcome[status];
  return (
    !stageFinished(receipt) &&
    status !== "skipped_no_target" &&
    (requiredStage === undefined || requiredStage === receipt.stage)
  );
}

export function deriveHarvestTerminalStatus(input: {
  terminalEvent: HarvestTerminalEvent;
  phaseIds: readonly string[];
  stages: readonly HarvestStageReceipt[];
}): HarvestOperationStatus {
  const closed = input.terminalEvent === "closed_unmerged";
  const stages = closed
    ? input.stages.filter(({ stage }) => stage === "learning_record")
    : input.stages;
  const hasStatus = (status: HarvestStageStatus) =>
    stages.some((stage) => stage.status === status);

  if (hasStatus("gate_failed")) return "gate_failed";
  if (hasStatus("failed")) return "failed";
  if (hasStatus("uncertain")) return "delivery_pending";
  if (hasStatus("blocked_tip_mismatch")) return "cleanup_blocked";
  if (
    stages.every(
      ({ status }) => status === "pending" || status === "skipped_no_target",
    )
  )
    return "accepted";
  if (!stages.every(stageFinished)) return "running";

  const phaseKeys =
    closed && !input.phaseIds.length ? ["feature"] : input.phaseIds;
  const requiredStageCount = closed ? 1 : HarvestStageNameSchema.options.length;
  const stageNamesByPhase = new Map<string, Set<HarvestStageName>>();
  for (const { phaseKey, stage } of stages) {
    const stageNames = stageNamesByPhase.get(phaseKey) ?? new Set();
    stageNames.add(stage);
    stageNamesByPhase.set(phaseKey, stageNames);
  }
  if (
    !phaseKeys.length ||
    !phaseKeys.every(
      (phaseKey) =>
        stageNamesByPhase.get(phaseKey)?.size === requiredStageCount,
    )
  ) {
    return "running";
  }
  return closed ? "closed_unmerged" : "completed";
}

type BranchCleanupTarget = HarvestTarget & {
  terminalEvent: HarvestTerminalEvent;
  prNumber: number | null;
  repoSlug: string | null;
  headRepoSlug: string | null;
  trunkBranch: string;
  headBranch: string | null;
  expectedHeadSha: string | null;
};

/** Use repository facts from a verified pull request. */
export function hasVerifiedBranchCleanupTarget(
  target: BranchCleanupTarget,
): boolean {
  const branch = parseHarvestBranch(target.headBranch);
  return (
    target.terminalEvent === "merged" &&
    target.prNumber !== null &&
    Number.isSafeInteger(target.prNumber) &&
    target.prNumber > 0 &&
    isSameRepository(target.repoSlug, target.headRepoSlug) &&
    target.headBranch !== target.trunkBranch &&
    branch?.featureId === target.featureId &&
    (branch.phaseId === null || branch.phaseId === target.phaseId) &&
    fullGitObjectId.test(target.expectedHeadSha ?? "")
  );
}

type VerifiedHarvestFacts = HarvestCommitScope &
  BranchCleanupTarget & {
    prUrl: string | null;
    terminalAt: string;
  };

export function mergeVerifiedHarvestFacts(
  prior: VerifiedHarvestFacts,
  verified: VerifiedHarvestFacts,
) {
  const priorPull = prior.prNumber === null ? null : prior;
  if (
    verified.prNumber === null ||
    !Number.isSafeInteger(verified.prNumber) ||
    verified.prNumber <= 0 ||
    (prior.prNumber !== null && prior.prNumber !== verified.prNumber) ||
    !sharesMergedCommitScope(prior, verified) ||
    (priorPull?.headRepoSlug &&
      verified.headRepoSlug &&
      !isSameRepository(priorPull.headRepoSlug, verified.headRepoSlug)) ||
    (priorPull?.headBranch &&
      verified.headBranch &&
      priorPull.headBranch !== verified.headBranch) ||
    (priorPull?.expectedHeadSha &&
      verified.expectedHeadSha &&
      priorPull.expectedHeadSha.toLowerCase() !==
        verified.expectedHeadSha.toLowerCase())
  ) {
    return null;
  }
  const facts = {
    headRepoSlug: priorPull?.headRepoSlug ?? verified.headRepoSlug,
    prNumber: verified.prNumber,
    prUrl: prior.prUrl ?? verified.prUrl,
    headBranch: priorPull?.headBranch ?? verified.headBranch,
    expectedHeadSha: priorPull?.expectedHeadSha ?? verified.expectedHeadSha,
    terminalAt:
      prior.prNumber === null ? verified.terminalAt : prior.terminalAt,
  };
  return Object.entries(facts).some(
    ([key, value]) => prior[key as keyof typeof facts] !== value,
  )
    ? facts
    : null;
}

export function matchesHarvestNoticeRecipient(
  stored: DeliveryRecipient | null,
  requested: DeliveryRecipient,
): stored is DeliveryRecipient {
  return (
    stored?.surface === "slack" &&
    requested.surface === stored.surface &&
    requested.projectId === stored.projectId &&
    requested.workspaceId === stored.workspaceId &&
    requested.channelId === stored.channelId &&
    requested.threadTs === stored.threadTs &&
    requested.actorUserId === stored.actorUserId &&
    Boolean(requested.opsOnly) === Boolean(stored.opsOnly)
  );
}

export function planLateBranchCleanup(input: {
  operationId: string;
  prior: VerifiedHarvestFacts & { status: HarvestOperationStatus };
  verified: VerifiedHarvestFacts;
  stages: readonly HarvestStageReceipt[];
  nowIso: string;
}): HarvestStageReceipt[] {
  const { operationId, prior, verified, stages, nowIso } = input;
  const enriched = mergeVerifiedHarvestFacts(prior, verified);
  if (
    !enriched ||
    !["accepted", "running", "delivery_pending", "completed"].includes(
      prior.status,
    ) ||
    !hasVerifiedBranchCleanupTarget({ ...prior, ...enriched })
  ) {
    return [];
  }

  return stages
    .filter(
      (receipt) =>
        receipt.operationId === operationId &&
        (prior.phaseId === null || receipt.phaseKey === prior.phaseId) &&
        receipt.stage === "branch_cleanup" &&
        receipt.status === "skipped_no_target",
    )
    .map((receipt) => ({
      ...receipt,
      status: "pending",
      updatedAt: nowIso,
      completedAt: null,
    }));
}

export function evaluateBranchCleanupSafety(input: {
  projectRepoSlug: string | null;
  candidateRepoSlug: string | null;
  headRepoSlug: string | null;
  trunkBranch: string;
  headBranch: string | null;
  expectedHeadSha: string | null;
  observedRemoteHeadSha: string | null;
}):
  | { action: "already_deleted" }
  | { action: "delete_at_tip"; branch: string; expectedSha: string }
  | {
      action: "block_cleanup";
      code:
        | "REPO_MISMATCH"
        | "HEAD_REPO_MISMATCH"
        | "PROTECTED_BRANCH"
        | "MISSING_EXPECTED_TIP"
        | "TIP_MOVED";
    } {
  const { headBranch, expectedHeadSha, observedRemoteHeadSha } = input;
  if (!isSameRepository(input.projectRepoSlug, input.candidateRepoSlug)) {
    return { action: "block_cleanup", code: "REPO_MISMATCH" };
  }
  if (!isSameRepository(input.projectRepoSlug, input.headRepoSlug)) {
    return { action: "block_cleanup", code: "HEAD_REPO_MISMATCH" };
  }
  if (
    !headBranch ||
    headBranch === input.trunkBranch ||
    !parseHarvestBranch(headBranch)
  ) {
    return { action: "block_cleanup", code: "PROTECTED_BRANCH" };
  }
  if (expectedHeadSha === null || !fullGitObjectId.test(expectedHeadSha)) {
    return { action: "block_cleanup", code: "MISSING_EXPECTED_TIP" };
  }
  if (observedRemoteHeadSha === null) return { action: "already_deleted" };
  const expectedSha = expectedHeadSha.toLowerCase();
  if (
    !fullGitObjectId.test(observedRemoteHeadSha) ||
    expectedSha !== observedRemoteHeadSha.toLowerCase()
  ) {
    return { action: "block_cleanup", code: "TIP_MOVED" };
  }
  return {
    action: "delete_at_tip",
    branch: headBranch,
    expectedSha,
  };
}
