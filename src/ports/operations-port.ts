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
  HarvestStagePlanEntry,
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
   * Report incomplete or failed lookups as unavailable, even if they return a candidate.
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
    /** Persisted task IDs. An empty list runs the whole phase. */
    taskIds: readonly string[];
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

/** Use a detached checkout of a verified commit ID in the repository's object format. */
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
    prNumber: number | null;
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
  prNumber: number | null;
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

export interface OutboxDestination {
  workspaceId: string;
  channelId: string;
  threadTs: string | null;
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
   * Read the newest dispatch for the project, feature and phase across task scopes and statuses.
   * Break creation-time ties by greatest operation ID.
   */
  getDispatchOperation(input: {
    projectId: string;
    featureId: string;
    phaseId: string;
  }): DurableDispatchOperation | null;

  /**
   * Commit the original delivery and all resolved operations in one transaction.
   * Resolve checkout coverage with scopeManualHarvestToPhases or scopeVerifiedMergeToPhases before intake.
   * Pass accepted: false when a verified whole-feature merge yields no scopes.
   * Replay returns every persisted operation in the original scope order.
   * Reject transport ID reuse with a different repository or payload digest.
   * Resolve work keys and their aliases within the project before matching commit scope.
   * Use canCorrelateHarvestIntake to match local commits to verified merged pull requests.
   * If several verified pull requests match a local commit, use the earliest operation.
   * Break creation-time ties by least operation ID.
   * Preserve the first operation ID, work key and stage receipts.
   * Attach verified pull request facts, including the head repository, when they arrive.
   * Persist both work keys for replay and keep distinct verified pull requests separate.
   * Preserve a verified merge on a later close.
   */
  recordHarvestIntake(input: {
    candidate: HarvestCandidateInput;
    payloadDigest: string;
    receivedAt: string;
    target:
      | {
          accepted: true;
          operations: readonly [
            DurableHarvestOperation,
            ...DurableHarvestOperation[],
          ];
        }
      | { accepted: false; projectId: string | null; reason: string };
  }):
    | {
        ok: true;
        operations: DurableHarvestOperation[];
        deduplicatedTransport: boolean;
        /** True when every accepted scope matched existing work. */
        deduplicatedWork: boolean;
      }
    | { ok: false; code: "DELIVERY_ID_CONFLICT" };
  /** List unstarted and resumable harvests without live leases in creation order. */
  listRecoverableHarvests(input: {
    nowIso: string;
    projectId?: string;
  }): DurableHarvestOperation[];
  /** Acquire an eligible lease atomically and return the full set of persisted stage receipts. */
  claimHarvestLease(input: OperationLeaseRequest): {
    fence: LeaseFence;
    operation: DurableHarvestOperation;
    stages: HarvestStageReceipt[];
  } | null;
  /** Extend a live lease atomically after checking the fence. Keep the epoch unchanged. */
  heartbeatHarvestLease(input: {
    fence: LeaseFence;
    nowIso: string;
    leaseExpiresAt: string;
  }): FencedWrite;
  /**
   * Persist the full, nonempty set of initial receipts in one fenced write.
   * Require all stages for the supplied phase IDs and the operation's terminal event.
   * Validate initial statuses against the resolved targets with isCompleteHarvestStagePlan.
   * If the operation names a phase, require that phase alone.
   * A replay with the same phase and stage keys preserves every receipt.
   * Reject incomplete or changed plans without writing a partial batch.
   */
  initializeHarvestStages(input: {
    fence: LeaseFence;
    nowIso: string;
    phaseIds: readonly string[];
    hasSlackTarget: boolean;
    hasRemoteBranchTarget: boolean;
    stages: readonly HarvestStagePlanEntry[];
  }): FencedWrite | { ok: false; code: "HARVEST_PLAN_CONFLICT" };
  /**
   * Validate the fence and the planned receipt before any write.
   * Reject invalid transitions with isValidHarvestStageTransition.
   * Write the receipt and derive operation status in the same transaction.
   * Use deriveHarvestTerminalStatus with the terminal event and full saved phase plan.
   * Set updatedAt to nowIso and set completedAt to nowIso for a terminal status.
   * Exclude terminal operations from recovery scans and claims.
   */
  transitionHarvestStage(input: {
    fence: LeaseFence;
    nowIso: string;
    phaseKey: string;
    stage: HarvestStageName;
    status: HarvestStageStatus;
    evidenceJson?: string | null;
    error?: string | null;
    linkedRunId?: number | null;
  }):
    | FencedWrite
    | {
        ok: false;
        code: "HARVEST_STAGE_UNPLANNED" | "HARVEST_STAGE_TRANSITION_INVALID";
      };

  enqueueOutbox(input: OutboxMessage & { nowIso: string }): OutboxItem;
  /** Read the accepted delivery context without acquiring a send claim. */
  getOutboxItem(outboxId: string): OutboxItem | null;
  /** List pending, uncertain and abandoned sending items for the project in creation order. */
  listRecoverableOutboxItems(input: {
    nowIso: string;
    projectId: string;
  }): OutboxItem[];
  /**
   * Bind the resolved destination and existing metadata key in the atomic send claim.
   * A null destination on a first claim permits a skip without sending.
   * Reconcile abandoned sending and uncertain items at the stored destination.
   * Keep the stored destination on later claims.
   */
  claimOutboxItem(input: {
    outboxId: string;
    nowIso: string;
    destination: OutboxDestination | null;
  }): {
    claim: OutboxClaim;
    item: OutboxItem;
    action: "send" | "reconcile";
  } | null;
  markOutboxUncertain(input: {
    claim: OutboxClaim;
    nowIso: string;
    error: string;
  }): FencedWrite;
  /** Record the outcome under the current claim and preserve the bound destination. */
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
