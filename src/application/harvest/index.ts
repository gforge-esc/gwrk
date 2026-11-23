/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { DurableDispatchOperation } from "../../domain/durable-dispatch.js";
import {
  type HarvestCandidateInput,
  type HarvestOperationStatus,
  type HarvestSlackRecipient,
  type HarvestStageName,
  type HarvestStageReceipt,
  type HarvestStageStatus,
  type HarvestTerminalEvent,
  deriveHarvestTerminalStatus,
  evaluateBranchCleanupSafety,
  hasVerifiedBranchCleanupTarget,
  planHarvestStages,
  resolveHarvestSlackRecipient,
  scopeManualHarvestToPhases,
  scopeVerifiedMergeToPhases,
  verifyHarvestIntakeOperations,
  verifyHarvestTarget,
} from "../../domain/durable-harvest.js";
import { normalizeGitRemoteSlug } from "../../domain/project-id.js";
import type {
  DeliveryRecipient,
  EnrolledProject,
} from "../../domain/project-registry.js";
import type {
  ClockPort,
  DurableHarvestOperation,
  GitHubHarvestPort,
  HarvestExecutionPort,
  HarvestPullRequestFact,
  OperationsStorePort,
  OutboxMessage,
} from "../../ports/operations-port.js";
import type { ProjectRegistryPort } from "../../ports/store-port.js";
import type {
  DetachedCheckoutHandle,
  VcsHarvestExtensions,
  VcsPort,
} from "../../ports/vcs-port.js";
import type { OutboxDeliveryService } from "../delivery/outbox.js";

const DEFAULT_LEASE_DURATION_MS = 5 * 60_000;
const FULL_GIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export interface HarvestExecutionSummary {
  operationId: string;
  projectId: string;
  workKey: string;
  deduplicatedTransport: boolean;
  deduplicatedWork: boolean;
  status: HarvestOperationStatus;
  linkedRunId: number | null;
  pendingStages: HarvestStageName[];
  failedStages: HarvestStageName[];
}

export interface DurableHarvestService {
  ingestWebhook(input: {
    deliveryId: string;
    eventType: string;
    rawBody: Buffer;
    signatureHeader?: string;
    webhookSecret?: string;
    parsedPayload: unknown;
  }): Promise<
    | { accepted: true; summary: HarvestExecutionSummary }
    | { accepted: false; httpStatus: 200 | 400 | 401; reason: string }
  >;
  pollProject(
    project: EnrolledProject,
    ownerId: string,
    options?: { signal?: AbortSignal },
  ): Promise<HarvestExecutionSummary[]>;
  runManualHarvest(input: {
    project: EnrolledProject;
    featureId: string;
    phaseId?: string;
    prNumber?: number;
    commitSha?: string;
    recipient?: DeliveryRecipient | null;
    updateLocalTaskState: boolean;
    ownerId: string;
  }): Promise<HarvestExecutionSummary[]>;
  resumeIncomplete(ownerId: string): Promise<HarvestExecutionSummary[]>;
}

export interface DurableHarvestServiceDeps {
  store: OperationsStorePort;
  registry: Pick<
    ProjectRegistryPort,
    "getProject" | "findByRepoSlug" | "getFeatureThread"
  >;
  vcs: VcsHarvestExtensions & Partial<Pick<VcsPort, "discoverIdentityFacts">>;
  github?: GitHubHarvestPort;
  executor: HarvestExecutionPort;
  outbox: OutboxDeliveryService;
  clock: ClockPort;
  newId?: () => string;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number | null;
}

const WebhookPullRequestPayloadSchema = z.object({
  action: z.string().min(1),
  repository: z.object({ full_name: z.string().min(1) }).optional(),
  pull_request: z.object({
    number: z.number().int().positive().safe(),
    html_url: z.string().url(),
    merged: z.boolean().optional(),
    merge_commit_sha: z.string().nullable().optional(),
    merged_at: z.string().nullable().optional(),
    closed_at: z.string().nullable().optional(),
    base: z.object({
      ref: z.string().min(1),
      repo: z.object({ full_name: z.string().min(1) }).optional(),
    }),
    head: z.object({
      ref: z.string().min(1),
      sha: z.string().nullable().optional(),
      repo: z
        .object({ full_name: z.string().min(1) })
        .nullable()
        .optional(),
    }),
  }),
});

interface LearningEvidence {
  linkedRunId: number | null;
  forecastMissing: boolean;
  pointCompression?: number;
  summaryText: string;
  blocks?: unknown[];
}

