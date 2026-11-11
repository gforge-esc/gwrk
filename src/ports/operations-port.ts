/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  DispatchAcceptanceRequest,
  DispatchAttemptStatus,
  DispatchReceipt,
  DurableDispatchOperation,
  LeaseFence,
  LeaseRejectionCode,
  WorkerRecoveryEvidence,
} from "../domain/durable-dispatch.js";
import type {
  HarvestCandidateInput,
  HarvestOperationStatus,
  HarvestStageName,
  HarvestStageReceipt,
  HarvestStageStatus,
  HarvestTerminalEvent,
  OutboxStatus,
} from "../domain/durable-harvest.js";
import type { DeliveryRecipient } from "../domain/project-registry.js";

export interface ClockPort {
  nowIso(): string;
  nowMs(): number;
}

export interface HarvestPullRequestFact {
  repoSlug: string;
  /** Read the head repository from GitHub. Use null when it is unknown. */
  headRepoSlug: string | null;
  prNumber: number;
  prUrl: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  merged: boolean;
  baseBranch: string;
  headBranch: string;
  headSha: string | null;
  mergeCommitSha: string | null;
  mergedAt: string | null;
  closedAt: string | null;
}

export interface GitHubHarvestPort {
  verifyWebhookSignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
    secret: string,
  ): boolean;
  listTerminalPullRequests(input: {
    cwd: string;
    repoSlug: string;
    baseBranch: string;
    sinceIso?: string | null;
  }): Promise<HarvestPullRequestFact[]>;
  getPullRequest(input: {
    cwd: string;
    repoSlug: string;
    prNumber: number;
  }): Promise<HarvestPullRequestFact | null>;
}

export interface WorkerExecutionPort {
  /**
   * Set a pull request's evidence operation ID only after verifying its repository.
   * Require the operation-specific head in that repository or a persisted pull request link.
   */
  inspectRecoveredWork(input: {
    operationId: string;
    workKey: string;
    projectRoot: string;
    repoSlug: string | null;
    featureId: string;
    phaseId: string;
    branchName: string;
    persistedPullRequest?: { prNumber: number; prUrl: string | null };
  }): Promise<WorkerRecoveryEvidence>;
  launchPhaseShip(input: {
    projectRoot: string;
    trunkBranch: string;
    branchName: string;
    featureId: string;
    phaseId: string;
    backend: string;
  }): Promise<{
    exitCode: number;
    stderr: string;
    workDir?: string;
    prNumber?: number;
    prUrl?: string;
    runId?: number;
  }>;
  cleanupStaleSandbox(
    projectRoot: string,
    workDir: string,
    featureId: string,
  ): Promise<void>;
}

export interface HarvestExecutionPort {
  discoverPhasesAtCheckout(
    checkoutDir: string,
    featureId: string,
  ): Promise<string[]>;
  verifyGatesAtCheckout(input: {
    checkoutDir: string;
    projectId: string;
    featureId: string;
    phaseId: string;
    updateLocalTaskState: boolean;
  }): Promise<{
    passed: number;
    failed: number;
    total: number;
    failedTaskIds: string[];
  }>;
  recordLearningAtCheckout(input: {
    checkoutDir: string;
    projectId: string;
    featureId: string;
    phaseId: string | null;
    prNumber: number;
    prUrl: string | null;
    terminalEvent: HarvestTerminalEvent;
    mergeCommitSha: string | null;
    terminalAt: string;
    gatePassed: boolean;
  }): Promise<{
    linkedRunId: number | null;
    forecastMissing: boolean;
    pointCompression?: number;
    summaryText: string;
    blocks?: unknown[];
  }>;
}

interface OperationLeaseRequest {
  operationId: string;
  leaseOwner: string;
  nowIso: string;
  leaseExpiresAt: string;
}

type FencedWrite = { ok: true } | { ok: false; code: LeaseRejectionCode };

