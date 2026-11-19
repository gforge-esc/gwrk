/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { randomUUID } from "node:crypto";
import {
  type DispatchReceipt,
  type DurableDispatchOperation,
  type StaleLeaseDecision,
  type WorkerRecoveryEvidence,
  evaluateStaleDispatchReconciliation,
} from "../../domain/durable-dispatch.js";
import type {
  DeliveryRecipient,
  EnrolledProject,
} from "../../domain/project-registry.js";
import type {
  ClockPort,
  OperationsStorePort,
  WorkerExecutionPort,
} from "../../ports/operations-port.js";
import type { ProjectRegistryPort } from "../../ports/store-port.js";

const DEFAULT_LEASE_DURATION_MS = 5 * 60_000;
const DEFAULT_MAX_CRASH_RECOVERY_ATTEMPTS = 3;

export interface DurableDispatchService {
  accept(input: {
    project: EnrolledProject;
    featureId: string;
    phaseId: string;
    taskIds?: string[];
    backend: string;
    recipient?: DeliveryRecipient | null;
  }): DispatchReceipt;
  recoverOnStartup(ownerId: string): Promise<{
    requeuedCount: number;
    completedFromPrCount: number;
    failedCount: number;
  }>;
  drainReady(ownerId: string, maxConcurrent: number): Promise<void>;
  getOperation(
    projectId: string,
    featureId: string,
    phaseId: string,
  ): DurableDispatchOperation | null;
}

export interface DurableDispatchServiceDeps {
  store: OperationsStorePort;
  registry: Pick<ProjectRegistryPort, "getProject">;
  worker: WorkerExecutionPort;
  clock: ClockPort;
  newId?: () => string;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number | null;
  maxCrashRecoveryAttempts?: number;
  onRecoveredMerge?: (input: {
    project: EnrolledProject;
    operation: DurableDispatchOperation;
    prNumber: number;
    prUrl: string;
    mergeCommitSha: string;
  }) => Promise<void> | void;
}

function projectCheckoutRoot(project: EnrolledProject): string | null {
  return project.localRoot ?? project.mirrorPath;
}

function leaseExpiryIso(clock: ClockPort, durationMs: number): string {
  return new Date(clock.nowMs() + durationMs).toISOString();
}

