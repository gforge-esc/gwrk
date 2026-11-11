# Durable operations policy and port contracts

Isolate dispatch and harvest state transitions inside pure domain modules. Execute SQLite persistence and clock reads through narrow ports. Route Git checkouts, GitHub lookups and Slack reconciliation through narrow ports too. Blocked: types consume `EnrolledProject` and `DeliveryRecipient` from `048-project-identity-slack`.

## Pure dispatch and lease policy

Source: `src/domain/durable-dispatch.ts`

Phase: Phase 1

```typescript
import type { DeliveryRecipient } from "./project-registry.js";

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
  mergedPullRequest: { prNumber: number; prUrl: string; mergeCommitSha: string } | null;
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
}): string;

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
  | { kind: "create_new"; operation: DurableDispatchOperation; receipt: DispatchReceipt };

export function validateLeaseFence(
  current: { leaseOwner: string | null; leaseEpoch: number; leaseExpiresAt: string | null },
  candidate: LeaseFence,
  nowIso: string,
): { ok: true } | { ok: false; code: "LEASE_FENCED" | "LEASE_EXPIRED" };

export function evaluateStaleDispatchReconciliation(input: {
  operation: DurableDispatchOperation;
  evidence: WorkerRecoveryEvidence;
  maxCrashRecoveryAttempts: number;
}): StaleLeaseDecision;
```

Work-key normalization sorts task IDs and produces `ship:<featureId>:<phaseId>` for phase-wide dispatches. Acceptance policy returns `deduplicated` when an active operation already owns `(projectId, workKey)`. Fence checks reject stale epochs even when `leaseOwner` matches. Crash reconciliation completes a worker without relaunching when a pull request already exists on GitHub. A retry requires evidence that the worker never started or has stopped. Running or unknown workers retain the operation until the coordinator confirms termination.

## Pure harvest and cleanup policy

Source: `src/domain/durable-harvest.ts`

Phase: Phase 1

```typescript
import type { DeliveryRecipient, EnrolledProject } from "./project-registry.js";

export type DeliverySource = "github_webhook" | "github_poller" | "manual_cli";

export type HarvestTerminalEvent = "merged" | "closed_unmerged";

export type HarvestStageName =
  | "git_sync"
  | "gate_verify"
  | "learning_record"
  | "slack_delivery"
  | "branch_cleanup";

export type HarvestStageStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "gate_failed"
  | "forecast_missing"
  | "uncertain"
  | "blocked_tip_mismatch"
  | "skipped_no_target"
  | "failed";

export type HarvestOperationStatus =
  | "accepted"
  | "running"
  | "completed"
  | "gate_failed"
  | "delivery_pending"
  | "cleanup_blocked"
  | "closed_unmerged"
  | "failed";

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

export function computeHarvestWorkKey(input: {
  prNumber: number;
  terminalEvent: HarvestTerminalEvent;
  mergeCommitSha: string | null;
  featureId: string;
  phaseId: string | null;
}): string;

export function verifyHarvestTarget(
  project: EnrolledProject,
  candidate: HarvestCandidateInput,
):
  | {
      ok: true;
      featureId: string;
      phaseId: string | null;
      workKey: string;
    }
  | {
      ok: false;
      code:
        | "REPO_MISMATCH"
        | "NOT_CONFIGURED_TRUNK"
        | "NOT_FEATURE_BRANCH"
        | "MISSING_MERGE_SHA"
        | "PHASE_MISMATCH";
      reason: string;
    };

export function planHarvestStages(input: {
  terminalEvent: HarvestTerminalEvent;
  phaseIds: readonly string[];
  hasSlackTarget: boolean;
  hasRemoteBranchTarget: boolean;
}): Array<{ phaseKey: string; stage: HarvestStageName; initialStatus: HarvestStageStatus }>;

export function deriveHarvestTerminalStatus(input: {
  terminalEvent: HarvestTerminalEvent;
  stages: readonly HarvestStageReceipt[];
}): HarvestOperationStatus;

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
  | { action: "block_cleanup"; code: "REPO_MISMATCH" | "PROTECTED_BRANCH" | "MISSING_EXPECTED_TIP" | "TIP_MOVED" };
```

Target checks enforce `project.repoSlug` and `project.trunkBranch` plus feature branch identity and non-empty merge commit hashes. Stage planning emits only `learning_record` for `closed_unmerged` pull requests so closed attempts never promote phases. Status derivation keeps `closed_unmerged` and `gate_failed` distinct from `delivery_pending`, `cleanup_blocked` and `completed`. Cleanup policy blocks branch deletion whenever the remote tip moved past `expectedHeadSha`.

## Operations, Git, GitHub and notification ports

Ports: `src/ports/operations-port.ts`, `src/ports/vcs-port.ts` and `src/ports/notification-port.ts`

Adapters: `src/adapters/sqlite/operations.ts` and `src/adapters/git/index.ts` plus `src/adapters/github/index.ts`, `src/adapters/harvest/index.ts` and `src/adapters/notifications/index.ts`

