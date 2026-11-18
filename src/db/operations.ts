/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  type DispatchAcceptanceRequest,
  type DispatchAttemptStatus,
  type DispatchOperationStatus,
  type DispatchReceipt,
  type DurableDispatchOperation,
  type LeaseFence,
  type LeaseRejectionCode,
  computeDispatchWorkKey,
  evaluateDispatchAcceptance,
  validateLeaseFence,
} from "../domain/durable-dispatch.js";
import {
  type HarvestCandidateInput,
  type HarvestOperationStatus,
  type HarvestSlackRecipient,
  type HarvestStageName,
  type HarvestStagePlanEntry,
  type HarvestStageReceipt,
  type HarvestStageStatus,
  type HarvestTerminalEvent,
  type OutboxStatus,
  canCorrelateHarvestIntake,
  deriveHarvestTerminalStatus,
  hasVerifiedBranchCleanupTarget,
  isCompleteHarvestStagePlan,
  isHarvestSlackRecipient,
  isStaleHarvestClose,
  isValidHarvestStageTransition,
  matchesAcceptedSlackDestination,
  matchesHarvestNoticeRecipient,
  mergeVerifiedHarvestFacts,
  planLateBranchCleanup,
  resolveHarvestSlackRecipient,
  sharesHarvestRepositoryScope,
  verifyHarvestIntakeOperations,
} from "../domain/durable-harvest.js";
import { decodeLegacyDispatchLine } from "../domain/legacy-dispatch.js";
import type {
  DeliveryRecipient,
  EnrolledProject,
  ProjectSlackBinding,
  SlackFeatureThread,
} from "../domain/project-registry.js";
import type {
  DurableHarvestOperation,
  DurableOperationsStatus,
  HarvestCursor,
  OperationsStorePort,
  OutboxClaim,
  OutboxDestination,
  OutboxItem,
  OutboxMessage,
} from "../ports/operations-port.js";
import { projectScope } from "./project-registry.js";

type FencedWrite = { ok: true } | { ok: false; code: LeaseRejectionCode };

