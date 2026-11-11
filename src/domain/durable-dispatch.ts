/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import type { DeliveryRecipient } from "./project-registry.js";

export const EvidenceLevelSchema = z.enum([
  "durable_verified",
  "legacy_unverified",
]);

export const DispatchOperationStatusSchema = z.enum([
  "accepted",
  "leased",
  "running",
  "reconciling",
  "completed",
  "failed",
  "superseded",
]);
export type DispatchOperationStatus = z.infer<
  typeof DispatchOperationStatusSchema
>;

export const DispatchAttemptStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "interrupted",
  "reconciled_completed",
]);
export type DispatchAttemptStatus = z.infer<typeof DispatchAttemptStatusSchema>;

export interface LeaseFence {
  operationId: string;
  leaseOwner: string;
  leaseEpoch: number;
}

export interface DurableDispatchOperation {
  operationId: string;
  projectId: string;
  workKey: string;
  featureId: string;
  phaseId: string;
  taskIds: string[];
  backend: string;
  branchName: string;
  trunkBranch: string;
  recipient: DeliveryRecipient | null;
  status: DispatchOperationStatus;
  attemptCount: number;
  leaseOwner: string | null;
  leaseEpoch: number;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  prNumber: number | null;
  prUrl: string | null;
  lastRunId: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  evidenceLevel: z.infer<typeof EvidenceLevelSchema>;
}

export interface DispatchReceipt {
  operationId: string;
  projectId: string;
  workKey: string;
  featureId: string;
  phaseId: string;
  branchName: string;
  status: DispatchOperationStatus;
  attemptCount: number;
  deduplicated: boolean;
  recipient: DeliveryRecipient | null;
  createdAt: string;
}

export interface WorkerRecoveryEvidence {
  workerState: "not_started" | "running" | "stopped" | "unknown";
  openPullRequest: { prNumber: number; prUrl: string } | null;
  mergedPullRequest: {
    prNumber: number;
    prUrl: string;
    mergeCommitSha: string;
  } | null;
  completedManifestRunId: string | null;
  sandboxDir: string | null;
}

export type StaleLeaseDecision =
  | {
      action: "complete_from_pr";
      prNumber: number;
      prUrl: string;
      triggerHarvestMergeSha?: string;
    }
  | { action: "await_worker_stop"; reason: string }
  | { action: "requeue_attempt"; reason: string }
  | { action: "fail_exhausted"; reason: string };

interface DispatchWork {
  featureId: string;
  phaseId: string;
  taskIds?: readonly string[];
}

export interface DispatchAcceptanceRequest extends DispatchWork {
  projectId: string;
  backend: string;
  trunkBranch: string;
  recipient?: DeliveryRecipient | null;
  newOperationId: string;
  nowIso: string;
}

function normalizeTaskIds(taskIds: readonly string[] | undefined): string[] {
  return [...new Set(taskIds)].sort();
}

export function computeDispatchWorkKey(input: DispatchWork): string {
  const taskIds = normalizeTaskIds(input.taskIds);
  const phaseKey = `ship:${input.featureId}:${input.phaseId}`;
  return taskIds.length ? `${phaseKey}:${JSON.stringify(taskIds)}` : phaseKey;
}

function dispatchReceipt(
  operation: DurableDispatchOperation,
  deduplicated: boolean,
): DispatchReceipt {
  return {
    operationId: operation.operationId,
    projectId: operation.projectId,
    workKey: operation.workKey,
    featureId: operation.featureId,
    phaseId: operation.phaseId,
    branchName: operation.branchName,
    status: operation.status,
    attemptCount: operation.attemptCount,
    deduplicated,
    recipient: operation.recipient && { ...operation.recipient },
    createdAt: operation.createdAt,
  };
}

const activeStatuses: readonly DispatchOperationStatus[] = [
  "accepted",
  "leased",
  "running",
  "reconciling",
];

export function evaluateDispatchAcceptance(
  input: DispatchAcceptanceRequest & {
    existingActive: DurableDispatchOperation | null;
  },
):
  | { kind: "deduplicated"; receipt: DispatchReceipt }
  | {
      kind: "create_new";
      operation: DurableDispatchOperation;
      receipt: DispatchReceipt;
    } {
  const workKey = computeDispatchWorkKey(input);
  const existing = input.existingActive;
  if (
    existing?.projectId === input.projectId &&
    existing.workKey === workKey &&
    activeStatuses.includes(existing.status)
  ) {
    return { kind: "deduplicated", receipt: dispatchReceipt(existing, true) };
  }

  const operation: DurableDispatchOperation = {
    operationId: input.newOperationId,
    projectId: input.projectId,
    workKey,
    featureId: input.featureId,
    phaseId: input.phaseId,
    taskIds: normalizeTaskIds(input.taskIds),
    backend: input.backend,
    branchName: `feat/${input.featureId}-${input.phaseId}`,
    trunkBranch: input.trunkBranch,
    recipient: input.recipient ? { ...input.recipient } : null,
    status: "accepted",
    attemptCount: 0,
    leaseOwner: null,
    leaseEpoch: 0,
    leaseExpiresAt: null,
    heartbeatAt: null,
    prNumber: null,
    prUrl: null,
    lastRunId: null,
    lastError: null,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
    completedAt: null,
    evidenceLevel: "durable_verified",
  };
  return {
    kind: "create_new",
    operation,
    receipt: dispatchReceipt(operation, false),
  };
}

export type LeaseRejectionCode = "LEASE_FENCED" | "LEASE_EXPIRED";

export function validateLeaseFence(
  current: {
    operationId?: string;
    leaseOwner: string | null;
    leaseEpoch: number;
    leaseExpiresAt: string | null;
  },
  candidate: LeaseFence,
  nowIso: string,
): { ok: true } | { ok: false; code: LeaseRejectionCode } {
  if (
    (current.operationId !== undefined &&
      current.operationId !== candidate.operationId) ||
    current.leaseOwner !== candidate.leaseOwner ||
    current.leaseEpoch !== candidate.leaseEpoch
  ) {
    return { ok: false, code: "LEASE_FENCED" };
  }
  if (
    !current.leaseExpiresAt ||
    !(Date.parse(nowIso) < Date.parse(current.leaseExpiresAt))
  ) {
    return { ok: false, code: "LEASE_EXPIRED" };
  }
  return { ok: true };
}

export function evaluateStaleDispatchReconciliation(input: {
  operation: DurableDispatchOperation;
  evidence: WorkerRecoveryEvidence;
  maxCrashRecoveryAttempts: number;
}): StaleLeaseDecision {
  const { evidence, operation, maxCrashRecoveryAttempts } = input;
  if (evidence.mergedPullRequest) {
    const { prNumber, prUrl, mergeCommitSha } = evidence.mergedPullRequest;
    return {
      action: "complete_from_pr",
      prNumber,
      prUrl,
      triggerHarvestMergeSha: mergeCommitSha,
    };
  }
  if (evidence.openPullRequest) {
    return { action: "complete_from_pr", ...evidence.openPullRequest };
  }
  if (
    evidence.workerState === "running" ||
    evidence.workerState === "unknown"
  ) {
    return {
      action: "await_worker_stop",
      reason: "Worker termination has not been confirmed",
    };
  }
  if (operation.attemptCount >= maxCrashRecoveryAttempts) {
    return {
      action: "fail_exhausted",
      reason: "Crash recovery attempts exhausted",
    };
  }
  return {
    action: "requeue_attempt",
    reason: "No active worker or pull request remains",
  };
}