function sha256Hex(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function projectCheckoutRoot(project: EnrolledProject): string | null {
  return project.localRoot ?? project.mirrorPath;
}

function leaseExpiryIso(clock: ClockPort, durationMs: number): string {
  return new Date(clock.nowMs() + durationMs).toISOString();
}

function isStageComplete(receipt: HarvestStageReceipt): boolean {
  return (
    receipt.status === "succeeded" ||
    (receipt.stage === "learning_record" &&
      receipt.status === "forecast_missing") ||
    ((receipt.stage === "slack_delivery" ||
      receipt.stage === "branch_cleanup") &&
      receipt.status === "skipped_no_target")
  );
}

function summarizeStages(stages: readonly HarvestStageReceipt[]): {
  pendingStages: HarvestStageName[];
  failedStages: HarvestStageName[];
} {
  const pending = new Set<HarvestStageName>();
  const failed = new Set<HarvestStageName>();
  for (const receipt of stages) {
    if (
      receipt.status === "pending" ||
      receipt.status === "running" ||
      receipt.status === "uncertain" ||
      receipt.status === "retryable_failure"
    ) {
      pending.add(receipt.stage);
    } else if (
      receipt.status === "gate_failed" ||
      receipt.status === "failed" ||
      receipt.status === "blocked_tip_mismatch"
    ) {
      failed.add(receipt.stage);
    }
  }
  return {
    pendingStages: [...pending],
    failedStages: [...failed],
  };
}

function summaryFromOperation(
  operation: DurableHarvestOperation,
  flags: { deduplicatedTransport: boolean; deduplicatedWork: boolean },
  stages?: readonly HarvestStageReceipt[],
): HarvestExecutionSummary {
  if (stages && stages.length > 0) {
    const { pendingStages, failedStages } = summarizeStages(stages);
    return {
      operationId: operation.operationId,
      projectId: operation.projectId,
      workKey: operation.workKey,
      deduplicatedTransport: flags.deduplicatedTransport,
      deduplicatedWork: flags.deduplicatedWork,
      status: operation.status,
      linkedRunId: operation.linkedRunId,
      pendingStages,
      failedStages,
    };
  }
  const failedStages: HarvestStageName[] =
    operation.status === "gate_failed"
      ? ["gate_verify"]
      : operation.status === "cleanup_blocked"
        ? ["branch_cleanup"]
        : [];
  const pendingStages: HarvestStageName[] =
    operation.status === "delivery_pending" ? ["slack_delivery"] : [];
  return {
    operationId: operation.operationId,
    projectId: operation.projectId,
    workKey: operation.workKey,
    deduplicatedTransport: flags.deduplicatedTransport,
    deduplicatedWork: flags.deduplicatedWork,
    status: operation.status,
    linkedRunId: operation.linkedRunId,
    pendingStages,
    failedStages,
  };
}

function parseJsonSafe<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function createDurableHarvestService(
  deps: DurableHarvestServiceDeps,
): DurableHarvestService {
  const { store, registry, vcs, github, executor, outbox, clock } = deps;
  const newId = deps.newId ?? (() => randomUUID());
  const leaseDurationMs = deps.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const heartbeatIntervalMs =
    deps.heartbeatIntervalMs === undefined
      ? Math.max(10, Math.floor(leaseDurationMs / 3))
      : deps.heartbeatIntervalMs;

  function defaultSlackRecipient(
    project: EnrolledProject,
    featureId?: string,
    phaseIds?: string | null | readonly (string | null)[],
  ): DeliveryRecipient | null {
    if (!project.slack) return null;
    const normalizedPhaseIds = (
      Array.isArray(phaseIds) ? phaseIds : phaseIds ? [phaseIds] : []
    ).filter((id): id is string => typeof id === "string" && id.length > 0);
    if (featureId && normalizedPhaseIds.length > 0) {
      let newestDispatch: DurableDispatchOperation | null = null;
      for (const phaseId of new Set(normalizedPhaseIds)) {
        const dispatch = store.getDispatchOperation({
          projectId: project.projectId,
          featureId,
          phaseId,
        });
        if (!dispatch?.recipient) continue;
        const resolved = resolveHarvestSlackRecipient({
          projectId: project.projectId,
          featureId,
          recipient: dispatch.recipient,
          binding: project.slack,
        });
        if (!resolved) continue;
        const dispatchTime = Date.parse(dispatch.createdAt);
        const newestTime = newestDispatch
          ? Date.parse(newestDispatch.createdAt)
          : Number.NEGATIVE_INFINITY;
        if (
          !newestDispatch ||
          dispatchTime > newestTime ||
          (dispatchTime === newestTime &&
            dispatch.operationId > newestDispatch.operationId)
        ) {
          newestDispatch = dispatch;
        }
      }
      if (newestDispatch?.recipient) {
        return newestDispatch.recipient;
      }
    }
    return {
      projectId: project.projectId,
      surface: "slack",
      workspaceId: project.slack.workspaceId,
      channelId: project.slack.channelId,
    };
  }

  function buildProposedOperation(input: {
    project: EnrolledProject;
    candidate: HarvestCandidateInput;
    repoSlug: string | null;
    featureId: string;
    phaseId: string | null;
    workKey: string;
    mergeCommitSha: string | null;
    receivedAt: string;
  }): DurableHarvestOperation {
    const {
      project,
      candidate,
      repoSlug,
      featureId,
      phaseId,
      workKey,
      mergeCommitSha,
      receivedAt,
    } = input;
    return {
      operationId: newId(),
      projectId: project.projectId,
      workKey,
      repoSlug,
      headRepoSlug: candidate.headRepoSlug,
      trunkBranch: project.trunkBranch,
      featureId,
      phaseId,
      prNumber: candidate.prNumber,
      prUrl: candidate.prUrl,
      headBranch: candidate.headBranch,
      expectedHeadSha: candidate.expectedHeadSha,
      terminalEvent: candidate.terminalEvent,
      mergeCommitSha,
      terminalAt: candidate.terminalAt,
      recipient:
        candidate.prNumber === null ? null : (candidate.recipient ?? null),
      plannedSlackRecipient: null,
      status: "accepted",
      leaseOwner: null,
      leaseEpoch: 0,
      leaseExpiresAt: null,
      linkedRunId: null,
      lastError: null,
      createdAt: receivedAt,
      updatedAt: receivedAt,
      completedAt: null,
    };
  }

  async function discoverCheckoutPhases(
    projectRoot: string,
    commitSha: string,
    featureId: string,
    fetchTrunkBranch?: string,
  ): Promise<string[]> {
    if (fetchTrunkBranch) {
      await vcs.fetchBranch(projectRoot, fetchTrunkBranch);
    }
    const checkout = await vcs.createDetachedCheckout(projectRoot, commitSha);
    try {
      return await executor.discoverPhasesAtCheckout(
        checkout.checkoutDir,
        featureId,
      );
    } finally {
      await vcs.removeDetachedCheckout(projectRoot, checkout.checkoutDir);
    }
  }

  function buildPullRequestCandidate(
    source: "github_poller" | "manual_cli",
    deliveryId: string,
    project: EnrolledProject,
    fact: HarvestPullRequestFact,
    overrides?: {
      explicitFeatureId?: string;
      explicitPhaseId?: string;
      recipient?: DeliveryRecipient | null;
    },
  ): HarvestCandidateInput {
    const terminalEvent: HarvestTerminalEvent = fact.merged
      ? "merged"
      : "closed_unmerged";
    const terminalAt =
      (fact.merged ? fact.mergedAt : fact.closedAt) ?? clock.nowIso();
    return {
      source,
      deliveryId,
      repoSlug: fact.repoSlug,
      headRepoSlug: fact.headRepoSlug,
      baseBranch: fact.baseBranch,
      headBranch: fact.headBranch,
      expectedHeadSha: fact.headSha,
      prNumber: fact.prNumber,
      prUrl: fact.prUrl,
      terminalEvent,
      mergeCommitSha: fact.merged ? fact.mergeCommitSha : null,
      terminalAt,
      ...(overrides?.explicitFeatureId !== undefined
        ? { explicitFeatureId: overrides.explicitFeatureId }
        : {}),
      ...(overrides?.explicitPhaseId !== undefined
        ? { explicitPhaseId: overrides.explicitPhaseId }
        : {}),
      recipient:
        overrides?.recipient !== undefined
          ? overrides.recipient
          : defaultSlackRecipient(project),
    };
  }

  async function executeHarvestOperation(
    operationSnapshot: DurableHarvestOperation,
    project: EnrolledProject,
    ownerId: string,
    options: {
      updateLocalTaskState: boolean;
      deduplicatedTransport: boolean;
      deduplicatedWork: boolean;
    },
  ): Promise<HarvestExecutionSummary> {
    const claimed = store.claimHarvestLease({
      operationId: operationSnapshot.operationId,
      leaseOwner: ownerId,
      nowIso: clock.nowIso(),
      leaseExpiresAt: leaseExpiryIso(clock, leaseDurationMs),
    });

    if (!claimed) {
      return summaryFromOperation(operationSnapshot, options);
    }

    const { fence, operation } = claimed;
    const enrolledProject = registry.getProject(operation.projectId) ?? project;
    const projectRoot = projectCheckoutRoot(enrolledProject);
    if (!projectRoot) {
      return summaryFromOperation(operation, options, claimed.stages);
    }

    const phaseIds =
      operation.phaseId !== null
        ? [operation.phaseId]
        : operation.terminalEvent === "closed_unmerged"
          ? ["feature"]
          : [];

    let plannedSlackRecipient: HarvestSlackRecipient | null =
      operation.plannedSlackRecipient;
    const receipts: HarvestStageReceipt[] = claimed.stages.map((s) => ({
      ...s,
    }));

    const receiptFor = (
      phaseKey: string,
      stage: HarvestStageName,
    ): HarvestStageReceipt | undefined =>
      receipts.find((r) => r.phaseKey === phaseKey && r.stage === stage);

    let linkedRunId = operation.linkedRunId;
    const checkoutState: { handle: DetachedCheckoutHandle | null } = {
      handle: null,
    };
    let fenced = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    if (heartbeatIntervalMs !== null && heartbeatIntervalMs > 0) {
      heartbeat = setInterval(() => {
        try {
          const res = store.heartbeatHarvestLease({
            fence,
            nowIso: clock.nowIso(),
            leaseExpiresAt: leaseExpiryIso(clock, leaseDurationMs),
          });
          if (!res.ok) {
            fenced = true;
            if (heartbeat) {
              clearInterval(heartbeat);
              heartbeat = null;
            }
          }
        } catch {
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
        }
      }, heartbeatIntervalMs);
      heartbeat.unref?.();
    }

    const ensureCheckout = async (): Promise<DetachedCheckoutHandle> => {
      if (checkoutState.handle) return checkoutState.handle;
      if (!operation.mergeCommitSha) {
        throw new Error("Merged harvest operation is missing mergeCommitSha");
      }
      checkoutState.handle = await vcs.createDetachedCheckout(
        projectRoot,
        operation.mergeCommitSha,
      );
      return checkoutState.handle;
    };

    const transition = (
      phaseKey: string,
      stage: HarvestStageName,
      payload:
        | {
            status: "gate_failed";
            failureNotice: OutboxMessage | null;
            evidenceJson?: string | null;
            error?: string | null;
          }
        | {
            status: Exclude<HarvestStageStatus, "gate_failed">;
            evidenceJson?: string | null;
            error?: string | null;
            linkedRunId?: number | null;
          },
    ): boolean => {
      const nowIso = clock.nowIso();
      const res = store.transitionHarvestStage({
        fence,
        nowIso,
        phaseKey,
        stage,
        ...payload,
      });
      if (!res.ok) {
        fenced = true;
        return false;
      }
      const local = receiptFor(phaseKey, stage);
      if (local) {
        local.status = payload.status;
        local.leaseEpoch = fence.leaseEpoch;
        local.evidenceJson = payload.evidenceJson ?? null;
        local.error = payload.error ?? null;
        local.updatedAt = nowIso;
        local.completedAt = [
          "pending",
          "running",
          "retryable_failure",
        ].includes(payload.status)
          ? null
          : nowIso;
      }
      if (
        stage === "learning_record" &&
        payload.status === "succeeded" &&
        "linkedRunId" in payload &&
        payload.linkedRunId !== undefined
      ) {
        linkedRunId = payload.linkedRunId;
      }
      return true;
    };

    try {
      if (receipts.length === 0) {
        const binding = enrolledProject.slack;
        const thread = binding
          ? (registry.getFeatureThread(
              operation.projectId,
              operation.featureId,
            ) ?? undefined)
          : undefined;
        plannedSlackRecipient = resolveHarvestSlackRecipient({
          projectId: operation.projectId,
          featureId: operation.featureId,
          recipient: operation.recipient,
          binding,
          thread,
        });
        const hasSlackTarget = plannedSlackRecipient !== null;
        const hasRemoteBranchTarget = hasVerifiedBranchCleanupTarget(operation);
        const plan = planHarvestStages({
          terminalEvent: operation.terminalEvent,
          phaseIds,
          hasSlackTarget,
          hasRemoteBranchTarget,
        });
        const initNow = clock.nowIso();
        const initResult = store.initializeHarvestStages({
          fence,
          nowIso: initNow,
          phaseIds,
          hasSlackTarget,
          hasRemoteBranchTarget,
          stages: plan,
        });
        if (!initResult.ok) {
          return summaryFromOperation(operation, options, receipts);
        }
        for (const entry of plan) {
          receipts.push({
            operationId: operation.operationId,
            phaseKey: entry.phaseKey,
            stage: entry.stage,
            status: entry.initialStatus,
            leaseEpoch: fence.leaseEpoch,
            attemptCount: 0,
            evidenceJson: null,
            error: null,
            updatedAt: initNow,
            completedAt: null,
          });
        }
      }
      if (operation.terminalEvent === "closed_unmerged") {
        const phaseKey = operation.phaseId ?? "feature";
        const receipt = receiptFor(phaseKey, "learning_record");
        if (receipt && !isStageComplete(receipt)) {
          if (!transition(phaseKey, "learning_record", { status: "running" })) {
            return buildSummary();
          }
          try {
            const learning = await executor.recordLearningAtCheckout({
              checkoutDir: projectRoot,
              projectId: operation.projectId,
              featureId: operation.featureId,
              phaseId: operation.phaseId,
              prNumber: operation.prNumber,
              prUrl: operation.prUrl,
              terminalEvent: "closed_unmerged",
              mergeCommitSha: null,
              terminalAt: operation.terminalAt,
              gatePassed: false,
            });
            transition(phaseKey, "learning_record", {
              status: learning.forecastMissing
                ? "forecast_missing"
                : "succeeded",
              linkedRunId: learning.linkedRunId,
              evidenceJson: JSON.stringify(learning),
            });
          } catch (error) {
            transition(phaseKey, "learning_record", {
              status: "retryable_failure",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return buildSummary();
      }

      for (const phaseKey of phaseIds) {
        if (fenced) break;

        // 1. git_sync
        const syncReceipt = receiptFor(phaseKey, "git_sync");
        if (syncReceipt && !isStageComplete(syncReceipt)) {
          if (!transition(phaseKey, "git_sync", { status: "running" })) break;
          try {
            const mergeSha = operation.mergeCommitSha;
            if (!mergeSha) {
              throw new Error("Missing merge commit SHA for git_sync");
            }
            if (operation.prNumber !== null) {
              await vcs.fetchBranch(projectRoot, operation.trunkBranch);
              const remoteTrunk = `origin/${operation.trunkBranch}`;
              const hasRemoteTrunk =
                (await vcs.resolveRefSha(projectRoot, remoteTrunk)) !== null;
              const trunkRef = hasRemoteTrunk
                ? remoteTrunk
                : operation.trunkBranch;
              const ancestor = await vcs.isCommitAncestorOfRef(
                projectRoot,
                mergeSha,
                trunkRef,
              );
              if (!ancestor) {
                throw new Error(
                  `Merge commit ${mergeSha} is not an ancestor of ${trunkRef}`,
                );
              }
            } else {
              const trunkSha = await vcs.resolveRefSha(
                projectRoot,
                operation.trunkBranch,
              );
              if (trunkSha === null) {
                throw new Error(
                  `Configured trunk branch ${operation.trunkBranch} cannot be resolved`,
                );
              }
              const ancestor = await vcs.isCommitAncestorOfRef(
                projectRoot,
                mergeSha,
                operation.trunkBranch,
              );
              if (!ancestor) {
                throw new Error(
                  `Commit ${mergeSha} is not an ancestor of ${operation.trunkBranch}`,
                );
              }
            }
            if (
              !transition(phaseKey, "git_sync", {
                status: "succeeded",
                evidenceJson: JSON.stringify({
                  mergeCommitSha: mergeSha,
                  trunkBranch: operation.trunkBranch,
                }),
              })
            ) {
              break;
            }
          } catch (error) {
            transition(phaseKey, "git_sync", {
              status: "retryable_failure",
              error: error instanceof Error ? error.message : String(error),
            });
            break;
          }
        }

        // 2. gate_verify
        const gateReceipt = receiptFor(phaseKey, "gate_verify");
        if (gateReceipt?.status === "gate_failed") break;
        if (gateReceipt && !isStageComplete(gateReceipt)) {
          if (!transition(phaseKey, "gate_verify", { status: "running" })) {
            break;
          }
          let gateSucceeded = false;
          try {
            const checkout = await ensureCheckout();
            const gateResult = await executor.verifyGatesAtCheckout({
              checkoutDir: checkout.checkoutDir,
              projectId: operation.projectId,
              featureId: operation.featureId,
              phaseId: phaseKey,
              updateLocalTaskState: false,
            });
            if (gateResult.failed > 0 || gateResult.failedTaskIds.length > 0) {
              const failedList = gateResult.failedTaskIds.join(", ");
              const failureNotice: OutboxMessage | null = plannedSlackRecipient
                ? {
                    outboxId: newId(),
                    projectId: operation.projectId,
                    dedupeKey: JSON.stringify([
                      "harvest_gate_failed",
                      operation.operationId,
                      phaseKey,
                    ]),
                    ownerKind: "harvest",
                    ownerOperationId: operation.operationId,
                    eventType: "harvest_gate_failed",
                    featureId: operation.featureId,
                    phaseId: phaseKey,
                    recipient: plannedSlackRecipient,
                    payload: {
                      text: `Gate verification failed for ${operation.featureId} (${phaseKey}): ${failedList || `${gateResult.failed} failed`}`,
                    },
                    clientMetadataKey: newId(),
                  }
                : null;
              const recorded = transition(phaseKey, "gate_verify", {
                status: "gate_failed",
                failureNotice,
                evidenceJson: JSON.stringify(gateResult),
                error: failedList
                  ? `Gate verification failed for tasks: ${failedList}`
                  : `Gate verification failed (${gateResult.failed} failed)`,
              });
              if (recorded && failureNotice) {
                await outbox.flushOutboxItem(failureNotice.outboxId);
              }
              break;
            }
            if (
              !transition(phaseKey, "gate_verify", {
                status: "succeeded",
                evidenceJson: JSON.stringify(gateResult),
              })
            ) {
              break;
            }
            gateSucceeded = true;
          } catch (error) {
            transition(phaseKey, "gate_verify", {
              status: "retryable_failure",
              error: error instanceof Error ? error.message : String(error),
            });
            break;
          }
          if (
            gateSucceeded &&
            options.updateLocalTaskState &&
            operation.mergeCommitSha
          ) {
            const localHeadSha = await vcs.resolveRefSha(projectRoot, "HEAD");
            if (
              localHeadSha &&
              localHeadSha.toLowerCase() ===
                operation.mergeCommitSha.toLowerCase()
            ) {
              await executor.markLocalPhaseTasksCompleted?.({
                projectRoot,
                featureId: operation.featureId,
                phaseId: phaseKey,
                completedAt: clock.nowIso(),
              });
            }
          }
        }

        // 3. learning_record
        const learningReceipt = receiptFor(phaseKey, "learning_record");
        let learningEvidence: LearningEvidence | null = parseJsonSafe(
          learningReceipt?.evidenceJson ?? null,
        );
        if (learningReceipt && !isStageComplete(learningReceipt)) {
          if (!transition(phaseKey, "learning_record", { status: "running" })) {
            break;
          }
          try {
            const checkout = await ensureCheckout();
            const learning = await executor.recordLearningAtCheckout({
              checkoutDir: checkout.checkoutDir,
              projectId: operation.projectId,
              featureId: operation.featureId,
              phaseId: phaseKey,
              prNumber: operation.prNumber,
              prUrl: operation.prUrl,
              terminalEvent: "merged",
              mergeCommitSha: operation.mergeCommitSha,
              terminalAt: operation.terminalAt,
              gatePassed: true,
            });
            learningEvidence = learning;
            if (
              !transition(phaseKey, "learning_record", {
                status: learning.forecastMissing
                  ? "forecast_missing"
                  : "succeeded",
                linkedRunId: learning.linkedRunId,
                evidenceJson: JSON.stringify(learning),
              })
            ) {
              break;
            }
          } catch (error) {
            transition(phaseKey, "learning_record", {
              status: "retryable_failure",
              error: error instanceof Error ? error.message : String(error),
            });
            break;
          }
        }

        // 4. slack_delivery
        const slackReceipt = receiptFor(phaseKey, "slack_delivery");
        if (slackReceipt && !isStageComplete(slackReceipt)) {
          if (!transition(phaseKey, "slack_delivery", { status: "running" })) {
            break;
          }
          if (!plannedSlackRecipient) {
            transition(phaseKey, "slack_delivery", {
              status: "retryable_failure",
              error: "Planned Slack recipient is missing",
            });
          } else {
            try {
              const savedEvidence = parseJsonSafe<{ outboxId?: string }>(
                slackReceipt.evidenceJson,
              );
              const outboxId =
                savedEvidence?.outboxId ??
                outbox.enqueueProjectNotification({
                  project: enrolledProject,
                  dedupeKey: JSON.stringify([
                    "harvest_completed",
                    operation.operationId,
                    phaseKey,
                  ]),
                  ownerKind: "harvest",
                  ownerOperationId: operation.operationId,
                  eventType: "harvest_completed",
                  featureId: operation.featureId,
                  phaseId: phaseKey,
                  recipient: plannedSlackRecipient,
                  message: {
                    text:
                      learningEvidence?.summaryText ??
                      `Harvest completed for ${operation.featureId} (${phaseKey})`,
                    ...(learningEvidence?.blocks
                      ? { blocks: learningEvidence.blocks }
                      : {}),
                  },
                });
              const delivery = await outbox.flushOutboxItem(outboxId);
              if (delivery.status === "delivered") {
                if (
                  !transition(phaseKey, "slack_delivery", {
                    status: "succeeded",
                    evidenceJson: JSON.stringify({
                      outboxId,
                      messageTs: delivery.messageTs,
                      threadTs: delivery.threadTs,
                    }),
                  })
                ) {
                  break;
                }
              } else if (delivery.status === "uncertain") {
                if (
                  !transition(phaseKey, "slack_delivery", {
                    status: "uncertain",
                    evidenceJson: JSON.stringify({ outboxId }),
                    error: "Notification delivery outcome is uncertain",
                  })
                ) {
                  break;
                }
              } else {
                if (
                  !transition(phaseKey, "slack_delivery", {
                    status:
                      delivery.status === "failed"
                        ? "failed"
                        : "retryable_failure",
                    evidenceJson: JSON.stringify({ outboxId }),
                    error: `Notification delivery ended with status ${delivery.status}`,
                  })
                ) {
                  break;
                }
              }
            } catch (error) {
              transition(phaseKey, "slack_delivery", {
                status: "retryable_failure",
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }

        // 5. branch_cleanup
        const cleanupReceipt = receiptFor(phaseKey, "branch_cleanup");
        if (
          cleanupReceipt &&
          !isStageComplete(cleanupReceipt) &&
          cleanupReceipt.status !== "blocked_tip_mismatch"
        ) {
          if (!transition(phaseKey, "branch_cleanup", { status: "running" })) {
            break;
          }
          try {
            const observedRemoteHeadSha = operation.headBranch
              ? await vcs.getRemoteBranchSha(projectRoot, operation.headBranch)
              : null;
            const decision = evaluateBranchCleanupSafety({
              projectRepoSlug: enrolledProject.repoSlug,
              candidateRepoSlug: operation.repoSlug,
              headRepoSlug: operation.headRepoSlug,
              trunkBranch: enrolledProject.trunkBranch,
              headBranch: operation.headBranch,
              expectedHeadSha: operation.expectedHeadSha,
              observedRemoteHeadSha,
            });
            if (decision.action === "already_deleted") {
              transition(phaseKey, "branch_cleanup", {
                status: "succeeded",
                evidenceJson: JSON.stringify({
                  alreadyDeleted: true,
                  branch: operation.headBranch,
                }),
              });
            } else if (decision.action === "block_cleanup") {
              transition(phaseKey, "branch_cleanup", {
                status: "blocked_tip_mismatch",
                evidenceJson: JSON.stringify({
                  code: decision.code,
                  expectedHeadSha: operation.expectedHeadSha,
                  observedRemoteHeadSha,
                }),
                error: `Branch cleanup blocked: ${decision.code}`,
              });
            } else {
              const del = await vcs.deleteRemoteBranchAtTip(
                projectRoot,
                decision.branch,
                decision.expectedSha,
              );
              if (del.deleted || del.reason === "missing") {
                transition(phaseKey, "branch_cleanup", {
                  status: "succeeded",
                  evidenceJson: JSON.stringify({
                    deleted: del.deleted,
                    reason: del.reason ?? null,
                    branch: decision.branch,
                    expectedSha: decision.expectedSha,
                  }),
                });
              } else {
                transition(phaseKey, "branch_cleanup", {
                  status: "blocked_tip_mismatch",
                  evidenceJson: JSON.stringify({
                    code: "TIP_MOVED",
                    branch: decision.branch,
                    expectedSha: decision.expectedSha,
                  }),
                  error: "Branch cleanup blocked: TIP_MOVED",
                });
              }
            }
          } catch (error) {
            transition(phaseKey, "branch_cleanup", {
              status: "retryable_failure",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (checkoutState.handle) {
        try {
          await vcs.removeDetachedCheckout(
            projectRoot,
            checkoutState.handle.checkoutDir,
          );
        } catch {
          // Best-effort detached worktree cleanup.
        }
      }
    }

    return buildSummary();

    function buildSummary(): HarvestExecutionSummary {
      const derivedStatus = deriveHarvestTerminalStatus({
        terminalEvent: operation.terminalEvent,
        phaseIds: [...new Set(receipts.map((r) => r.phaseKey))],
        stages: receipts,
      });
      const { pendingStages, failedStages } = summarizeStages(receipts);
      return {
        operationId: operation.operationId,
        projectId: operation.projectId,
        workKey: operation.workKey,
        deduplicatedTransport: options.deduplicatedTransport,
        deduplicatedWork: options.deduplicatedWork,
        status: derivedStatus,
        linkedRunId,
        pendingStages,
        failedStages,
      };
    }
  }

  return {
    async ingestWebhook(input) {
      if (!input.deliveryId.trim()) {
        return {
          accepted: false,
          httpStatus: 400,
          reason: "Missing GitHub delivery ID",
        };
      }

      if (!input.webhookSecret?.trim()) {
        return {
          accepted: false,
          httpStatus: 401,
          reason: "GitHub webhook is disabled: secret is not configured",
        };
      }
      if (
        !github?.verifyWebhookSignature(
          input.rawBody,
          input.signatureHeader,
          input.webhookSecret,
        )
      ) {
        return {
          accepted: false,
          httpStatus: 401,
          reason: "Invalid webhook signature",
        };
      }

      if (input.eventType !== "pull_request") {
        return {
          accepted: false,
          httpStatus: 200,
          reason: `Unsupported webhook event: ${input.eventType}`,
        };
      }

      const parsed = WebhookPullRequestPayloadSchema.safeParse(
        input.parsedPayload,
      );
      if (!parsed.success) {
        return {
          accepted: false,
          httpStatus: 400,
          reason: "Malformed pull_request webhook payload",
        };
      }

      const { action, repository, pull_request: pr } = parsed.data;
      if (action !== "closed") {
        return {
          accepted: false,
          httpStatus: 200,
          reason: `Ignoring pull_request action: ${action}`,
        };
      }

      const receivedAt = clock.nowIso();
      const payloadDigest = sha256Hex(input.rawBody);
      const repoSlug = pr.base.repo?.full_name ?? repository?.full_name ?? null;
      const project = repoSlug ? registry.findByRepoSlug(repoSlug) : null;
      const terminalEvent: HarvestTerminalEvent = pr.merged
        ? "merged"
        : "closed_unmerged";
      const terminalAt =
        (pr.merged ? pr.merged_at : pr.closed_at) ?? receivedAt;

      const candidate: HarvestCandidateInput = {
        source: "github_webhook",
        deliveryId: input.deliveryId,
        repoSlug,
        headRepoSlug: pr.head.repo?.full_name ?? null,
        baseBranch: pr.base.ref,
        headBranch: pr.head.ref,
        expectedHeadSha: pr.head.sha ?? null,
        prNumber: pr.number,
        prUrl: pr.html_url,
        terminalEvent,
        mergeCommitSha: pr.merged ? (pr.merge_commit_sha ?? null) : null,
        terminalAt,
        recipient: project ? defaultSlackRecipient(project) : null,
      };

      if (!project) {
        const rejected = store.recordHarvestIntake({
          candidate,
          payloadDigest,
          receivedAt,
          target: {
            accepted: false,
            projectId: null,
            reason: "Repository is not enrolled",
          },
        });
        if (!rejected.ok) {
          return {
            accepted: false,
            httpStatus: 400,
            reason: rejected.code,
          };
        }
        return {
          accepted: false,
          httpStatus: 200,
          reason: "Repository is not enrolled",
        };
      }

      const verified = verifyHarvestTarget(project, candidate);
      if (!verified.ok) {
        const rejected = store.recordHarvestIntake({
          candidate,
          payloadDigest,
          receivedAt,
          target: {
            accepted: false,
            projectId: project.projectId,
            reason: verified.reason,
          },
        });
        if (!rejected.ok) {
          return {
            accepted: false,
            httpStatus: 400,
            reason: rejected.code,
          };
        }
        return {
          accepted: false,
          httpStatus: 200,
          reason: verified.reason,
        };
      }

      if (verified.kind !== "pull_request") {
        return {
          accepted: false,
          httpStatus: 400,
          reason: "Webhook candidate must identify a pull request",
        };
      }

      let checkoutPhaseIds: string[] | undefined;
      if (
        verified.pullRequestIdentity.terminalEvent === "merged" &&
        verified.phaseId === null
      ) {
        const projectRoot = projectCheckoutRoot(project);
        if (!projectRoot || !verified.pullRequestIdentity.mergeCommitSha) {
          return {
            accepted: false,
            httpStatus: 200,
            reason: "Checkout required to resolve whole-feature merge phases",
          };
        }
        checkoutPhaseIds = await discoverCheckoutPhases(
          projectRoot,
          verified.pullRequestIdentity.mergeCommitSha,
          verified.featureId,
          project.trunkBranch,
        );
      }

      const scopes = scopeVerifiedMergeToPhases(verified, checkoutPhaseIds);
      if (scopes.length === 0) {
        const rejected = store.recordHarvestIntake({
          candidate,
          payloadDigest,
          receivedAt,
          target: {
            accepted: false,
            projectId: project.projectId,
            reason: "No covered phases found at merge checkout",
          },
        });
        if (!rejected.ok) {
          return {
            accepted: false,
            httpStatus: 400,
            reason: rejected.code,
          };
        }
        return {
          accepted: false,
          httpStatus: 200,
          reason: "No covered phases found at merge checkout",
        };
      }

      if (project.slack) {
        candidate.recipient = defaultSlackRecipient(
          project,
          verified.featureId,
          scopes.map((s) => s.phaseId),
        );
      }

      const proposed = scopes.map((scope) =>
        buildProposedOperation({
          project,
          candidate,
          repoSlug: verified.repoSlug,
          featureId: scope.featureId,
          phaseId: scope.phaseId,
          workKey: scope.workKey,
          mergeCommitSha: verified.pullRequestIdentity.mergeCommitSha,
          receivedAt,
        }),
      );

      const intake = store.recordHarvestIntake({
        candidate,
        payloadDigest,
        receivedAt,
        target: {
          accepted: true,
          project,
          ...(checkoutPhaseIds !== undefined ? { checkoutPhaseIds } : {}),
          operations: proposed as [
            DurableHarvestOperation,
            ...DurableHarvestOperation[],
          ],
        },
      });
      if (!intake.ok) {
        return {
          accepted: false,
          httpStatus: 400,
          reason: intake.code,
        };
      }

      const primary = intake.operations[0];
      return {
        accepted: true,
        summary: summaryFromOperation(primary, {
          deduplicatedTransport: intake.deduplicatedTransport,
          deduplicatedWork: intake.deduplicatedWork,
        }),
      };
    },

    async pollProject(project, ownerId, pollOptions) {
      const projectRoot = projectCheckoutRoot(project);
      if (!github || !project.repoSlug || !projectRoot) return [];
      if (pollOptions?.signal?.aborted) return [];

      const existingCursor = store.getHarvestCursor(project.projectId);
      let facts: HarvestPullRequestFact[];
      try {
        facts = await github.listTerminalPullRequests({
          cwd: projectRoot,
          repoSlug: project.repoSlug,
          baseBranch: project.trunkBranch,
          sinceIso: existingCursor?.lastTerminalAt ?? null,
          ...(pollOptions?.signal ? { signal: pollOptions.signal } : {}),
        });
      } catch (error) {
        if (!pollOptions?.signal?.aborted) {
          store.saveHarvestCursor({
            projectId: project.projectId,
            lastPolledAt: clock.nowIso(),
            lastTerminalAt: existingCursor?.lastTerminalAt ?? null,
            lastPrNumber: existingCursor?.lastPrNumber ?? null,
            lastError: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
      if (pollOptions?.signal?.aborted) return [];

      const sorted = [...facts].sort((a, b) => {
        const aTime = Date.parse(a.mergedAt ?? a.closedAt ?? "");
        const bTime = Date.parse(b.mergedAt ?? b.closedAt ?? "");
        if (aTime !== bTime) return aTime - bTime;
        return a.prNumber - b.prNumber;
      });

      const acceptedEntries: Array<{
        operation: DurableHarvestOperation;
        deduplicatedTransport: boolean;
        deduplicatedWork: boolean;
      }> = [];

      let maxTerminalAt: string | null = existingCursor?.lastTerminalAt ?? null;
      let maxPrNumber: number | null = existingCursor?.lastPrNumber ?? null;

      const failPoll = (error: unknown): never => {
        const message = error instanceof Error ? error.message : String(error);
        store.saveHarvestCursor({
          projectId: project.projectId,
          lastPolledAt: clock.nowIso(),
          lastTerminalAt: maxTerminalAt,
          lastPrNumber: maxPrNumber,
          lastError: message,
        });
        throw error instanceof Error ? error : new Error(message);
      };

      for (const fact of sorted) {
        const receivedAt = clock.nowIso();
        const terminalEvent: HarvestTerminalEvent = fact.merged
          ? "merged"
          : "closed_unmerged";
        const terminalAt =
          (fact.merged ? fact.mergedAt : fact.closedAt) ?? receivedAt;
        const deliveryId = `poller:${fact.repoSlug.toLowerCase()}:${fact.prNumber}:${terminalEvent}:${fact.merged ? (fact.mergeCommitSha?.toLowerCase() ?? "") : terminalAt}`;
        const payloadDigest = sha256Hex(
          JSON.stringify({
            repoSlug: fact.repoSlug.toLowerCase(),
            headRepoSlug: fact.headRepoSlug?.toLowerCase() ?? null,
            prNumber: fact.prNumber,
            prUrl: fact.prUrl,
            state: fact.state,
            merged: fact.merged,
            baseBranch: fact.baseBranch,
            headBranch: fact.headBranch,
            headSha: fact.headSha?.toLowerCase() ?? null,
            mergeCommitSha: fact.mergeCommitSha?.toLowerCase() ?? null,
            mergedAt: fact.mergedAt,
            closedAt: fact.closedAt,
          }),
        );

        const candidate = buildPullRequestCandidate(
          "github_poller",
          deliveryId,
          project,
          fact,
        );
        try {
          const verified = verifyHarvestTarget(project, candidate);
          if (!verified.ok || verified.kind !== "pull_request") {
            const rejected = store.recordHarvestIntake({
              candidate,
              payloadDigest,
              receivedAt,
              target: {
                accepted: false,
                projectId: project.projectId,
                reason: verified.ok
                  ? "Unexpected non-PR poller target"
                  : verified.reason,
              },
            });
            if (!rejected.ok) {
              throw new Error(
                `Harvest poller intake rejected for PR #${fact.prNumber}: ${rejected.code}`,
              );
            }
          } else {
            let checkoutPhaseIds: string[] | undefined;
            if (
              verified.pullRequestIdentity.terminalEvent === "merged" &&
              verified.phaseId === null &&
              verified.pullRequestIdentity.mergeCommitSha
            ) {
              checkoutPhaseIds = await discoverCheckoutPhases(
                projectRoot,
                verified.pullRequestIdentity.mergeCommitSha,
                verified.featureId,
                project.trunkBranch,
              );
            }

            const scopes = scopeVerifiedMergeToPhases(
              verified,
              checkoutPhaseIds,
            );
            if (scopes.length === 0) {
              const rejected = store.recordHarvestIntake({
                candidate,
                payloadDigest,
                receivedAt,
                target: {
                  accepted: false,
                  projectId: project.projectId,
                  reason: "No covered phases found at merge checkout",
                },
              });
              if (!rejected.ok) {
                throw new Error(
                  `Harvest poller intake rejected for PR #${fact.prNumber}: ${rejected.code}`,
                );
              }
            } else {
              if (project.slack) {
                candidate.recipient = defaultSlackRecipient(
                  project,
                  verified.featureId,
                  scopes.map((s) => s.phaseId),
                );
              }
              const proposed = scopes.map((scope) =>
                buildProposedOperation({
                  project,
                  candidate,
                  repoSlug: verified.repoSlug,
                  featureId: scope.featureId,
                  phaseId: scope.phaseId,
                  workKey: scope.workKey,
                  mergeCommitSha: verified.pullRequestIdentity.mergeCommitSha,
                  receivedAt,
                }),
              );
              const intake = store.recordHarvestIntake({
                candidate,
                payloadDigest,
                receivedAt,
                target: {
                  accepted: true,
                  project,
                  ...(checkoutPhaseIds !== undefined
                    ? { checkoutPhaseIds }
                    : {}),
                  operations: proposed as [
                    DurableHarvestOperation,
                    ...DurableHarvestOperation[],
                  ],
                },
              });
              if (!intake.ok) {
                throw new Error(
                  `Harvest poller intake rejected for PR #${fact.prNumber}: ${intake.code}`,
                );
              }
              for (const operation of intake.operations) {
                acceptedEntries.push({
                  operation,
                  deduplicatedTransport: intake.deduplicatedTransport,
                  deduplicatedWork: intake.deduplicatedWork,
                });
              }
            }
          }
        } catch (error) {
          failPoll(error);
        }

        if (
          maxTerminalAt === null ||
          Date.parse(terminalAt) > Date.parse(maxTerminalAt) ||
          (Date.parse(terminalAt) === Date.parse(maxTerminalAt) &&
            fact.prNumber > (maxPrNumber ?? 0))
        ) {
          maxTerminalAt = terminalAt;
          maxPrNumber = fact.prNumber;
        }
      }

      store.saveHarvestCursor({
        projectId: project.projectId,
        lastPolledAt: clock.nowIso(),
        lastTerminalAt: maxTerminalAt,
        lastPrNumber: maxPrNumber,
        lastError: null,
      });

      const summaries: HarvestExecutionSummary[] = [];
      for (const entry of acceptedEntries) {
        if (pollOptions?.signal?.aborted) break;
        summaries.push(
          await executeHarvestOperation(entry.operation, project, ownerId, {
            updateLocalTaskState: false,
            deduplicatedTransport: entry.deduplicatedTransport,
            deduplicatedWork: entry.deduplicatedWork,
          }),
        );
      }
      return summaries;
    },

    async runManualHarvest(input) {
      const {
        project,
        featureId,
        phaseId,
        prNumber,
        updateLocalTaskState,
        ownerId,
      } = input;
      const projectRoot = projectCheckoutRoot(project);
      if (!projectRoot) {
        throw new Error("Project enrollment has no localRoot or mirrorPath");
      }

      if (prNumber !== undefined) {
        if (!github || !project.repoSlug) {
          throw new Error(
            "Manual PR harvest requires GitHub access and an enrolled repoSlug",
          );
        }
        const fact = await github.getPullRequest({
          cwd: projectRoot,
          repoSlug: project.repoSlug,
          prNumber,
        });
        if (!fact || fact.state === "OPEN") {
          throw new Error(
            `Pull request #${prNumber} is not in a terminal state`,
          );
        }
        const receivedAt = clock.nowIso();
        const terminalEvent: HarvestTerminalEvent = fact.merged
          ? "merged"
          : "closed_unmerged";
        const terminalAt =
          (fact.merged ? fact.mergedAt : fact.closedAt) ?? receivedAt;
        const deliveryId = `manual:pr:${project.projectId}:${fact.prNumber}:${terminalEvent}:${fact.merged ? (fact.mergeCommitSha?.toLowerCase() ?? "") : terminalAt}:${featureId}:${phaseId ?? "all"}`;
        const payloadDigest = sha256Hex(
          JSON.stringify({
            projectId: project.projectId,
            repoSlug: fact.repoSlug.toLowerCase(),
            prNumber: fact.prNumber,
            terminalEvent,
            mergeCommitSha: fact.mergeCommitSha?.toLowerCase() ?? null,
            featureId,
            phaseId: phaseId ?? null,
          }),
        );
        const candidate = buildPullRequestCandidate(
          "manual_cli",
          deliveryId,
          project,
          fact,
          {
            explicitFeatureId: featureId,
            explicitPhaseId: phaseId,
            recipient: input.recipient,
          },
        );
        const verified = verifyHarvestTarget(project, candidate);
        if (!verified.ok || verified.kind !== "pull_request") {
          throw new Error(
            verified.ok
              ? "Manual PR harvest target did not resolve as a pull request"
              : verified.reason,
          );
        }

        let checkoutPhaseIds: string[] | undefined;
        if (
          verified.pullRequestIdentity.terminalEvent === "merged" &&
          (verified.phaseId === null || verified.requestedPhaseId !== undefined)
        ) {
          if (!verified.pullRequestIdentity.mergeCommitSha) {
            throw new Error("Merged pull request is missing mergeCommitSha");
          }
          checkoutPhaseIds = await discoverCheckoutPhases(
            projectRoot,
            verified.pullRequestIdentity.mergeCommitSha,
            verified.featureId,
            project.trunkBranch,
          );
        }

        const scopes = scopeVerifiedMergeToPhases(verified, checkoutPhaseIds);
        if (scopes.length === 0) {
          store.recordHarvestIntake({
            candidate,
            payloadDigest,
            receivedAt,
            target: {
              accepted: false,
              projectId: project.projectId,
              reason: "Requested phase is not covered at merge checkout",
            },
          });
          throw new Error("Requested phase is not covered at merge checkout");
        }

        if (input.recipient === undefined && project.slack) {
          candidate.recipient = defaultSlackRecipient(
            project,
            verified.featureId,
            scopes.map((s) => s.phaseId),
          );
        }

        const proposed = scopes.map((scope) =>
          buildProposedOperation({
            project,
            candidate,
            repoSlug: verified.repoSlug,
            featureId: scope.featureId,
            phaseId: scope.phaseId,
            workKey: scope.workKey,
            mergeCommitSha: verified.pullRequestIdentity.mergeCommitSha,
            receivedAt,
          }),
        );
        const intake = store.recordHarvestIntake({
          candidate,
          payloadDigest,
          receivedAt,
          target: {
            accepted: true,
            project,
            ...(checkoutPhaseIds !== undefined ? { checkoutPhaseIds } : {}),
            operations: proposed as [
              DurableHarvestOperation,
              ...DurableHarvestOperation[],
            ],
          },
        });
        if (!intake.ok) {
          throw new Error(`Manual PR harvest intake rejected: ${intake.code}`);
        }

        const summaries: HarvestExecutionSummary[] = [];
        for (const op of intake.operations) {
          summaries.push(
            await executeHarvestOperation(op, project, ownerId, {
              updateLocalTaskState,
              deduplicatedTransport: intake.deduplicatedTransport,
              deduplicatedWork: intake.deduplicatedWork,
            }),
          );
        }
        return summaries;
      }

      // Manual local commit harvest (prNumber is undefined).
      const trunkSha = await vcs.resolveRefSha(
        projectRoot,
        project.trunkBranch,
      );
      if (trunkSha === null) {
        throw new Error(
          `Configured trunk branch ${project.trunkBranch} cannot be resolved`,
        );
      }

      const resolvedSha = input.commitSha
        ? FULL_GIT_SHA.test(input.commitSha.trim())
          ? input.commitSha.trim().toLowerCase()
          : ((
              await vcs.resolveRefSha(projectRoot, input.commitSha.trim())
            )?.toLowerCase() ?? null)
        : trunkSha.toLowerCase();

      if (!resolvedSha) {
        throw new Error("Could not resolve commit SHA for manual harvest");
      }

      if (input.commitSha) {
        const ancestor = await vcs.isCommitAncestorOfRef(
          projectRoot,
          resolvedSha,
          project.trunkBranch,
        );
        if (!ancestor) {
          throw new Error(
            `Commit ${resolvedSha} is not an ancestor of configured trunk branch ${project.trunkBranch}`,
          );
        }
      }

      const identityFacts = vcs.discoverIdentityFacts?.(projectRoot);
      const checkoutRepoSlug = identityFacts?.remoteOriginUrl
        ? (normalizeGitRemoteSlug(identityFacts.remoteOriginUrl)?.replace(
            /^github\.com\//,
            "",
          ) ?? null)
        : null;

      const checkoutPhaseIds = await discoverCheckoutPhases(
        projectRoot,
        resolvedSha,
        featureId,
      );
      if (checkoutPhaseIds.length === 0) {
        throw new Error(
          `No phases found for ${featureId} at commit ${resolvedSha}`,
        );
      }

      const receivedAt = clock.nowIso();
      const baseDeliveryId = `manual:commit:${project.projectId}:${resolvedSha}:${featureId}:${phaseId ?? "all"}`;
      const baseCandidate: HarvestCandidateInput = {
        source: "manual_cli",
        deliveryId: baseDeliveryId,
        repoSlug: project.repoSlug,
        checkoutRepoSlug,
        headRepoSlug: null,
        baseBranch: project.trunkBranch,
        headBranch: null,
        expectedHeadSha: null,
        prNumber: null,
        prUrl: null,
        terminalEvent: "merged",
        mergeCommitSha: resolvedSha,
        terminalAt: receivedAt,
        explicitFeatureId: featureId,
        ...(phaseId !== undefined ? { explicitPhaseId: phaseId } : {}),
        recipient: null,
      };

      const scopedCandidates = scopeManualHarvestToPhases(
        baseCandidate,
        checkoutPhaseIds,
      );
      if (scopedCandidates.length === 0) {
        throw new Error(
          `No matching phases found for ${featureId} at commit ${resolvedSha}`,
        );
      }

      // Verify all scoped candidates before recording the first one.
      const prepared: Array<{
        candidate: HarvestCandidateInput;
        payloadDigest: string;
        operation: DurableHarvestOperation;
      }> = [];

      for (const scoped of scopedCandidates) {
        const verified = verifyHarvestTarget(project, scoped);
        if (!verified.ok) {
          throw new Error(verified.reason);
        }
        const operation = buildProposedOperation({
          project,
          candidate: scoped,
          repoSlug: verified.repoSlug,
          featureId: verified.featureId,
          phaseId: verified.phaseId,
          workKey: verified.workKey,
          mergeCommitSha: resolvedSha,
          receivedAt,
        });
        if (
          !verifyHarvestIntakeOperations(project, scoped, checkoutPhaseIds, [
            operation,
          ])
        ) {
          throw new Error(
            `Phase ${scoped.explicitPhaseId ?? "unknown"} is not covered by checkout`,
          );
        }
        const payloadDigest = sha256Hex(
          JSON.stringify({
            projectId: project.projectId,
            repoSlug: project.repoSlug?.toLowerCase() ?? null,
            checkoutRepoSlug: checkoutRepoSlug?.toLowerCase() ?? null,
            baseBranch: project.trunkBranch,
            mergeCommitSha: resolvedSha,
            featureId: verified.featureId,
            phaseId: verified.phaseId,
          }),
        );
        prepared.push({ candidate: scoped, payloadDigest, operation });
      }

      const summaries: HarvestExecutionSummary[] = [];
      for (const entry of prepared) {
        const intake = store.recordHarvestIntake({
          candidate: entry.candidate,
          payloadDigest: entry.payloadDigest,
          receivedAt,
          target: {
            accepted: true,
            project,
            checkoutPhaseIds,
            operations: [entry.operation],
          },
        });
        if (!intake.ok) {
          throw new Error(
            `Manual commit harvest intake rejected: ${intake.code}`,
          );
        }
        for (const op of intake.operations) {
          summaries.push(
            await executeHarvestOperation(op, project, ownerId, {
              updateLocalTaskState,
              deduplicatedTransport: intake.deduplicatedTransport,
              deduplicatedWork: intake.deduplicatedWork,
            }),
          );
        }
      }
      return summaries;
    },

    async resumeIncomplete(ownerId) {
      const recoverable = store.listRecoverableHarvests({
        nowIso: clock.nowIso(),
      });
      const summaries: HarvestExecutionSummary[] = [];
      for (const op of recoverable) {
        const project = registry.getProject(op.projectId);
        if (!project) continue;
        summaries.push(
          await executeHarvestOperation(op, project, ownerId, {
            updateLocalTaskState: false,
            deduplicatedTransport: false,
            deduplicatedWork: false,
          }),
        );
      }
      return summaries;
    },
  };
}
