/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import type { DeliveryRecipient, EnrolledProject } from "./project-registry.js";

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
  baseBranch: string;
  headBranch: string | null;
  expectedHeadSha: string | null;
  prNumber: number;
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

export function computeHarvestWorkKey(
  input: HarvestTarget & {
    prNumber: number;
    terminalEvent: HarvestTerminalEvent;
    mergeCommitSha: string | null;
  },
): string {
  const mergeSha =
    input.terminalEvent === "merged"
      ? (input.mergeCommitSha?.trim().toLowerCase() ?? null)
      : null;
  return `harvest:${JSON.stringify([
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

function parseHarvestBranch(headBranch: string | null): HarvestTarget | null {
  const branch = /^(?:feat|phase)\/(.+)$/.exec(headBranch ?? "");
  if (!branch) return null;

  const phase = /^(.+)-(phase-\d+)$/.exec(branch[1]);
  return phase
    ? { featureId: phase[1], phaseId: normalizePhaseId(phase[2]) }
    : { featureId: branch[1], phaseId: null };
}

export function verifyHarvestTarget(
  project: EnrolledProject,
  candidate: HarvestCandidateInput,
):
  | ({ ok: true; workKey: string } & HarvestTarget)
  | {
      ok: false;
      code:
        | "REPO_MISMATCH"
        | "NOT_CONFIGURED_TRUNK"
        | "NOT_FEATURE_BRANCH"
        | "MISSING_MERGE_SHA"
        | "PHASE_MISMATCH";
      reason: string;
    } {
  if (!isSameRepository(project.repoSlug, candidate.repoSlug)) {
    return {
      ok: false,
      code: "REPO_MISMATCH",
      reason: "Pull request repository differs from enrollment",
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
  if (
    candidate.explicitPhaseId !== undefined &&
    normalizePhaseId(candidate.explicitPhaseId) !== target.phaseId
  ) {
    return {
      ok: false,
      code: "PHASE_MISMATCH",
      reason: "Pull request head does not identify the requested phase",
    };
  }
  if (
    candidate.terminalEvent === "merged" &&
    !candidate.mergeCommitSha?.trim()
  ) {
    return {
      ok: false,
      code: "MISSING_MERGE_SHA",
      reason: "Merged pull request requires a merge commit",
    };
  }

  return {
    ok: true,
    ...target,
    workKey: computeHarvestWorkKey({ ...candidate, ...target }),
  };
}

export function planHarvestStages(input: {
  terminalEvent: HarvestTerminalEvent;
  phaseIds: readonly string[];
  hasSlackTarget: boolean;
  hasRemoteBranchTarget: boolean;
}): Array<{
  phaseKey: string;
  stage: HarvestStageName;
  initialStatus: HarvestStageStatus;
}> {
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

function stageFinished({ stage, status }: HarvestStageReceipt): boolean {
  return (
    status === "succeeded" ||
    (stage === "learning_record" && status === "forecast_missing") ||
    ((stage === "slack_delivery" || stage === "branch_cleanup") &&
      status === "skipped_no_target")
  );
}

export function deriveHarvestTerminalStatus(input: {
  terminalEvent: HarvestTerminalEvent;
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
  if (closed) return "closed_unmerged";

  const stageNamesByPhase = new Map<string, Set<HarvestStageName>>();
  for (const { phaseKey, stage } of stages) {
    const stageNames = stageNamesByPhase.get(phaseKey) ?? new Set();
    stageNames.add(stage);
    stageNamesByPhase.set(phaseKey, stageNames);
  }
  return [...stageNamesByPhase.values()].every(
    (names) => names.size === HarvestStageNameSchema.options.length,
  )
    ? "completed"
    : "running";
}

export function evaluateBranchCleanupSafety(input: {
  projectRepoSlug: string | null;
  candidateRepoSlug: string | null;
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
        | "PROTECTED_BRANCH"
        | "MISSING_EXPECTED_TIP"
        | "TIP_MOVED";
    } {
  const { headBranch, expectedHeadSha, observedRemoteHeadSha } = input;
  if (!isSameRepository(input.projectRepoSlug, input.candidateRepoSlug)) {
    return { action: "block_cleanup", code: "REPO_MISMATCH" };
  }
  if (
    !headBranch ||
    headBranch === input.trunkBranch ||
    !parseHarvestBranch(headBranch)
  ) {
    return { action: "block_cleanup", code: "PROTECTED_BRANCH" };
  }
  if (!expectedHeadSha?.trim()) {
    return { action: "block_cleanup", code: "MISSING_EXPECTED_TIP" };
  }
  if (observedRemoteHeadSha === null) return { action: "already_deleted" };
  if (expectedHeadSha !== observedRemoteHeadSha) {
    return { action: "block_cleanup", code: "TIP_MOVED" };
  }
  return {
    action: "delete_at_tip",
    branch: headBranch,
    expectedSha: expectedHeadSha,
  };
}