export interface DurableHarvestOperation {
  operationId: string;
  projectId: string;
  workKey: string;
  repoSlug: string | null;
  headRepoSlug: string | null;
  trunkBranch: string;
  featureId: string;
  phaseId: string | null;
  prNumber: number;
  prUrl: string | null;
  headBranch: string | null;
  expectedHeadSha: string | null;
  terminalEvent: HarvestTerminalEvent;
  mergeCommitSha: string | null;
  terminalAt: string;
  recipient: DeliveryRecipient | null;
  status: HarvestOperationStatus;
  leaseOwner: string | null;
  leaseEpoch: number;
  leaseExpiresAt: string | null;
  linkedRunId: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface HarvestCursor {
  projectId: string;
  lastPolledAt: string;
  lastTerminalAt: string | null;
  lastPrNumber: number | null;
  lastError: string | null;
}

export interface OutboxMessage {
  outboxId: string;
  projectId: string;
  dedupeKey: string;
  ownerKind: "dispatch" | "harvest";
  ownerOperationId: string;
  eventType: string;
  featureId: string;
  phaseId: string | null;
  recipient: DeliveryRecipient;
  payload: { text: string; blocks?: unknown[]; opsOnly?: boolean };
  clientMetadataKey: string;
}

export interface OutboxItem extends OutboxMessage {
  status: OutboxStatus;
  workspaceId: string | null;
  channelId: string | null;
  threadTs: string | null;
  messageTs: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
}

export interface OutboxClaim {
  outboxId: string;
  attemptNumber: number;
  clientMetadataKey: string;
}

export interface DurableOperationsStatus {
  projectId: string;
  queue: {
    queuedCount: number;
    activeCount: number;
    oldestQueuedAt: string | null;
    staleLeasesReconciled: number;
  };
  harvest: {
    lastCompletedAt: string | null;
    lastMergeCommitSha: string | null;
    pendingOperations: number;
    pendingStages: Array<{
      operationId: string;
      featureId: string;
      phaseId: string | null;
      stage: HarvestStageName;
      status: HarvestStageStatus;
    }>;
    unresolvedGateFailures: number;
    closedUnmergedCount: number;
    blockedCleanups: number;
  };
  delivery: {
    pendingCount: number;
    uncertainCount: number;
    failedCount: number;
    telegram: { enabled: false; reason: "disabled_in_pilot" };
  };
  historical: {
    legacyUnverifiedRuns: number;
    legacyUnverifiedDispatches: number;
  };
}

export interface OperationsStorePort {
  /** Select or insert active work in one transaction. */
  acceptDispatch(input: DispatchAcceptanceRequest): DispatchReceipt;
  claimDispatchLease(input: OperationLeaseRequest): {
    fence: LeaseFence;
    operation: DurableDispatchOperation;
  } | null;
  heartbeatDispatchLease(input: {
    fence: LeaseFence;
    nowIso: string;
    leaseExpiresAt: string;
  }): FencedWrite;
  completeDispatchAttempt(input: {
    fence: LeaseFence;
    nowIso: string;
    operationStatus: "accepted" | "completed" | "failed" | "superseded";
    attemptStatus: Exclude<DispatchAttemptStatus, "running">;
    runId?: number;
    worktreeDir?: string;
    exitCode?: number;
    prNumber?: number;
    prUrl?: string;
    error?: string;
  }): FencedWrite;
  /** Return accepted work and expired worker leases in creation order. */
  listRecoverableDispatches(input: {
    nowIso: string;
    projectId?: string;
  }): DurableDispatchOperation[];

  /**
   * Commit the delivery and operation together with the verified head repository.
   * Preserve a verified merge on a later close.
   */
  recordHarvestIntake(input: {
    candidate: HarvestCandidateInput;
    payloadDigest: string;
    receivedAt: string;
    target:
      | { accepted: true; operation: DurableHarvestOperation }
      | { accepted: false; projectId: string | null; reason: string };
  }):
    | {
        ok: true;
        operation: DurableHarvestOperation | null;
        deduplicatedTransport: boolean;
        deduplicatedWork: boolean;
      }
    | { ok: false; code: "DELIVERY_ID_CONFLICT" };
  /** List unstarted and resumable harvests without live leases in creation order. */
  listRecoverableHarvests(input: {
    nowIso: string;
    projectId?: string;
  }): DurableHarvestOperation[];
  /** Recheck eligibility and acquire the lease atomically. */
  claimHarvestLease(input: OperationLeaseRequest): {
    fence: LeaseFence;
    operation: DurableHarvestOperation;
    stages: HarvestStageReceipt[];
  } | null;
  transitionHarvestStage(input: {
    fence: LeaseFence;
    nowIso: string;
    phaseKey: string;
    stage: HarvestStageName;
    status: HarvestStageStatus;
    evidenceJson?: string | null;
    error?: string | null;
    linkedRunId?: number | null;
  }): FencedWrite;

  enqueueOutbox(input: OutboxMessage & { nowIso: string }): OutboxItem;
  /** List pending, uncertain and abandoned sending items for the project in creation order. */
  listRecoverableOutboxItems(input: {
    nowIso: string;
    projectId: string;
  }): OutboxItem[];
  /** Claim atomically. Route abandoned sending and uncertain items to reconciliation. */
  claimOutboxItem(input: { outboxId: string; nowIso: string }): {
    claim: OutboxClaim;
    item: OutboxItem;
    action: "send" | "reconcile";
  } | null;
  markOutboxUncertain(input: {
    claim: OutboxClaim;
    nowIso: string;
    error: string;
  }): FencedWrite;
  completeOutboxItem(input: {
    claim: OutboxClaim;
    nowIso: string;
    outcome:
      | {
          status: "delivered";
          channelId: string;
          messageTs: string;
          threadTs?: string;
        }
      | { status: "skipped_no_target" }
      | { status: "failed"; error: string };
  }): FencedWrite;

  getHarvestCursor(projectId: string): HarvestCursor | null;
  /** Advance the watermark after intake commits through that watermark. */
  saveHarvestCursor(cursor: HarvestCursor): void;
  getOperationsStatus(projectId: string): DurableOperationsStatus;
}