export function createDurableDispatchService(
  deps: DurableDispatchServiceDeps,
): DurableDispatchService {
  const { store, registry, worker, clock } = deps;
  const newId = deps.newId ?? (() => randomUUID());
  const leaseDurationMs = deps.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const maxCrashRecoveryAttempts =
    deps.maxCrashRecoveryAttempts ?? DEFAULT_MAX_CRASH_RECOVERY_ATTEMPTS;
  const heartbeatIntervalMs =
    deps.heartbeatIntervalMs === undefined
      ? Math.max(1_000, Math.floor(leaseDurationMs / 3))
      : deps.heartbeatIntervalMs;

  const activeByOwner = new Map<string, Set<string>>();

  function ownerActiveSet(ownerId: string): Set<string> {
    let set = activeByOwner.get(ownerId);
    if (!set) {
      set = new Set<string>();
      activeByOwner.set(ownerId, set);
    }
    return set;
  }

  async function inspectOperation(
    op: DurableDispatchOperation,
    project: EnrolledProject,
    projectRoot: string,
  ): Promise<WorkerRecoveryEvidence> {
    try {
      return await worker.inspectRecoveredWork({
        operationId: op.operationId,
        workKey: op.workKey,
        projectRoot,
        repoSlug: project.repoSlug,
        featureId: op.featureId,
        phaseId: op.phaseId,
        branchName: op.branchName,
        ...(op.prNumber !== null
          ? {
              persistedPullRequest: {
                prNumber: op.prNumber,
                prUrl: op.prUrl,
              },
            }
          : {}),
      });
    } catch {
      return {
        workerState: "unknown",
        pullRequestLookup: "unavailable",
        openPullRequest: null,
        mergedPullRequest: null,
        completedManifestRunId: null,
        sandboxDir: null,
      };
    }
  }

  async function runAttempt(
    op: DurableDispatchOperation,
    ownerId: string,
  ): Promise<void> {
    const project = registry.getProject(op.projectId);
    const projectRoot = project ? projectCheckoutRoot(project) : null;
    if (!project || !projectRoot) return;

    const claimed = store.claimDispatchLease({
      operationId: op.operationId,
      leaseOwner: ownerId,
      nowIso: clock.nowIso(),
      leaseExpiresAt: leaseExpiryIso(clock, leaseDurationMs),
    });
    if (!claimed) return;

    const { fence, operation } = claimed;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    if (heartbeatIntervalMs !== null && heartbeatIntervalMs > 0) {
      heartbeat = setInterval(() => {
        store.heartbeatDispatchLease({
          fence,
          nowIso: clock.nowIso(),
          leaseExpiresAt: leaseExpiryIso(clock, leaseDurationMs),
        });
      }, heartbeatIntervalMs);
      heartbeat.unref?.();
    }

    try {
      const result = await worker.launchPhaseShip({
        projectRoot,
        trunkBranch: operation.trunkBranch,
        branchName: operation.branchName,
        featureId: operation.featureId,
        phaseId: operation.phaseId,
        backend: operation.backend,
        taskIds: operation.taskIds,
      });

      if (result.exitCode === 0) {
        store.completeDispatchAttempt({
          fence,
          nowIso: clock.nowIso(),
          operationStatus: "completed",
          attemptStatus: "completed",
          runId: result.runId,
          worktreeDir: result.workDir,
          exitCode: result.exitCode,
          prNumber: result.prNumber,
          prUrl: result.prUrl,
        });
      } else {
        store.completeDispatchAttempt({
          fence,
          nowIso: clock.nowIso(),
          operationStatus: "failed",
          attemptStatus: "failed",
          runId: result.runId,
          worktreeDir: result.workDir,
          exitCode: result.exitCode,
          prNumber: result.prNumber,
          prUrl: result.prUrl,
          error:
            result.stderr.trim() ||
            `Worker exited with code ${result.exitCode}`,
        });
      }
    } catch (error) {
      store.completeDispatchAttempt({
        fence,
        nowIso: clock.nowIso(),
        operationStatus: "failed",
        attemptStatus: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  }

  return {
    accept(input) {
      if (
        input.recipient &&
        input.recipient.projectId !== input.project.projectId
      ) {
        throw new Error("Dispatch recipient belongs to another project");
      }
      return store.acceptDispatch({
        projectId: input.project.projectId,
        featureId: input.featureId,
        phaseId: input.phaseId,
        taskIds: input.taskIds,
        backend: input.backend,
        trunkBranch: input.project.trunkBranch,
        recipient: input.recipient ?? null,
        newOperationId: newId(),
        nowIso: clock.nowIso(),
      });
    },

    async recoverOnStartup(ownerId) {
      let requeuedCount = 0;
      let completedFromPrCount = 0;
      let failedCount = 0;

      const recoverable = store.listRecoverableDispatches({
        nowIso: clock.nowIso(),
      });

      for (const op of recoverable) {
        if (op.status === "accepted") continue;

        const project = registry.getProject(op.projectId);
        const projectRoot = project ? projectCheckoutRoot(project) : null;
        if (!project || !projectRoot) continue;

        const initialEvidence = await inspectOperation(
          op,
          project,
          projectRoot,
        );
        const initialDecision = evaluateStaleDispatchReconciliation({
          operation: op,
          evidence: initialEvidence,
          maxCrashRecoveryAttempts,
        });

        if (
          initialDecision.action === "await_worker_stop" ||
          initialDecision.action === "await_pr_evidence"
        ) {
          continue;
        }

        const claimed = store.claimDispatchLease({
          operationId: op.operationId,
          leaseOwner: ownerId,
          nowIso: clock.nowIso(),
          leaseExpiresAt: leaseExpiryIso(clock, leaseDurationMs),
        });
        if (!claimed) continue;

        let evidence: WorkerRecoveryEvidence = initialEvidence;
        let decision: StaleLeaseDecision = initialDecision;
        if (claimed.operation.leaseEpoch !== op.leaseEpoch + 1) {
          evidence = await inspectOperation(
            claimed.operation,
            project,
            projectRoot,
          );
          decision = evaluateStaleDispatchReconciliation({
            operation: {
              ...claimed.operation,
              attemptCount: Math.max(0, claimed.operation.attemptCount - 1),
            },
            evidence,
            maxCrashRecoveryAttempts,
          });
          if (
            decision.action === "await_worker_stop" ||
            decision.action === "await_pr_evidence"
          ) {
            continue;
          }
        }

        if (decision.action === "complete_from_pr") {
          const done = store.completeDispatchAttempt({
            fence: claimed.fence,
            nowIso: clock.nowIso(),
            operationStatus: "completed",
            attemptStatus: "reconciled_completed",
            prNumber: decision.prNumber,
            prUrl: decision.prUrl,
            worktreeDir: evidence.sandboxDir ?? undefined,
          });
          if (done.ok) {
            completedFromPrCount++;
            if (decision.triggerHarvestMergeSha && deps.onRecoveredMerge) {
              await deps.onRecoveredMerge({
                project,
                operation: claimed.operation,
                prNumber: decision.prNumber,
                prUrl: decision.prUrl,
                mergeCommitSha: decision.triggerHarvestMergeSha,
              });
            }
          }
          continue;
        }

        if (evidence.sandboxDir) {
          try {
            await worker.cleanupStaleSandbox(
              projectRoot,
              evidence.sandboxDir,
              op.featureId,
            );
          } catch {
            // Preserve sandbox cleanup failures without hiding terminal state.
            if (decision.action === "requeue_attempt") continue;
          }
        }

        if (decision.action === "requeue_attempt") {
          const requeued = store.completeDispatchAttempt({
            fence: claimed.fence,
            nowIso: clock.nowIso(),
            operationStatus: "accepted",
            attemptStatus: "interrupted",
            worktreeDir: evidence.sandboxDir ?? undefined,
            error: decision.reason,
          });
          if (requeued.ok) requeuedCount++;
        } else if (decision.action === "fail_exhausted") {
          const failed = store.completeDispatchAttempt({
            fence: claimed.fence,
            nowIso: clock.nowIso(),
            operationStatus: "failed",
            attemptStatus: "failed",
            worktreeDir: evidence.sandboxDir ?? undefined,
            error: decision.reason,
          });
          if (failed.ok) failedCount++;
        }
      }

      return { requeuedCount, completedFromPrCount, failedCount };
    },

    async drainReady(ownerId, maxConcurrent) {
      const limit = Math.max(0, Math.floor(maxConcurrent));
      if (limit === 0) return;

      const visited = new Set<string>();
      const inFlight = new Set<Promise<void>>();
      const active = ownerActiveSet(ownerId);

      const nextReady = (): DurableDispatchOperation | null => {
        const queued = store.listRecoverableDispatches({
          nowIso: clock.nowIso(),
        });
        for (const op of queued) {
          if (op.status !== "accepted") continue;
          const runKey = `${op.operationId}:${op.leaseEpoch}`;
          if (active.has(runKey)) continue;
          if (visited.has(runKey)) continue;
          const project = registry.getProject(op.projectId);
          if (!project || !projectCheckoutRoot(project)) continue;
          return op;
        }
        return null;
      };

      while (true) {
        while (active.size < limit) {
          const next = nextReady();
          if (!next) break;
          const runKey = `${next.operationId}:${next.leaseEpoch}`;
          visited.add(runKey);
          active.add(runKey);
          const task = runAttempt(next, ownerId).finally(() => {
            active.delete(runKey);
            if (active.size === 0) activeByOwner.delete(ownerId);
            inFlight.delete(task);
          });
          inFlight.add(task);
        }

        if (inFlight.size === 0) break;
        await Promise.race(inFlight);
      }
    },

    getOperation(projectId, featureId, phaseId) {
      return store.getDispatchOperation({ projectId, featureId, phaseId });
    },
  };
}
