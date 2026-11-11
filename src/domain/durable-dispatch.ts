/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { z } from "zod";
// RED scaffolding. Signatures copied from the Phase 1 contract.
export interface DeliveryRecipient {
  projectId: string;
  surface: "slack" | "local_cli" | "http";
  workspaceId?: string;
  channelId?: string;
  threadTs?: string;
  actorUserId?: string;
  opsOnly?: boolean;
}

export type DispatchOperationStatus =
  | "accepted"
  | "leased"
  | "running"
  | "reconciling"
  | "completed"
  | "failed"
  | "superseded";

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
  evidenceLevel: "durable_verified" | "legacy_unverified";
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

export function computeDispatchWorkKey(input: {
  featureId: string;
  phaseId: string;
  taskIds?: readonly string[];
}): string {
  throw new Error("Not implemented");
}

export function evaluateDispatchAcceptance(input: {
  existingActive: DurableDispatchOperation | null;
  projectId: string;
  featureId: string;
  phaseId: string;
  taskIds?: readonly string[];
  backend: string;
  trunkBranch: string;
  recipient?: DeliveryRecipient | null;
  newOperationId: string;
  nowIso: string;
}):
  | { kind: "deduplicated"; receipt: DispatchReceipt }
  | {
      kind: "create_new";
      operation: DurableDispatchOperation;
      receipt: DispatchReceipt;
    } {
  throw new Error("Not implemented");
}

export function validateLeaseFence(
  current: {
    leaseOwner: string | null;
    leaseEpoch: number;
    leaseExpiresAt: string | null;
  },
  candidate: LeaseFence,
  nowIso: string,
): { ok: true } | { ok: false; code: "LEASE_FENCED" | "LEASE_EXPIRED" } {
  throw new Error("Not implemented");
}

export function evaluateStaleDispatchReconciliation(input: {
  operation: DurableDispatchOperation;
  evidence: WorkerRecoveryEvidence;
  maxCrashRecoveryAttempts: number;
}): StaleLeaseDecision {
  throw new Error("Not implemented");
}

export const EvidenceLevelSchema = z.never();

export const DispatchOperationStatusSchema = z.never();

export const DispatchAttemptStatusSchema = z.never();