Phases: Phase 1 through Phase 4

```typescript
export interface ClockPort {
  nowIso(): string;
  nowMs(): number;
}

export interface HarvestPullRequestFact {
  repoSlug: string;
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
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean;
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
  inspectRecoveredWork(input: {
    projectRoot: string;
    repoSlug: string | null;
    featureId: string;
    phaseId: string;
    branchName: string;
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
  cleanupStaleSandbox(projectRoot: string, workDir: string, featureId: string): Promise<void>;
}

export interface HarvestExecutionPort {
  discoverPhasesAtCheckout(checkoutDir: string, featureId: string): Promise<string[]>;
  verifyGatesAtCheckout(input: {
    checkoutDir: string;
    projectId: string;
    featureId: string;
    phaseId: string;
    updateLocalTaskState: boolean;
  }): Promise<{ passed: number; failed: number; total: number; failedTaskIds: string[] }>;
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
```

### `OperationsStorePort` methods

| Method | Responsibility | Lease or uniqueness rule |
|---|---|---|
| `acceptDispatch` | Persist new dispatch or return active match | Atomic unique active `(project_id, work_key)` |
| `claimDispatchLease` | Increment `lease_epoch` and record `dispatch_attempts` row | Rejects active unexpired lease |
| `heartbeatDispatchLease` | Extend `lease_expires_at` for active worker | Requires matching `LeaseFence` |
| `completeDispatchAttempt` | Persist terminal or requeued attempt state | Fails with `LEASE_FENCED` on stale epoch |
| `listRecoverableDispatches` | List `accepted` and expired `leased` or `running` rows | Ordered by `created_at` ascending |
| `recordHarvestIntake` | Record `harvest_deliveries` and upsert `harvest_operations` | One transaction. Reject transport ID reuse with different verified repository or payload digest |
| `claimHarvestLease` | Claim or renew harvest operation lease | Increments `lease_epoch` atomically |
| `transitionHarvestStage` | Update one `harvest_stage_receipts` row | Requires matching owner and epoch on every stage and effect receipt write |
| `enqueueOutbox` | Insert idempotent `notification_outbox` item | Unique `(project_id, dedupe_key)` |
| `claimOutboxItem` | Mark pending or retryable item `sending` | Captures `client_metadata_key` with a fenced delivery claim |
| `markOutboxUncertain` | Persist `uncertain` after send timeout or error | Blocks blind resend before reconcile |
| `completeOutboxItem` | Store `delivered` receipt with `message_ts` and `thread_ts` | Requires the current delivery claim |
| `getHarvestCursor` | Read per-project poller watermark | Keyed by `project_id` |
| `saveHarvestCursor` | Advance `last_polled_at` and `last_terminal_at` | Advance only after all deliveries up to the watermark commit |
| `getOperationsStatus` | Summarize queue age, harvests, outbox lag and legacy counts | Marks legacy rows `legacy_unverified` |

### `VcsPort` and `NotificationPort` extensions

```typescript
export interface DetachedCheckoutHandle {
  checkoutDir: string;
  commitSha: string;
}

export interface VcsHarvestExtensions {
  fetchBranch(cwd: string, branchName: string): Promise<void> | void;
  resolveRefSha(cwd: string, ref: string): Promise<string | null> | string | null;
  isCommitAncestorOfRef(
    cwd: string,
    ancestorSha: string,
    descendantRef: string,
  ): Promise<boolean> | boolean;
  createDetachedCheckout(cwd: string, commitSha: string): Promise<DetachedCheckoutHandle>;
  removeDetachedCheckout(cwd: string, checkoutDir: string): Promise<void>;
  getRemoteBranchSha(cwd: string, branchName: string): Promise<string | null>;
  deleteRemoteBranchAtTip(
    cwd: string,
    branchName: string,
    expectedSha: string,
  ): Promise<{ deleted: boolean; reason?: "tip_moved" | "missing" }>;
}

export type NotificationReconcileResult =
  | { status: "found"; receipt: NotificationReceipt }
  | { status: "confirmed_absent" }
  | { status: "indeterminate"; reason: string };

export interface NotificationReconcileQuery {
  projectId: string;
  workspaceId?: string;
  channelId: string;
  threadTs?: string;
  clientMetadataKey: string;
}
```

`VcsPort` extends `048`'s interface with `VcsHarvestExtensions`. `NotificationPayload` adds optional `clientMetadataKey?: string` and `NotificationPort` adds optional `reconcileDelivery?(query: NotificationReconcileQuery): Promise<NotificationReconcileResult>`. `deleteRemoteBranchAtTip` runs `git push origin --force-with-lease=refs/heads/<branch>:<expectedSha> :refs/heads/<branch>` so remote branch movement fails closed without deleting new commits.

A missing message in a partial page, an access denial or a timed-out lookup is indeterminate. The outbox retains the uncertain state and exposes it to the operator. Resend only after a definitive provider rejection or a complete authorized lookup that confirms absence.