interface DispatchOperationRow {
  operation_id: string;
  project_id: string;
  work_key: string;
  feature_id: string;
  phase_id: string;
  task_ids_json: string;
  backend: string;
  branch_name: string;
  trunk_branch: string;
  recipient_json: string | null;
  status: DispatchOperationStatus;
  attempt_count: number;
  lease_owner: string | null;
  lease_epoch: number;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  pr_number: number | null;
  pr_url: string | null;
  last_run_id: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface HarvestOperationRow {
  operation_id: string;
  project_id: string;
  work_key: string;
  repo_slug: string | null;
  head_repo_slug: string | null;
  trunk_branch: string;
  feature_id: string;
  phase_id: string | null;
  pr_number: number | null;
  pr_url: string | null;
  head_branch: string | null;
  expected_head_sha: string | null;
  terminal_event: HarvestTerminalEvent;
  merge_commit_sha: string | null;
  terminal_at: string;
  recipient_json: string | null;
  planned_slack_recipient_json: string | null;
  status: HarvestOperationStatus;
  lease_owner: string | null;
  lease_epoch: number;
  lease_expires_at: string | null;
  linked_run_id: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface HarvestStageReceiptRow {
  operation_id: string;
  phase_key: string;
  stage: HarvestStageName;
  status: HarvestStageStatus;
  lease_epoch: number;
  attempt_count: number;
  evidence_json: string | null;
  error: string | null;
  updated_at: string;
  completed_at: string | null;
}

interface NotificationOutboxRow {
  outbox_id: string;
  project_id: string;
  dedupe_key: string;
  owner_kind: OutboxMessage["ownerKind"];
  owner_operation_id: string;
  event_type: string;
  feature_id: string;
  phase_id: string | null;
  recipient_json: string;
  payload_json: string;
  client_metadata_key: string;
  status: OutboxStatus;
  workspace_id: string | null;
  channel_id: string | null;
  thread_ts: string | null;
  message_ts: string | null;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
}

interface HarvestCursorRow {
  project_id: string;
  last_polled_at: string;
  last_terminal_at: string | null;
  last_pr_number: number | null;
  last_error: string | null;
}

interface HarvestDeliveryRow {
  project_id: string | null;
  repo_slug: string | null;
  checkout_repo_slug: string | null;
  payload_digest: string;
}

interface ProjectSlackRow {
  slack_workspace_id: string | null;
  slack_channel: string | null;
  slack_channel_name: string | null;
  slack_ops_channel_id: string | null;
  shared_channel: number;
}

interface SlackFeatureThreadRow {
  project_id: string;
  feature_id: string;
  workspace_id: string;
  channel_id: string;
  root_ts: string;
  updated_at: string;
}

interface PendingStageRow {
  operation_id: string;
  feature_id: string;
  phase_key: string;
  stage: HarvestStageName;
  status: HarvestStageStatus;
}

type HarvestIntakeRejection =
  | "DELIVERY_ID_CONFLICT"
  | "HARVEST_IDENTITY_MISMATCH";

class HarvestIntakeRollbackError extends Error {
  constructor(readonly code: HarvestIntakeRejection) {
    super(code);
  }
}

const activeDispatchStatuses: readonly DispatchOperationStatus[] = [
  "leased",
  "running",
  "reconciling",
];

function leaseIsRecoverable(
  leaseExpiresAt: string | null,
  nowMs: number,
): boolean {
  return leaseExpiresAt === null || Date.parse(leaseExpiresAt) <= nowMs;
}

function rowToDispatchOperation(
  row: DispatchOperationRow,
): DurableDispatchOperation {
  return {
    operationId: row.operation_id,
    projectId: row.project_id,
    workKey: row.work_key,
    featureId: row.feature_id,
    phaseId: row.phase_id,
    taskIds: JSON.parse(row.task_ids_json || "[]") as string[],
    backend: row.backend,
    branchName: row.branch_name,
    trunkBranch: row.trunk_branch,
    recipient: row.recipient_json ? JSON.parse(row.recipient_json) : null,
    status: row.status,
    attemptCount: row.attempt_count,
    leaseOwner: row.lease_owner,
    leaseEpoch: row.lease_epoch,
    leaseExpiresAt: row.lease_expires_at,
    heartbeatAt: row.heartbeat_at,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    lastRunId: row.last_run_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    evidenceLevel: "durable_verified",
  };
}

function rowToHarvestOperation(
  row: HarvestOperationRow,
): DurableHarvestOperation {
  return {
    operationId: row.operation_id,
    projectId: row.project_id,
    workKey: row.work_key,
    repoSlug: row.repo_slug,
    headRepoSlug: row.head_repo_slug,
    trunkBranch: row.trunk_branch,
    featureId: row.feature_id,
    phaseId: row.phase_id,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    headBranch: row.head_branch,
    expectedHeadSha: row.expected_head_sha,
    terminalEvent: row.terminal_event,
    mergeCommitSha: row.merge_commit_sha,
    terminalAt: row.terminal_at,
    recipient: row.recipient_json ? JSON.parse(row.recipient_json) : null,
    plannedSlackRecipient: row.planned_slack_recipient_json
      ? JSON.parse(row.planned_slack_recipient_json)
      : null,
    status: row.status,
    leaseOwner: row.lease_owner,
    leaseEpoch: row.lease_epoch,
    leaseExpiresAt: row.lease_expires_at,
    linkedRunId: row.linked_run_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function rowToHarvestStageReceipt(
  row: HarvestStageReceiptRow,
): HarvestStageReceipt {
  return {
    operationId: row.operation_id,
    phaseKey: row.phase_key,
    stage: row.stage,
    status: row.status,
    leaseEpoch: row.lease_epoch,
    attemptCount: row.attempt_count,
    evidenceJson: row.evidence_json,
    error: row.error,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function rowToOutboxItem(row: NotificationOutboxRow): OutboxItem {
  return {
    outboxId: row.outbox_id,
    projectId: row.project_id,
    dedupeKey: row.dedupe_key,
    ownerKind: row.owner_kind,
    ownerOperationId: row.owner_operation_id,
    eventType: row.event_type,
    featureId: row.feature_id,
    phaseId: row.phase_id,
    recipient: JSON.parse(row.recipient_json),
    payload: JSON.parse(row.payload_json),
    clientMetadataKey: row.client_metadata_key,
    status: row.status,
    workspaceId: row.workspace_id,
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    messageTs: row.message_ts,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deliveredAt: row.delivered_at,
  };
}

function rowToHarvestCursor(row: HarvestCursorRow): HarvestCursor {
  return {
    projectId: row.project_id,
    lastPolledAt: row.last_polled_at,
    lastTerminalAt: row.last_terminal_at,
    lastPrNumber: row.last_pr_number,
    lastError: row.last_error,
  };
}

function matchHarvestScope(
  db: Database.Database,
  incoming: DurableHarvestOperation,
  receivedAt: string,
): DurableHarvestOperation | null {
  const projectOps = db
    .prepare<[string], HarvestOperationRow>(
      "SELECT * FROM harvest_operations WHERE project_id = ? ORDER BY julianday(created_at) ASC, operation_id ASC",
    )
    .all(incoming.projectId)
    .map(rowToHarvestOperation);

  const staleMerge = projectOps.find((row) =>
    isStaleHarvestClose(row, incoming),
  );
  if (staleMerge) return staleMerge;

  const aliasRow = db
    .prepare<[string, string], { operation_id: string }>(
      "SELECT operation_id FROM harvest_work_key_aliases WHERE project_id = ? AND work_key = ?",
    )
    .get(incoming.projectId, incoming.workKey);

  const keyOwners = projectOps.filter(
    (row) =>
      row.workKey === incoming.workKey ||
      row.operationId === aliasRow?.operation_id,
  );
  const existing =
    keyOwners.find(
      (row) =>
        sharesHarvestRepositoryScope(row, incoming) &&
        row.featureId === incoming.featureId &&
        row.phaseId === incoming.phaseId &&
        row.terminalEvent === incoming.terminalEvent &&
        row.mergeCommitSha === incoming.mergeCommitSha &&
        (row.prNumber === incoming.prNumber ||
          canCorrelateHarvestIntake(row, incoming)),
    ) ?? projectOps.find((row) => canCorrelateHarvestIntake(row, incoming));

  if (keyOwners.some((row) => row.operationId !== existing?.operationId))
    return null;

  if (!existing) {
    const idConflict = db
      .prepare("SELECT 1 FROM harvest_operations WHERE operation_id = ?")
      .get(incoming.operationId);
    if (idConflict) return null;

    db.prepare(
      `INSERT INTO harvest_operations (
        operation_id, project_id, work_key, repo_slug, head_repo_slug,
        trunk_branch, feature_id, phase_id, pr_number, pr_url,
        head_branch, expected_head_sha, terminal_event, merge_commit_sha, terminal_at,
        recipient_json, planned_slack_recipient_json, status, lease_owner,
        lease_epoch, lease_expires_at, linked_run_id, last_error,
        created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      incoming.operationId,
      incoming.projectId,
      incoming.workKey,
      incoming.repoSlug,
      incoming.headRepoSlug,
      incoming.trunkBranch,
      incoming.featureId,
      incoming.phaseId,
      incoming.prNumber,
      incoming.prUrl,
      incoming.headBranch,
      incoming.expectedHeadSha,
      incoming.terminalEvent,
      incoming.mergeCommitSha,
      incoming.terminalAt,
      incoming.recipient ? JSON.stringify(incoming.recipient) : null,
      incoming.plannedSlackRecipient
        ? JSON.stringify(incoming.plannedSlackRecipient)
        : null,
      incoming.status,
      incoming.leaseOwner,
      incoming.leaseEpoch,
      incoming.leaseExpiresAt,
      incoming.linkedRunId,
      incoming.lastError,
      incoming.createdAt,
      incoming.updatedAt,
      incoming.completedAt,
    );

    return incoming;
  }

  const result = mergeVerifiedHarvestFacts(existing, incoming);
  if (result.kind === "conflict") return null;

  if (!aliasRow && existing.workKey !== incoming.workKey) {
    db.prepare(
      `INSERT INTO harvest_work_key_aliases (project_id, work_key, operation_id)
       VALUES (?, ?, ?)`,
    ).run(incoming.projectId, incoming.workKey, existing.operationId);
  }

  if (result.kind === "unchanged") return existing;

  const stageRows = db
    .prepare<string[], HarvestStageReceiptRow>(
      "SELECT * FROM harvest_stage_receipts WHERE operation_id = ?",
    )
    .all(existing.operationId)
    .map(rowToHarvestStageReceipt);

  const cleanup = planLateBranchCleanup({
    operationId: existing.operationId,
    prior: existing,
    verified: incoming,
    stages: stageRows,
    nowIso: receivedAt,
  });

  Object.assign(existing, result.facts, { updatedAt: receivedAt });

  if (cleanup.length) {
    for (const planned of cleanup) {
      const receipt = stageRows.find(
        (s) => s.phaseKey === planned.phaseKey && s.stage === planned.stage,
      );
      if (receipt) {
        Object.assign(receipt, planned);
        db.prepare(
          `UPDATE harvest_stage_receipts SET
            status = ?,
            lease_epoch = ?,
            attempt_count = ?,
            evidence_json = ?,
            error = ?,
            updated_at = ?,
            completed_at = ?
          WHERE operation_id = ? AND phase_key = ? AND stage = ?`,
        ).run(
          planned.status,
          planned.leaseEpoch,
          planned.attemptCount,
          planned.evidenceJson,
          planned.error,
          planned.updatedAt,
          planned.completedAt,
          existing.operationId,
          planned.phaseKey,
          planned.stage,
        );
      }
    }
    existing.status = deriveHarvestTerminalStatus({
      terminalEvent: existing.terminalEvent,
      phaseIds: [...new Set(stageRows.map((s) => s.phaseKey))],
      stages: stageRows,
    });
    existing.completedAt = null;
  }

  db.prepare(
    `UPDATE harvest_operations SET
      head_branch = ?,
      expected_head_sha = ?,
      head_repo_slug = ?,
      repo_slug = ?,
      merge_commit_sha = ?,
      pr_number = ?,
      pr_url = ?,
      terminal_at = ?,
      status = ?,
      updated_at = ?,
      completed_at = ?
    WHERE operation_id = ?`,
  ).run(
    existing.headBranch,
    existing.expectedHeadSha,
    existing.headRepoSlug,
    existing.repoSlug,
    existing.mergeCommitSha,
    existing.prNumber,
    existing.prUrl,
    existing.terminalAt,
    existing.status,
    receivedAt,
    existing.completedAt,
    existing.operationId,
  );

  return existing;
}

export interface CreateOperationsStoreOptions {
  close?: () => void;
  readLegacyDispatches?: (root: string) => readonly unknown[];
}

export function createOperationsStore(
  db: Database.Database,
  options?: CreateOperationsStoreOptions | (() => void),
): OperationsStorePort {
  const store: OperationsStorePort = {
    acceptDispatch(input: DispatchAcceptanceRequest): DispatchReceipt {
      const workKey = computeDispatchWorkKey(input);
      const transaction = db.transaction((): DispatchReceipt => {
        const existingRow = db
          .prepare<string[], DispatchOperationRow>(
            `SELECT * FROM dispatch_operations
           WHERE project_id = ? AND work_key = ? AND status IN ('accepted', 'leased', 'running', 'reconciling')
           ORDER BY created_at DESC, operation_id DESC
           LIMIT 1`,
          )
          .get(input.projectId, workKey);

        const existingActive = existingRow
          ? rowToDispatchOperation(existingRow)
          : null;
        const decision = evaluateDispatchAcceptance({
          ...input,
          existingActive,
        });

        if (decision.kind === "create_new") {
          const op = decision.operation;
          db.prepare(
            `INSERT INTO dispatch_operations (
            operation_id, project_id, work_key, feature_id, phase_id,
            task_ids_json, backend, branch_name, trunk_branch, recipient_json,
            status, attempt_count, lease_owner, lease_epoch, lease_expires_at,
            heartbeat_at, pr_number, pr_url, last_run_id, last_error,
            created_at, updated_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            op.operationId,
            op.projectId,
            op.workKey,
            op.featureId,
            op.phaseId,
            JSON.stringify(op.taskIds),
            op.backend,
            op.branchName,
            op.trunkBranch,
            op.recipient ? JSON.stringify(op.recipient) : null,
            op.status,
            op.attemptCount,
            op.leaseOwner,
            op.leaseEpoch,
            op.leaseExpiresAt,
            op.heartbeatAt,
            op.prNumber,
            op.prUrl,
            op.lastRunId,
            op.lastError,
            op.createdAt,
            op.updatedAt,
            op.completedAt,
          );
        }

        return decision.receipt;
      });
      return transaction.immediate();
    },

    claimDispatchLease(input: {
      operationId: string;
      leaseOwner: string;
      nowIso: string;
      leaseExpiresAt: string;
    }): { fence: LeaseFence; operation: DurableDispatchOperation } | null {
      const transaction = db.transaction(
        (): {
          fence: LeaseFence;
          operation: DurableDispatchOperation;
        } | null => {
          const row = db
            .prepare<string[], DispatchOperationRow>(
              "SELECT * FROM dispatch_operations WHERE operation_id = ?",
            )
            .get(input.operationId);
          if (!row) return null;
          const op = rowToDispatchOperation(row);

          if (
            (op.status !== "accepted" &&
              !activeDispatchStatuses.includes(op.status)) ||
            !leaseIsRecoverable(op.leaseExpiresAt, Date.parse(input.nowIso))
          ) {
            return null;
          }

          const nextEpoch = op.leaseEpoch + 1;
          const nextAttempt = op.attemptCount + 1;

          const res = db
            .prepare(
              `UPDATE dispatch_operations SET
            lease_owner = ?,
            lease_epoch = ?,
            lease_expires_at = ?,
            heartbeat_at = ?,
            status = 'leased',
            attempt_count = ?,
            updated_at = ?
          WHERE operation_id = ? AND lease_epoch = ?`,
            )
            .run(
              input.leaseOwner,
              nextEpoch,
              input.leaseExpiresAt,
              input.nowIso,
              nextAttempt,
              input.nowIso,
              input.operationId,
              op.leaseEpoch,
            );

          if (res.changes === 0) return null;

          db.prepare(
            `INSERT INTO dispatch_attempts (
          operation_id, attempt_number, lease_epoch, lease_owner, backend,
          status, run_id, worktree_dir, exit_code, error, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, 'running', NULL, NULL, NULL, NULL, ?, NULL)`,
          ).run(
            input.operationId,
            nextAttempt,
            nextEpoch,
            input.leaseOwner,
            op.backend,
            input.nowIso,
          );

          const updatedRow = db
            .prepare<string[], DispatchOperationRow>(
              "SELECT * FROM dispatch_operations WHERE operation_id = ?",
            )
            .get(input.operationId);
          if (!updatedRow)
            throw new Error("Claimed dispatch operation is missing");
          const updatedOp = rowToDispatchOperation(updatedRow);

          return {
            fence: {
              operationId: input.operationId,
              leaseOwner: input.leaseOwner,
              leaseEpoch: nextEpoch,
            },
            operation: updatedOp,
          };
        },
      );
      return transaction.immediate();
    },

    heartbeatDispatchLease(input: {
      fence: LeaseFence;
      nowIso: string;
      leaseExpiresAt: string;
    }): FencedWrite {
      const transaction = db.transaction((): FencedWrite => {
        const row = db
          .prepare<string[], DispatchOperationRow>(
            "SELECT * FROM dispatch_operations WHERE operation_id = ?",
          )
          .get(input.fence.operationId);
        if (!row) return { ok: false, code: "LEASE_FENCED" };
        const op = rowToDispatchOperation(row);
        if (!activeDispatchStatuses.includes(op.status)) {
          return { ok: false, code: "LEASE_FENCED" };
        }
        const validation = validateLeaseFence(op, input.fence, input.nowIso);
        if (!validation.ok) return validation;

        if (
          op.leaseExpiresAt !== null &&
          Date.parse(input.leaseExpiresAt) <= Date.parse(op.leaseExpiresAt)
        ) {
          return { ok: true };
        }

        db.prepare(
          `UPDATE dispatch_operations SET
          lease_expires_at = ?,
          heartbeat_at = ?,
          updated_at = ?
        WHERE operation_id = ? AND lease_epoch = ?`,
        ).run(
          input.leaseExpiresAt,
          input.nowIso,
          input.nowIso,
          input.fence.operationId,
          input.fence.leaseEpoch,
        );

        return { ok: true };
      });
      return transaction.immediate();
    },

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
    }): FencedWrite {
      const transaction = db.transaction((): FencedWrite => {
        const row = db
          .prepare<string[], DispatchOperationRow>(
            "SELECT * FROM dispatch_operations WHERE operation_id = ?",
          )
          .get(input.fence.operationId);
        if (!row) return { ok: false, code: "LEASE_FENCED" };
        const op = rowToDispatchOperation(row);

        if (!activeDispatchStatuses.includes(op.status)) {
          return { ok: false, code: "LEASE_FENCED" };
        }
        const validation = validateLeaseFence(op, input.fence, input.nowIso);
        if (!validation.ok) return validation;
        db.prepare(
          `UPDATE dispatch_attempts SET
          status = ?,
          run_id = COALESCE(?, run_id),
          worktree_dir = COALESCE(?, worktree_dir),
          exit_code = COALESCE(?, exit_code),
          error = COALESCE(?, error),
          finished_at = ?
        WHERE operation_id = ? AND lease_epoch = ?`,
        ).run(
          input.attemptStatus,
          input.runId ?? null,
          input.worktreeDir ?? null,
          input.exitCode ?? null,
          input.error ?? null,
          input.nowIso,
          input.fence.operationId,
          input.fence.leaseEpoch,
        );

        db.prepare(
          `UPDATE dispatch_operations SET
            status = ?,
            lease_owner = NULL,
            lease_expires_at = NULL,
            heartbeat_at = NULL,
            last_run_id = COALESCE(?, last_run_id),
            last_error = COALESCE(?, last_error),
            pr_number = COALESCE(?, pr_number),
            pr_url = COALESCE(?, pr_url),
            updated_at = ?,
            completed_at = ?
          WHERE operation_id = ? AND lease_epoch = ?`,
        ).run(
          input.operationStatus,
          input.runId ?? null,
          input.error ?? null,
          input.prNumber ?? null,
          input.prUrl ?? null,
          input.nowIso,
          input.operationStatus === "accepted" ? null : input.nowIso,
          input.fence.operationId,
          input.fence.leaseEpoch,
        );

        return { ok: true };
      });
      return transaction.immediate();
    },

    listRecoverableDispatches(input: {
      nowIso: string;
      projectId?: string;
    }): DurableDispatchOperation[] {
      let sql = `SELECT * FROM dispatch_operations
        WHERE status IN ('accepted', 'leased', 'running', 'reconciling')`;
      const params: string[] = [];
      if (input.projectId !== undefined) {
        sql += " AND project_id = ?";
        params.push(input.projectId);
      }
      sql += " ORDER BY julianday(created_at) ASC, operation_id ASC";
      const nowMs = Date.parse(input.nowIso);
      return db
        .prepare<string[], DispatchOperationRow>(sql)
        .all(...params)
        .filter((row) => leaseIsRecoverable(row.lease_expires_at, nowMs))
        .map(rowToDispatchOperation);
    },

    getDispatchOperation(input: {
      projectId: string;
      featureId: string;
      phaseId: string;
    }): DurableDispatchOperation | null {
      const row = db
        .prepare<string[], DispatchOperationRow>(
          `SELECT * FROM dispatch_operations
           WHERE project_id = ? AND feature_id = ? AND phase_id = ?
           ORDER BY julianday(created_at) DESC, operation_id DESC
           LIMIT 1`,
        )
        .get(input.projectId, input.featureId, input.phaseId);
      return row ? rowToDispatchOperation(row) : null;
    },

    recordHarvestIntake(input: {
      candidate: HarvestCandidateInput;
      payloadDigest: string;
      receivedAt: string;
      target:
        | {
            accepted: true;
            project: EnrolledProject;
            checkoutPhaseIds?: readonly string[];
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
          deduplicatedWork: boolean;
        }
      | {
          ok: false;
          code: HarvestIntakeRejection;
        } {
      const transaction = db.transaction(() => {
        const repoSlug = input.candidate.repoSlug?.toLowerCase() ?? null;
        const checkoutRepoSlug =
          input.candidate.source === "manual_cli" &&
          input.candidate.prNumber === null
            ? (input.candidate.checkoutRepoSlug?.toLowerCase() ?? null)
            : null;
        const targetProjectId = input.target.accepted
          ? input.target.project.projectId
          : input.target.projectId;

        const existingDelivery = db
          .prepare<[string, string], HarvestDeliveryRow>(
            "SELECT * FROM harvest_deliveries WHERE source = ? AND delivery_id = ?",
          )
          .get(input.candidate.source, input.candidate.deliveryId);

        if (existingDelivery) {
          const deliveryProj = existingDelivery.project_id ?? null;
          const targetProj = targetProjectId ?? null;
          const deliveryRepo = existingDelivery.repo_slug
            ? existingDelivery.repo_slug.toLowerCase()
            : null;
          const deliveryCheckoutRepo = existingDelivery.checkout_repo_slug
            ? existingDelivery.checkout_repo_slug.toLowerCase()
            : null;

          if (
            deliveryProj !== targetProj ||
            existingDelivery.payload_digest !== input.payloadDigest ||
            deliveryRepo !== repoSlug ||
            deliveryCheckoutRepo !== checkoutRepoSlug
          ) {
            throw new HarvestIntakeRollbackError("DELIVERY_ID_CONFLICT");
          }

          const linkedRows = db
            .prepare<[string, string], HarvestOperationRow>(
              `SELECT h.* FROM harvest_delivery_operations d
               JOIN harvest_operations h ON h.project_id = d.project_id AND h.operation_id = d.operation_id
               WHERE d.source = ? AND d.delivery_id = ?
               ORDER BY d.position ASC`,
            )
            .all(input.candidate.source, input.candidate.deliveryId);

          const operations = linkedRows.map(rowToHarvestOperation);
          return {
            ok: true as const,
            operations,
            deduplicatedTransport: true,
            deduplicatedWork: operations.length > 0,
          };
        }

        if (
          input.target.accepted &&
          (!verifyHarvestIntakeOperations(
            input.target.project,
            input.candidate,
            input.target.checkoutPhaseIds,
            input.target.operations,
          ) ||
            input.target.operations.some(
              (row) =>
                row.status !== "accepted" ||
                row.leaseEpoch !== 0 ||
                row.leaseOwner !== null ||
                row.leaseExpiresAt !== null ||
                row.completedAt !== null ||
                row.linkedRunId !== null ||
                row.lastError !== null ||
                row.plannedSlackRecipient !== null,
            ))
        ) {
          throw new HarvestIntakeRollbackError("HARVEST_IDENTITY_MISMATCH");
        }

        const incoming: DurableHarvestOperation[] = input.target.accepted
          ? input.target.operations.map((operation) => ({
              ...operation,
              recipient:
                operation.prNumber === null
                  ? null
                  : (input.candidate.recipient ?? null),
            }))
          : [];

        const operations: DurableHarvestOperation[] = [];
        for (const operation of incoming) {
          const matched = matchHarvestScope(db, operation, input.receivedAt);
          if (!matched)
            throw new HarvestIntakeRollbackError("HARVEST_IDENTITY_MISMATCH");
          operations.push(matched);
        }

        db.prepare(
          `INSERT INTO harvest_deliveries (
            source, delivery_id, project_id, repo_slug, checkout_repo_slug,
            payload_digest, event_type, outcome, reason, received_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          input.candidate.source,
          input.candidate.deliveryId,
          targetProjectId,
          repoSlug,
          checkoutRepoSlug,
          input.payloadDigest,
          input.candidate.terminalEvent,
          input.target.accepted ? "accepted" : "rejected",
          input.target.accepted ? null : input.target.reason,
          input.receivedAt,
        );

        const insertDeliveryOp = db.prepare(
          `INSERT INTO harvest_delivery_operations (
            source, delivery_id, project_id, position, operation_id
          ) VALUES (?, ?, ?, ?, ?)`,
        );

        for (let i = 0; i < operations.length; i++) {
          insertDeliveryOp.run(
            input.candidate.source,
            input.candidate.deliveryId,
            targetProjectId,
            i,
            operations[i].operationId,
          );
        }

        return {
          ok: true as const,
          operations,
          deduplicatedTransport: false,
          deduplicatedWork:
            operations.length > 0 &&
            operations.every((row, index) => row !== incoming[index]),
        };
      });
      try {
        return transaction.immediate();
      } catch (error) {
        if (error instanceof HarvestIntakeRollbackError) {
          return { ok: false, code: error.code };
        }
        throw error;
      }
    },

    listRecoverableHarvests(input: {
      nowIso: string;
      projectId?: string;
    }): DurableHarvestOperation[] {
      let sql = `SELECT * FROM harvest_operations
        WHERE status IN ('accepted', 'running', 'delivery_pending')`;
      const params: string[] = [];
      if (input.projectId !== undefined) {
        sql += " AND project_id = ?";
        params.push(input.projectId);
      }
      sql += " ORDER BY julianday(created_at) ASC, operation_id ASC";
      const nowMs = Date.parse(input.nowIso);
      return db
        .prepare<string[], HarvestOperationRow>(sql)
        .all(...params)
        .filter((row) => leaseIsRecoverable(row.lease_expires_at, nowMs))
        .map(rowToHarvestOperation);
    },

    claimHarvestLease(input: {
      operationId: string;
      leaseOwner: string;
      nowIso: string;
      leaseExpiresAt: string;
    }): {
      fence: LeaseFence;
      operation: DurableHarvestOperation;
      stages: HarvestStageReceipt[];
    } | null {
      const transaction = db.transaction(
        (): {
          fence: LeaseFence;
          operation: DurableHarvestOperation;
          stages: HarvestStageReceipt[];
        } | null => {
          const recoverable = this.listRecoverableHarvests({
            nowIso: input.nowIso,
          });
          const op = recoverable.find(
            (r) => r.operationId === input.operationId,
          );
          if (!op) return null;

          const nextEpoch = op.leaseEpoch + 1;
          const res = db
            .prepare(
              `UPDATE harvest_operations SET
            lease_owner = ?,
            lease_epoch = ?,
            lease_expires_at = ?,
            updated_at = ?
          WHERE operation_id = ? AND lease_epoch = ?`,
            )
            .run(
              input.leaseOwner,
              nextEpoch,
              input.leaseExpiresAt,
              input.nowIso,
              input.operationId,
              op.leaseEpoch,
            );

          if (res.changes === 0) return null;

          const updatedRow = db
            .prepare<string[], HarvestOperationRow>(
              "SELECT * FROM harvest_operations WHERE operation_id = ?",
            )
            .get(input.operationId);
          if (!updatedRow)
            throw new Error("Claimed harvest operation is missing");
          const updatedOp = rowToHarvestOperation(updatedRow);

          const stages = db
            .prepare<string[], HarvestStageReceiptRow>(
              "SELECT * FROM harvest_stage_receipts WHERE operation_id = ?",
            )
            .all(input.operationId)
            .map(rowToHarvestStageReceipt);

          return {
            fence: {
              operationId: input.operationId,
              leaseOwner: input.leaseOwner,
              leaseEpoch: nextEpoch,
            },
            operation: updatedOp,
            stages,
          };
        },
      );
      return transaction.immediate();
    },

    heartbeatHarvestLease(input: {
      fence: LeaseFence;
      nowIso: string;
      leaseExpiresAt: string;
    }): FencedWrite {
      const transaction = db.transaction((): FencedWrite => {
        const row = db
          .prepare<string[], HarvestOperationRow>(
            "SELECT * FROM harvest_operations WHERE operation_id = ?",
          )
          .get(input.fence.operationId);
        if (!row) return { ok: false, code: "LEASE_FENCED" };
        const op = rowToHarvestOperation(row);
        const validation = validateLeaseFence(op, input.fence, input.nowIso);
        if (!validation.ok) return validation;

        if (
          op.leaseExpiresAt !== null &&
          Date.parse(input.leaseExpiresAt) <= Date.parse(op.leaseExpiresAt)
        ) {
          return { ok: true };
        }

        db.prepare(
          `UPDATE harvest_operations SET
          lease_expires_at = ?,
          updated_at = ?
        WHERE operation_id = ? AND lease_epoch = ?`,
        ).run(
          input.leaseExpiresAt,
          input.nowIso,
          input.fence.operationId,
          input.fence.leaseEpoch,
        );

        return { ok: true };
      });
      return transaction.immediate();
    },

    initializeHarvestStages(input: {
      fence: LeaseFence;
      nowIso: string;
      phaseIds: readonly string[];
      hasSlackTarget: boolean;
      hasRemoteBranchTarget: boolean;
      stages: readonly HarvestStagePlanEntry[];
    }): FencedWrite | { ok: false; code: "HARVEST_PLAN_CONFLICT" } {
      const transaction = db.transaction(
        (): FencedWrite | { ok: false; code: "HARVEST_PLAN_CONFLICT" } => {
          const row = db
            .prepare<string[], HarvestOperationRow>(
              "SELECT * FROM harvest_operations WHERE operation_id = ?",
            )
            .get(input.fence.operationId);
          if (!row) return { ok: false, code: "LEASE_FENCED" };
          const op = rowToHarvestOperation(row);
          const lease = validateLeaseFence(op, input.fence, input.nowIso);
          if (!lease.ok) return lease;

          const saved = db
            .prepare<string[], HarvestStageReceiptRow>(
              "SELECT * FROM harvest_stage_receipts WHERE operation_id = ?",
            )
            .all(input.fence.operationId)
            .map(rowToHarvestStageReceipt);

          let recipient: HarvestSlackRecipient | null;
          if (saved.length) {
            recipient = op.plannedSlackRecipient;
          } else {
            const projectRow = db
              .prepare<[string], ProjectSlackRow>(
                "SELECT * FROM projects WHERE id = ? AND updated_at IS NOT NULL",
              )
              .get(op.projectId);
            const binding: ProjectSlackBinding | null =
              projectRow?.slack_workspace_id && projectRow?.slack_channel
                ? {
                    workspaceId: projectRow.slack_workspace_id,
                    channelId: projectRow.slack_channel,
                    ...(projectRow.slack_channel_name
                      ? { channelName: projectRow.slack_channel_name }
                      : {}),
                    ...(projectRow.slack_ops_channel_id
                      ? { opsChannelId: projectRow.slack_ops_channel_id }
                      : {}),
                    sharedChannel: projectRow.shared_channel === 1,
                  }
                : null;

            const threadRow = binding
              ? db
                  .prepare<
                    [string, string, string, string],
                    SlackFeatureThreadRow
                  >(
                    `SELECT * FROM slack_feature_threads
                   WHERE project_id = ? AND feature_id = ? AND workspace_id = ? AND channel_id = ?`,
                  )
                  .get(
                    op.projectId,
                    op.featureId,
                    binding.workspaceId,
                    binding.channelId,
                  )
              : undefined;
            const thread: SlackFeatureThread | undefined = threadRow
              ? {
                  projectId: threadRow.project_id,
                  featureId: threadRow.feature_id,
                  workspaceId: threadRow.workspace_id,
                  channelId: threadRow.channel_id,
                  rootTs: threadRow.root_ts,
                  updatedAt: threadRow.updated_at,
                }
              : undefined;

            recipient = resolveHarvestSlackRecipient({
              projectId: op.projectId,
              featureId: op.featureId,
              recipient: op.recipient,
              binding,
              thread,
            });
          }

          if (
            (op.phaseId !== null &&
              (input.phaseIds.length !== 1 ||
                input.phaseIds[0] !== op.phaseId)) ||
            !isCompleteHarvestStagePlan({
              terminalEvent: op.terminalEvent,
              phaseIds: input.phaseIds,
              hasSlackTarget: recipient !== null,
              hasRemoteBranchTarget: hasVerifiedBranchCleanupTarget(op),
              stages: input.stages,
            })
          ) {
            return { ok: false, code: "HARVEST_PLAN_CONFLICT" };
          }

          const key = ({
            phaseKey,
            stage,
          }: { phaseKey: string; stage: string }) =>
            JSON.stringify([phaseKey, stage]);
          const keys = new Set(input.stages.map(key));
          if (
            saved.length &&
            (saved.length !== keys.size ||
              !saved.every((entry) => keys.has(key(entry))))
          ) {
            return { ok: false, code: "HARVEST_PLAN_CONFLICT" };
          }

          if (!saved.length) {
            db.prepare(
              `UPDATE harvest_operations SET
            planned_slack_recipient_json = ?,
            updated_at = ?
          WHERE operation_id = ? AND lease_epoch = ?`,
            ).run(
              recipient ? JSON.stringify(recipient) : null,
              input.nowIso,
              input.fence.operationId,
              input.fence.leaseEpoch,
            );

            const insertStage = db.prepare(
              `INSERT INTO harvest_stage_receipts (
            operation_id, phase_key, stage, status, lease_epoch, attempt_count,
            evidence_json, error, updated_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, ?, NULL)`,
            );
            for (const entry of input.stages) {
              insertStage.run(
                input.fence.operationId,
                entry.phaseKey,
                entry.stage,
                entry.initialStatus,
                input.fence.leaseEpoch,
                input.nowIso,
              );
            }
          }

          return { ok: true };
        },
      );
      return transaction.immediate();
    },

    transitionHarvestStage(
      input: {
        fence: LeaseFence;
        nowIso: string;
        phaseKey: string;
        stage: HarvestStageName;
        evidenceJson?: string | null;
        error?: string | null;
        linkedRunId?: number | null;
      } & (
        | { status: "gate_failed"; failureNotice: OutboxMessage | null }
        | {
            status: Exclude<HarvestStageStatus, "gate_failed">;
            failureNotice?: never;
          }
      ),
    ):
      | FencedWrite
      | {
          ok: false;
          code: "HARVEST_STAGE_UNPLANNED" | "HARVEST_STAGE_TRANSITION_INVALID";
        } {
      const transaction = db.transaction(
        ():
          | FencedWrite
          | {
              ok: false;
              code:
                | "HARVEST_STAGE_UNPLANNED"
                | "HARVEST_STAGE_TRANSITION_INVALID";
            } => {
          const row = db
            .prepare<string[], HarvestOperationRow>(
              "SELECT * FROM harvest_operations WHERE operation_id = ?",
            )
            .get(input.fence.operationId);
          if (!row) return { ok: false, code: "LEASE_FENCED" };
          const op = rowToHarvestOperation(row);
          const lease = validateLeaseFence(op, input.fence, input.nowIso);
          if (!lease.ok) return lease;

          const planned = db
            .prepare<string[], HarvestStageReceiptRow>(
              "SELECT * FROM harvest_stage_receipts WHERE operation_id = ?",
            )
            .all(input.fence.operationId)
            .map(rowToHarvestStageReceipt);

          const receipt = planned.find(
            (entry) =>
              entry.phaseKey === input.phaseKey && entry.stage === input.stage,
          );
          if (!receipt) return { ok: false, code: "HARVEST_STAGE_UNPLANNED" };

          const invalid = {
            ok: false,
            code: "HARVEST_STAGE_TRANSITION_INVALID",
          } as const;
          const gateFailure =
            input.stage === "gate_verify" && input.status === "gate_failed";
          const replay =
            gateFailure &&
            op.status === "gate_failed" &&
            receipt.status === "gate_failed";
          const resumableHarvests = ["accepted", "running", "delivery_pending"];

          if (
            !replay &&
            (!resumableHarvests.includes(op.status) ||
              !isValidHarvestStageTransition(receipt, input.status))
          ) {
            return invalid;
          }

          if (gateFailure) {
            const dedupeKey = JSON.stringify([
              "harvest_gate_failed",
              op.operationId,
              input.phaseKey,
            ]);
            const savedNoticeRow = db
              .prepare<string[], NotificationOutboxRow>(
                "SELECT * FROM notification_outbox WHERE project_id = ? AND dedupe_key = ?",
              )
              .get(op.projectId, dedupeKey);
            const savedNotice = savedNoticeRow
              ? rowToOutboxItem(savedNoticeRow)
              : null;
            const recipient = op.plannedSlackRecipient;

            const matchesNotice = (notice: OutboxMessage) =>
              notice.eventType === "harvest_gate_failed" &&
              notice.ownerKind === "harvest" &&
              notice.ownerOperationId === op.operationId &&
              notice.projectId === op.projectId &&
              recipient?.projectId === op.projectId &&
              matchesHarvestNoticeRecipient(recipient, notice.recipient) &&
              notice.featureId === op.featureId &&
              notice.phaseId === input.phaseKey;

            if (savedNotice) {
              const { workspaceId, channelId, threadTs } = savedNotice;
              const unboundPending =
                savedNotice.status === "pending" &&
                workspaceId === null &&
                channelId === null &&
                threadTs === null;
              const matchesDestination =
                recipient !== null &&
                workspaceId === recipient.workspaceId &&
                channelId === recipient.channelId &&
                threadTs === (recipient.threadTs ?? null);

              if (
                !matchesNotice(savedNotice) ||
                savedNotice.status === "skipped_no_target" ||
                (savedNotice.status === "delivered" &&
                  !savedNotice.messageTs?.trim()) ||
                !savedNotice.clientMetadataKey.trim() ||
                !(unboundPending || matchesDestination)
              ) {
                return invalid;
              }
            }

            const failureNotice =
              input.status === "gate_failed" ? input.failureNotice : undefined;
            if ((recipient !== null) !== (failureNotice != null))
              return invalid;
            if (failureNotice && !matchesNotice(failureNotice)) return invalid;
            if (replay)
              return recipient && !savedNotice ? invalid : { ok: true };

            if (failureNotice && recipient && !savedNotice) {
              if (!failureNotice.clientMetadataKey?.trim()) {
                return invalid;
              }
              const existingOutbox = db
                .prepare(
                  "SELECT 1 FROM notification_outbox WHERE outbox_id = ? OR client_metadata_key = ?",
                )
                .get(failureNotice.outboxId, failureNotice.clientMetadataKey);
              if (existingOutbox) {
                return invalid;
              }

              db.prepare(
                `INSERT INTO notification_outbox (
              outbox_id, project_id, dedupe_key, owner_kind, owner_operation_id,
              event_type, feature_id, phase_id, recipient_json, payload_json,
              client_metadata_key, status, workspace_id, channel_id, thread_ts,
              message_ts, attempt_count, last_error, created_at, updated_at, delivered_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, 0, NULL, ?, ?, NULL)`,
              ).run(
                failureNotice.outboxId,
                op.projectId,
                dedupeKey,
                failureNotice.ownerKind,
                failureNotice.ownerOperationId,
                failureNotice.eventType,
                failureNotice.featureId,
                failureNotice.phaseId,
                JSON.stringify(recipient),
                JSON.stringify(failureNotice.payload),
                failureNotice.clientMetadataKey,
                input.nowIso,
                input.nowIso,
              );
            }
          }

          const attemptCount =
            receipt.attemptCount +
            (input.status === "running" &&
            (receipt.status !== "running" ||
              receipt.leaseEpoch !== input.fence.leaseEpoch)
              ? 1
              : 0);
          const completedAt = [
            "pending",
            "running",
            "retryable_failure",
          ].includes(input.status)
            ? null
            : input.nowIso;

          db.prepare(
            `UPDATE harvest_stage_receipts SET
          status = ?,
          lease_epoch = ?,
          attempt_count = ?,
          evidence_json = ?,
          error = ?,
          updated_at = ?,
          completed_at = ?
        WHERE operation_id = ? AND phase_key = ? AND stage = ?`,
          ).run(
            input.status,
            input.fence.leaseEpoch,
            attemptCount,
            input.evidenceJson ?? null,
            input.error ?? null,
            input.nowIso,
            completedAt,
            input.fence.operationId,
            input.phaseKey,
            input.stage,
          );

          Object.assign(receipt, {
            status: input.status,
            leaseEpoch: input.fence.leaseEpoch,
            attemptCount,
            evidenceJson: input.evidenceJson ?? null,
            error: input.error ?? null,
            updatedAt: input.nowIso,
            completedAt,
          });

          if (
            input.stage === "learning_record" &&
            input.status === "succeeded" &&
            input.linkedRunId !== undefined
          ) {
            op.linkedRunId = input.linkedRunId;
          }

          const newStatus = deriveHarvestTerminalStatus({
            terminalEvent: op.terminalEvent,
            phaseIds: [...new Set(planned.map((entry) => entry.phaseKey))],
            stages: planned,
          });

          const opCompletedAt = resumableHarvests.includes(newStatus)
            ? null
            : input.nowIso;

          db.prepare(
            `UPDATE harvest_operations SET
          status = ?,
          linked_run_id = COALESCE(?, linked_run_id),
          updated_at = ?,
          completed_at = ?
        WHERE operation_id = ? AND lease_epoch = ?`,
          ).run(
            newStatus,
            op.linkedRunId,
            input.nowIso,
            opCompletedAt,
            input.fence.operationId,
            input.fence.leaseEpoch,
          );

          return { ok: true };
        },
      );
      return transaction.immediate();
    },

    enqueueOutbox(input: OutboxMessage & { nowIso: string }): OutboxItem {
      const transaction = db.transaction((): OutboxItem => {
        const existing = db
          .prepare<string[], NotificationOutboxRow>(
            "SELECT * FROM notification_outbox WHERE project_id = ? AND dedupe_key = ?",
          )
          .get(input.projectId, input.dedupeKey);
        if (existing) {
          return rowToOutboxItem(existing);
        }

        if (!input.clientMetadataKey?.trim()) {
          throw new Error("clientMetadataKey must not be blank");
        }

        const keyConflict = db
          .prepare(
            "SELECT 1 FROM notification_outbox WHERE client_metadata_key = ?",
          )
          .get(input.clientMetadataKey);
        if (keyConflict) {
          throw new Error(
            `clientMetadataKey "${input.clientMetadataKey}" already exists`,
          );
        }

        const idConflict = db
          .prepare("SELECT 1 FROM notification_outbox WHERE outbox_id = ?")
          .get(input.outboxId);
        if (idConflict) {
          throw new Error(`outboxId "${input.outboxId}" already exists`);
        }

        db.prepare(
          `INSERT INTO notification_outbox (
          outbox_id, project_id, dedupe_key, owner_kind, owner_operation_id,
          event_type, feature_id, phase_id, recipient_json, payload_json,
          client_metadata_key, status, workspace_id, channel_id, thread_ts,
          message_ts, attempt_count, last_error, created_at, updated_at, delivered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, 0, NULL, ?, ?, NULL)`,
        ).run(
          input.outboxId,
          input.projectId,
          input.dedupeKey,
          input.ownerKind,
          input.ownerOperationId,
          input.eventType,
          input.featureId,
          input.phaseId,
          JSON.stringify(input.recipient),
          JSON.stringify(input.payload),
          input.clientMetadataKey,
          input.nowIso,
          input.nowIso,
        );

        const row = db
          .prepare<string[], NotificationOutboxRow>(
            "SELECT * FROM notification_outbox WHERE outbox_id = ?",
          )
          .get(input.outboxId);
        if (!row) throw new Error("Enqueued outbox item is missing");
        return rowToOutboxItem(row);
      });
      return transaction.immediate();
    },

    getOutboxItem(outboxId: string): OutboxItem | null {
      const row = db
        .prepare<string[], NotificationOutboxRow>(
          "SELECT * FROM notification_outbox WHERE outbox_id = ?",
        )
        .get(outboxId);
      return row ? rowToOutboxItem(row) : null;
    },

    listRecoverableOutboxItems(input: {
      nowIso: string;
      projectId: string;
    }): OutboxItem[] {
      const rows = db
        .prepare<string[], NotificationOutboxRow>(
          `SELECT * FROM notification_outbox
           WHERE project_id = ? AND (status IN ('pending', 'uncertain') OR status = 'sending')
           ORDER BY julianday(created_at) ASC, outbox_id ASC`,
        )
        .all(input.projectId)
        .map(rowToOutboxItem);

      const nowMs = Date.parse(input.nowIso);
      return rows.filter(
        (row) =>
          row.status === "pending" ||
          row.status === "uncertain" ||
          (row.status === "sending" &&
            nowMs - Date.parse(row.updatedAt) >= 60_000),
      );
    },

    claimOutboxItem(input: {
      outboxId: string;
      nowIso: string;
      destination: OutboxDestination | null;
    }):
      | {
          claim: OutboxClaim;
          item: OutboxItem & OutboxDestination;
          action: "send" | "reconcile";
        }
      | { action: "skipped_no_target"; item: OutboxItem }
      | null {
      const transaction = db.transaction(
        ():
          | {
              claim: OutboxClaim;
              item: OutboxItem & OutboxDestination;
              action: "send" | "reconcile";
            }
          | { action: "skipped_no_target"; item: OutboxItem }
          | null => {
          const candidateRow = db
            .prepare<string[], NotificationOutboxRow>(
              "SELECT * FROM notification_outbox WHERE outbox_id = ?",
            )
            .get(input.outboxId);
          if (!candidateRow) return null;
          const candidate = rowToOutboxItem(candidateRow);

          const recoverable = this.listRecoverableOutboxItems({
            projectId: candidate.projectId,
            nowIso: input.nowIso,
          });
          const row = recoverable.find((r) => r.outboxId === input.outboxId);
          if (!row) return null;

          const action: "send" | "reconcile" =
            row.status === "pending" ? "send" : "reconcile";
          let route = {
            workspaceId: row.workspaceId,
            channelId: row.channelId,
            threadTs: row.threadTs,
          };

          if (row.eventType === "harvest_gate_failed") {
            const { recipient } = row;
            if (
              !isHarvestSlackRecipient(recipient) ||
              recipient.projectId !== row.projectId
            ) {
              return null;
            }

            const recipientRoute = {
              workspaceId: recipient.workspaceId,
              channelId: recipient.channelId,
              threadTs: recipient.threadTs ?? null,
            };
            if (action === "send") {
              route = recipientRoute;
            } else if (
              route.workspaceId !== recipientRoute.workspaceId ||
              route.channelId !== recipientRoute.channelId ||
              route.threadTs !== recipientRoute.threadTs
            ) {
              return null;
            }
          } else if (action === "send") {
            const explicitWorkspaceId =
              row.workspaceId?.trim() ||
              (row.recipient.surface === "slack"
                ? row.recipient.workspaceId?.trim()
                : undefined);
            const explicitChannelId =
              row.channelId?.trim() ||
              (row.recipient.surface === "slack"
                ? row.recipient.channelId?.trim()
                : undefined);
            const explicitThreadTs =
              row.threadTs !== null
                ? row.threadTs
                : row.recipient.surface === "slack" &&
                    row.recipient.threadTs !== undefined
                  ? row.recipient.threadTs
                  : undefined;

            if (input.destination === null) {
              if (
                (explicitWorkspaceId && explicitChannelId) ||
                isHarvestSlackRecipient(row.recipient)
              ) {
                return null;
              }
              const result = db
                .prepare(
                  `UPDATE notification_outbox SET status = 'skipped_no_target', updated_at = ?
               WHERE outbox_id = ? AND status = ? AND attempt_count = ?`,
                )
                .run(
                  input.nowIso,
                  input.outboxId,
                  row.status,
                  row.attemptCount,
                );
              if (result.changes === 0) return null;
              row.status = "skipped_no_target";
              row.updatedAt = input.nowIso;
              return {
                action: "skipped_no_target" as const,
                item: { ...row },
              };
            }

            if (
              !matchesAcceptedSlackDestination(
                row.recipient,
                row.projectId,
                input.destination,
              )
            ) {
              return null;
            }

            if (
              explicitWorkspaceId &&
              input.destination.workspaceId !== explicitWorkspaceId
            ) {
              return null;
            }
            if (
              explicitChannelId &&
              input.destination.channelId !== explicitChannelId
            ) {
              return null;
            }
            if (
              explicitThreadTs !== undefined &&
              input.destination.threadTs !== explicitThreadTs
            ) {
              return null;
            }

            route = {
              workspaceId: explicitWorkspaceId ?? input.destination.workspaceId,
              channelId: explicitChannelId ?? input.destination.channelId,
              threadTs:
                explicitThreadTs !== undefined
                  ? explicitThreadTs
                  : input.destination.threadTs,
            };
          }

          const { workspaceId, channelId, threadTs } = route;
          if (
            !workspaceId?.trim() ||
            !channelId?.trim() ||
            !row.clientMetadataKey.trim()
          ) {
            return null;
          }
          if (
            action === "reconcile" &&
            row.eventType !== "harvest_gate_failed" &&
            !matchesAcceptedSlackDestination(row.recipient, row.projectId, {
              workspaceId,
              channelId,
              threadTs,
            })
          ) {
            return null;
          }

          const nextAttempt = row.attemptCount + 1;
          const result = db
            .prepare(
              `UPDATE notification_outbox SET
          workspace_id = ?,
          channel_id = ?,
          thread_ts = ?,
          status = 'sending',
          updated_at = ?,
          attempt_count = ?
        WHERE outbox_id = ? AND status = ? AND attempt_count = ?`,
            )
            .run(
              workspaceId,
              channelId,
              threadTs,
              input.nowIso,
              nextAttempt,
              input.outboxId,
              row.status,
              row.attemptCount,
            );
          if (result.changes === 0) return null;

          Object.assign(row, {
            workspaceId,
            channelId,
            threadTs,
            status: "sending" as OutboxStatus,
            updatedAt: input.nowIso,
            attemptCount: nextAttempt,
          });

          return {
            claim: {
              outboxId: input.outboxId,
              attemptNumber: nextAttempt,
              clientMetadataKey: row.clientMetadataKey,
            },
            item: {
              ...row,
              workspaceId,
              channelId,
              threadTs,
            },
            action,
          };
        },
      );
      return transaction.immediate();
    },

    markOutboxUncertain(input: {
      claim: OutboxClaim;
      nowIso: string;
      error: string;
    }): FencedWrite {
      const transaction = db.transaction((): FencedWrite => {
        const row = db
          .prepare<string[], NotificationOutboxRow>(
            "SELECT * FROM notification_outbox WHERE outbox_id = ?",
          )
          .get(input.claim.outboxId);
        if (!row) return { ok: false, code: "LEASE_FENCED" };
        const item = rowToOutboxItem(row);

        if (
          item.status !== "sending" ||
          item.attemptCount !== input.claim.attemptNumber ||
          item.clientMetadataKey !== input.claim.clientMetadataKey
        ) {
          return { ok: false, code: "LEASE_FENCED" };
        }

        db.prepare(
          `UPDATE notification_outbox SET
          status = 'uncertain',
          last_error = ?,
          updated_at = ?
        WHERE outbox_id = ? AND attempt_count = ?`,
        ).run(
          input.error,
          input.nowIso,
          input.claim.outboxId,
          input.claim.attemptNumber,
        );

        return { ok: true };
      });
      return transaction.immediate();
    },

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
        | { status: "failed"; error: string };
    }): FencedWrite | { ok: false; code: "OUTBOX_TRANSITION_INVALID" } {
      const transaction = db.transaction(
        (): FencedWrite | { ok: false; code: "OUTBOX_TRANSITION_INVALID" } => {
          const row = db
            .prepare<string[], NotificationOutboxRow>(
              "SELECT * FROM notification_outbox WHERE outbox_id = ?",
            )
            .get(input.claim.outboxId);
          if (!row) return { ok: false, code: "LEASE_FENCED" };
          const item = rowToOutboxItem(row);

          if (
            item.status !== "sending" ||
            item.attemptCount !== input.claim.attemptNumber ||
            item.clientMetadataKey !== input.claim.clientMetadataKey
          ) {
            return { ok: false, code: "LEASE_FENCED" };
          }

          if (
            input.outcome.status !== "delivered" &&
            input.outcome.status !== "failed"
          ) {
            return { ok: false, code: "OUTBOX_TRANSITION_INVALID" };
          }

          if (input.outcome.status === "delivered") {
            if (
              !input.outcome.messageTs?.trim() ||
              input.outcome.channelId !== item.channelId ||
              (input.outcome.threadTs ?? null) !== item.threadTs
            ) {
              return { ok: false, code: "OUTBOX_TRANSITION_INVALID" };
            }
            db.prepare(
              `UPDATE notification_outbox SET
            status = 'delivered',
            message_ts = ?,
            delivered_at = ?,
            updated_at = ?,
            last_error = NULL
          WHERE outbox_id = ? AND attempt_count = ?`,
            ).run(
              input.outcome.messageTs,
              input.nowIso,
              input.nowIso,
              input.claim.outboxId,
              input.claim.attemptNumber,
            );
          } else {
            db.prepare(
              `UPDATE notification_outbox SET
            status = 'failed',
            last_error = ?,
            updated_at = ?
          WHERE outbox_id = ? AND attempt_count = ?`,
            ).run(
              input.outcome.error,
              input.nowIso,
              input.claim.outboxId,
              input.claim.attemptNumber,
            );
          }

          return { ok: true };
        },
      );
      return transaction.immediate();
    },

    getHarvestCursor(projectId: string): HarvestCursor | null {
      const row = db
        .prepare<string[], HarvestCursorRow>(
          "SELECT * FROM harvest_cursors WHERE project_id = ?",
        )
        .get(projectId);
      return row ? rowToHarvestCursor(row) : null;
    },

    saveHarvestCursor(cursor: HarvestCursor): void {
      db.transaction(() => {
        const saved = store.getHarvestCursor(cursor.projectId);
        const poll =
          !saved ||
          Date.parse(cursor.lastPolledAt) > Date.parse(saved.lastPolledAt)
            ? cursor
            : saved;
        const terminal =
          !saved ||
          (cursor.lastTerminalAt !== null &&
            (saved.lastTerminalAt === null ||
              Date.parse(cursor.lastTerminalAt) >
                Date.parse(saved.lastTerminalAt)))
            ? cursor
            : saved;

        db.prepare(
          `INSERT INTO harvest_cursors (project_id, last_polled_at, last_terminal_at, last_pr_number, last_error)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           last_polled_at = excluded.last_polled_at,
           last_terminal_at = excluded.last_terminal_at,
           last_pr_number = excluded.last_pr_number,
           last_error = excluded.last_error`,
        ).run(
          cursor.projectId,
          poll.lastPolledAt,
          terminal.lastTerminalAt,
          terminal.lastPrNumber,
          poll.lastError,
        );
      }).immediate();
    },

    getOperationsStatus(projectId: string): DurableOperationsStatus {
      const scope = projectScope(db, projectId);
      const queuedCount = (
        db
          .prepare(
            "SELECT COUNT(*) as c FROM dispatch_operations WHERE project_id = ? AND status = 'accepted'",
          )
          .get(projectId) as { c: number }
      ).c;

      const activeCount = (
        db
          .prepare(
            "SELECT COUNT(*) as c FROM dispatch_operations WHERE project_id = ? AND status IN ('leased', 'running', 'reconciling')",
          )
          .get(projectId) as { c: number }
      ).c;

      const oldestQueuedRow = db
        .prepare<[string], { oldest: string }>(
          `SELECT created_at AS oldest FROM dispatch_operations
           WHERE project_id = ? AND status = 'accepted'
           ORDER BY julianday(created_at) ASC, operation_id ASC
           LIMIT 1`,
        )
        .get(projectId);

      const staleLeasesReconciled = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM dispatch_attempts a
             JOIN dispatch_operations d ON d.operation_id = a.operation_id
             WHERE d.project_id = ? AND a.status = 'reconciled_completed'`,
          )
          .get(projectId) as { c: number }
      ).c;

      const lastCompletedRow = db
        .prepare(
          `SELECT completed_at, merge_commit_sha FROM harvest_operations
           WHERE project_id = ? AND status = 'completed'
           ORDER BY julianday(completed_at) DESC, operation_id DESC LIMIT 1`,
        )
        .get(projectId) as
        | { completed_at: string | null; merge_commit_sha: string | null }
        | undefined;

      const pendingOperations = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM harvest_operations
             WHERE project_id = ? AND status IN ('accepted', 'running', 'delivery_pending')`,
          )
          .get(projectId) as { c: number }
      ).c;

      const pendingStageRows = db
        .prepare<[string], PendingStageRow>(
          `SELECT s.operation_id, h.feature_id, s.phase_key, s.stage, s.status
           FROM harvest_stage_receipts s
           JOIN harvest_operations h ON h.operation_id = s.operation_id
           WHERE h.project_id = ? AND h.status IN ('accepted', 'running', 'delivery_pending')
             AND s.status IN ('pending', 'running', 'uncertain', 'retryable_failure')
           ORDER BY s.updated_at ASC, s.operation_id ASC`,
        )
        .all(projectId);

      const pendingStages = pendingStageRows.map((r) => ({
        operationId: r.operation_id,
        featureId: r.feature_id,
        phaseId: r.phase_key === "feature" ? null : r.phase_key,
        stage: r.stage,
        status: r.status,
      }));

      const unresolvedGateFailures = (
        db
          .prepare(
            "SELECT COUNT(*) as c FROM harvest_operations WHERE project_id = ? AND status = 'gate_failed'",
          )
          .get(projectId) as { c: number }
      ).c;

      const closedUnmergedCount = (
        db
          .prepare(
            "SELECT COUNT(*) as c FROM harvest_operations WHERE project_id = ? AND status = 'closed_unmerged'",
          )
          .get(projectId) as { c: number }
      ).c;

      const blockedCleanups = (
        db
          .prepare(
            "SELECT COUNT(*) as c FROM harvest_operations WHERE project_id = ? AND status = 'cleanup_blocked'",
          )
          .get(projectId) as { c: number }
      ).c;

      const pendingCount = (
        db
          .prepare(
            "SELECT COUNT(*) as c FROM notification_outbox WHERE project_id = ? AND status IN ('pending', 'sending')",
          )
          .get(projectId) as { c: number }
      ).c;

      const uncertainCount = (
        db
          .prepare(
            "SELECT COUNT(*) as c FROM notification_outbox WHERE project_id = ? AND status = 'uncertain'",
          )
          .get(projectId) as { c: number }
      ).c;

      const failedCount = (
        db
          .prepare(
            "SELECT COUNT(*) as c FROM notification_outbox WHERE project_id = ? AND status = 'failed'",
          )
          .get(projectId) as { c: number }
      ).c;

      const legacyUnverifiedRuns = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM runs r
             WHERE r.project_id IN (${scope.placeholders})
               AND r.id NOT IN (SELECT last_run_id FROM dispatch_operations WHERE project_id IN (${scope.placeholders}) AND last_run_id IS NOT NULL)
               AND r.id NOT IN (SELECT a.run_id FROM dispatch_attempts a JOIN dispatch_operations d ON d.operation_id = a.operation_id WHERE d.project_id IN (${scope.placeholders}) AND a.run_id IS NOT NULL)
               AND r.id NOT IN (SELECT linked_run_id FROM harvest_operations WHERE project_id IN (${scope.placeholders}) AND linked_run_id IS NOT NULL)`,
          )
          .get(...scope.ids, ...scope.ids, ...scope.ids, ...scope.ids) as {
          c: number;
        }
      ).c;

      let legacyUnverifiedDispatches = 0;
      const projectRow = db
        .prepare<
          [string],
          { local_root: string | null; path: string; updated_at: string | null }
        >("SELECT local_root, path, updated_at FROM projects WHERE id = ?")
        .get(scope.canonical);
      const root =
        projectRow &&
        (projectRow.updated_at !== null
          ? projectRow.local_root
          : projectRow.local_root || projectRow.path);
      if (root) {
        if (typeof options === "object" && options?.readLegacyDispatches) {
          legacyUnverifiedDispatches =
            options.readLegacyDispatches(root).length;
        } else {
          const file = path.join(root, ".gwrk", "dispatches.jsonl");
          if (fs.existsSync(file)) {
            try {
              legacyUnverifiedDispatches = fs
                .readFileSync(file, "utf8")
                .split("\n")
                .filter(
                  (line) => decodeLegacyDispatchLine(line) !== null,
                ).length;
            } catch {
              legacyUnverifiedDispatches = 0;
            }
          }
        }
      }

      return {
        projectId,
        queue: {
          queuedCount,
          activeCount,
          oldestQueuedAt: oldestQueuedRow?.oldest ?? null,
          staleLeasesReconciled,
        },
        harvest: {
          lastCompletedAt: lastCompletedRow?.completed_at ?? null,
          lastMergeCommitSha: lastCompletedRow?.merge_commit_sha ?? null,
          pendingOperations,
          pendingStages,
          unresolvedGateFailures,
          closedUnmergedCount,
          blockedCleanups,
        },
        delivery: {
          pendingCount,
          uncertainCount,
          failedCount,
          telegram: { enabled: false, reason: "disabled_in_pilot" },
        },
        historical: {
          legacyUnverifiedRuns,
          legacyUnverifiedDispatches,
        },
      };
    },
  };

  const closeCallback =
    typeof options === "function" ? options : options?.close;
  return closeCallback ? Object.assign(store, { close: closeCallback }) : store;
}
