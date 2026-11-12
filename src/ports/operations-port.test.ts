/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";
import {
  type DurableDispatchOperation,
  evaluateDispatchAcceptance,
  validateLeaseFence,
} from "../domain/durable-dispatch.js";
import {
  type HarvestCandidateInput,
  type HarvestStageReceipt,
  canCorrelateHarvestIntake,
  deriveHarvestTerminalStatus,
  evaluateBranchCleanupSafety,
  hasVerifiedBranchCleanupTarget,
  isCompleteHarvestStagePlan,
  isHarvestSlackRecipient,
  isStaleHarvestClose,
  isValidHarvestStageTransition,
  matchesHarvestNoticeRecipient,
  mergeVerifiedHarvestFacts,
  planHarvestStages,
  planLateBranchCleanup,
  resolveHarvestSlackRecipient,
  scopeManualHarvestToPhases,
  scopeVerifiedMergeToPhases,
  sharesHarvestRepositoryScope,
  verifyHarvestIntakeOperations,
  verifyHarvestTarget,
} from "../domain/durable-harvest.js";
import type {
  EnrolledProject,
  ProjectSlackBinding,
  SlackFeatureThread,
} from "../domain/project-registry.js";
import type {
  DurableHarvestOperation,
  HarvestExecutionPort,
  OperationsStorePort,
  OutboxItem,
  WorkerExecutionPort,
} from "./operations-port.js";
import type { VcsPort } from "./vcs-port.js";

type RecoveryStore = Pick<
  OperationsStorePort,
  | "getDispatchOperation"
  | "listRecoverableHarvests"
  | "claimHarvestLease"
  | "heartbeatHarvestLease"
  | "initializeHarvestStages"
  | "transitionHarvestStage"
  | "getOutboxItem"
  | "listRecoverableOutboxItems"
  | "claimOutboxItem"
>;

const projectId = "project-a";
const featureId = "049-durable-dispatch-harvest";
const phaseId = "phase-01";
const createdAt = "2026-11-11T11:58:00.000Z";
const nowIso = "2026-11-11T12:00:00.000Z";
const leaseExpiresAt = "2026-11-11T12:01:00.000Z";
const sha = "a".repeat(40);
const destination = { workspaceId: "W1", channelId: "C2", threadTs: "2.1" };

function harvest(
  operationId: string,
  overrides: Partial<DurableHarvestOperation> = {},
): DurableHarvestOperation {
  return {
    operationId,
    projectId,
    workKey: "harvest:42",
    repoSlug: "acme/a",
    headRepoSlug: "acme/a",
    trunkBranch: "develop",
    featureId,
    phaseId,
    prNumber: 42,
    prUrl: "https://github.com/acme/a/pull/42",
    headBranch: `feat/${featureId}-${phaseId}`,
    expectedHeadSha: sha,
    terminalEvent: "merged",
    mergeCommitSha: sha,
    terminalAt: createdAt,
    recipient: null,
    plannedSlackRecipient: null,
    status: "accepted",
    leaseOwner: null,
    leaseEpoch: 0,
    leaseExpiresAt: null,
    linkedRunId: null,
    lastError: null,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    ...overrides,
  };
}

type HarvestIntake = Parameters<OperationsStorePort["recordHarvestIntake"]>[0];
type HarvestIntakeFacts = Partial<DurableHarvestOperation> &
  Pick<HarvestCandidateInput, "checkoutRepoSlug">;

function harvestIntake(
  operationId: string,
  { checkoutRepoSlug, ...overrides }: HarvestIntakeFacts = {},
  source?: HarvestCandidateInput["source"],
  checkoutPhaseIds?: readonly string[],
): HarvestIntake {
  const operation = harvest(operationId, overrides);
  const candidate: HarvestCandidateInput = {
    source:
      source ?? (operation.prNumber === null ? "manual_cli" : "github_webhook"),
    deliveryId: operationId,
    repoSlug: operation.repoSlug,
    checkoutRepoSlug,
    headRepoSlug: operation.headRepoSlug,
    baseBranch: operation.trunkBranch,
    headBranch: operation.headBranch,
    expectedHeadSha: operation.expectedHeadSha,
    prNumber: operation.prNumber,
    prUrl: operation.prUrl,
    terminalEvent: operation.terminalEvent,
    mergeCommitSha: operation.mergeCommitSha,
    terminalAt: operation.terminalAt,
    explicitFeatureId: operation.featureId,
    explicitPhaseId: operation.phaseId ?? undefined,
  };
  const project: EnrolledProject = {
    projectId: operation.projectId,
    slug: "a",
    name: "A",
    repoSlug: operation.repoSlug ?? "acme/a",
    trunkBranch: operation.trunkBranch,
    localRoot: "/repos/a",
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["local"] },
    slack: null,
    legacyProjectIds: [],
    createdAt,
    updatedAt: createdAt,
  };
  const verified = verifyHarvestTarget(project, candidate);
  if (!verified.ok) throw new Error(verified.reason);
  Object.assign(operation, {
    workKey: verified.workKey,
    repoSlug: verified.repoSlug,
    featureId: verified.featureId,
    phaseId: verified.phaseId,
    mergeCommitSha: operation.mergeCommitSha?.trim().toLowerCase() ?? null,
  });
  const delivery = {
    candidate,
    payloadDigest: operationId,
    receivedAt: nowIso,
  };
  if (checkoutPhaseIds === undefined) {
    return {
      ...delivery,
      target: { accepted: true, project, operations: [operation] },
    };
  }
  if (verified.kind !== "pull_request")
    throw new Error("Expected verified merge");
  const [first, ...rest] = scopeVerifiedMergeToPhases(
    verified,
    checkoutPhaseIds,
  );
  const toOperation = (scope: NonNullable<typeof first>) => ({
    ...operation,
    ...scope,
    operationId: `${operationId}-${scope.phaseId}`,
  });
  return {
    ...delivery,
    target: first
      ? {
          accepted: true,
          project,
          checkoutPhaseIds,
          operations: [toOperation(first), ...rest.map(toOperation)],
        }
      : {
          accepted: false,
          projectId: operation.projectId,
          reason: "No covered phases at checkout",
        },
  };
}

function wholeFeatureMergeIntake(
  deliveryId: string,
  prNumber: number,
  phaseIds: readonly string[],
  source: "github_webhook" | "github_poller" = "github_webhook",
): HarvestIntake {
  return harvestIntake(
    deliveryId,
    {
      prNumber,
      prUrl: `https://github.com/acme/a/pull/${prNumber}`,
      phaseId: null,
      headBranch: `feat/${featureId}`,
    },
    source,
    phaseIds,
  );
}

const offline = {
  prNumber: null,
  prUrl: null,
  repoSlug: null,
  headRepoSlug: null,
  headBranch: null,
  expectedHeadSha: null,
};
const verifiedOffline = { ...offline, checkoutRepoSlug: "Acme/A" };

function learningReceipt(operationId: string): HarvestStageReceipt {
  return {
    operationId,
    phaseKey: phaseId,
    stage: "learning_record",
    status: "succeeded",
    leaseEpoch: 1,
    attemptCount: 1,
    evidenceJson: null,
    error: null,
    updatedAt: nowIso,
    completedAt: nowIso,
  };
}

function restoreHarvestIntake(persisted: {
  harvests: DurableHarvestOperation[];
  stages: HarvestStageReceipt[];
  aliases?: { projectId: string; workKey: string; operationId: string }[];
  deliveries?: {
    key: string;
    projectId: string | null;
    repoSlug: string | null;
    checkoutRepoSlug: string | null;
    payloadDigest: string;
    operationIds: string[];
  }[];
}) {
  let rows = structuredClone({
    ...persisted,
    aliases: persisted.aliases ?? [],
    deliveries: persisted.deliveries ?? [],
  });
  const store: Pick<OperationsStorePort, "recordHarvestIntake"> = {
    recordHarvestIntake({ candidate, payloadDigest, receivedAt, target }) {
      const key = JSON.stringify([candidate.source, candidate.deliveryId]);
      const projectId = target.accepted
        ? target.project.projectId
        : target.projectId;
      const repoSlug = candidate.repoSlug?.toLowerCase() ?? null;
      const checkoutRepoSlug =
        candidate.source === "manual_cli" && candidate.prNumber === null
          ? (candidate.checkoutRepoSlug?.toLowerCase() ?? null)
          : null;
      const delivery = rows.deliveries.find((row) => row.key === key);
      if (delivery) {
        if (
          delivery.projectId !== projectId ||
          delivery.payloadDigest !== payloadDigest ||
          delivery.repoSlug !== repoSlug ||
          delivery.checkoutRepoSlug !== checkoutRepoSlug
        ) {
          return { ok: false, code: "DELIVERY_ID_CONFLICT" };
        }
        return {
          ok: true,
          operations: delivery.operationIds.map((operationId) => {
            const operation = rows.harvests.find(
              (row) =>
                row.projectId === projectId && row.operationId === operationId,
            );
            if (!operation) throw new Error("Expected persisted operation");
            return operation;
          }),
          deduplicatedTransport: true,
          deduplicatedWork: delivery.operationIds.length > 0,
        };
      }
      if (
        target.accepted &&
        (!verifyHarvestIntakeOperations(
          target.project,
          candidate,
          target.checkoutPhaseIds,
          target.operations,
        ) ||
          target.operations.some(
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
        return { ok: false, code: "HARVEST_IDENTITY_MISMATCH" };
      }
      const incoming = target.accepted
        ? target.operations.map((operation) => ({
            ...operation,
            recipient: candidate.recipient ?? null,
          }))
        : [];
      const transaction = structuredClone(rows);
      const operations: DurableHarvestOperation[] = [];
      for (const operation of incoming) {
        const matched = matchScope(transaction, operation, receivedAt);
        if (!matched) return { ok: false, code: "HARVEST_IDENTITY_MISMATCH" };
        operations.push(matched);
      }
      transaction.deliveries.push({
        key,
        projectId,
        repoSlug,
        checkoutRepoSlug,
        payloadDigest,
        operationIds: operations.map((row) => row.operationId),
      });
      rows = transaction;
      return {
        ok: true,
        operations,
        deduplicatedTransport: false,
        deduplicatedWork:
          operations.length > 0 &&
          operations.every((row, index) => row !== incoming[index]),
      };
    },
  };

  function matchScope(
    { harvests, aliases, stages: receipts }: typeof rows,
    incoming: DurableHarvestOperation,
    receivedAt: string,
  ): DurableHarvestOperation | null {
    if (incoming.terminalEvent === "closed_unmerged") {
      const merge = harvests
        .filter((row) => isStaleHarvestClose(row, incoming))
        .sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) ||
            a.operationId.localeCompare(b.operationId),
        )[0];
      if (merge) return merge;
    }
    const alias = aliases.find(
      (row) =>
        row.projectId === incoming.projectId &&
        row.workKey === incoming.workKey,
    );
    const existing =
      harvests.find(
        (row) =>
          sharesHarvestRepositoryScope(row, incoming) &&
          (row.workKey === incoming.workKey ||
            row.operationId === alias?.operationId),
      ) ??
      harvests
        .filter((row) => canCorrelateHarvestIntake(row, incoming))
        .sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) ||
            a.operationId.localeCompare(b.operationId),
        )[0];
    if (!existing) {
      if (harvests.some((row) => row.operationId === incoming.operationId)) {
        return null;
      }
      harvests.push(incoming);
      return incoming;
    }
    const result = mergeVerifiedHarvestFacts(existing, incoming);
    if (result.kind === "conflict") return null;
    if (!alias && existing.workKey !== incoming.workKey) {
      aliases.push({
        projectId: incoming.projectId,
        workKey: incoming.workKey,
        operationId: existing.operationId,
      });
    }
    if (result.kind === "unchanged") return existing;
    const cleanup = planLateBranchCleanup({
      operationId: existing.operationId,
      prior: existing,
      verified: incoming,
      stages: receipts,
      nowIso: receivedAt,
    });
    Object.assign(existing, result.facts, { updatedAt: receivedAt });
    if (cleanup.length) {
      const stages = receipts.filter(
        ({ operationId }) => operationId === existing.operationId,
      );
      for (const planned of cleanup) {
        const receipt = stages.find(
          ({ phaseKey, stage }) =>
            phaseKey === planned.phaseKey && stage === planned.stage,
        );
        if (!receipt) throw new Error("Expected the skipped cleanup receipt");
        Object.assign(receipt, planned);
      }
      existing.status = deriveHarvestTerminalStatus({
        terminalEvent: existing.terminalEvent,
        phaseIds: [...new Set(stages.map(({ phaseKey }) => phaseKey))],
        stages,
      });
      existing.completedAt = null;
    }
    return existing;
  }

  return {
    store,
    snapshot: () => structuredClone(rows),
  };
}

function outbox(
  outboxId: string,
  status: OutboxItem["status"],
  overrides: Partial<OutboxItem> = {},
): OutboxItem {
  return {
    outboxId,
    projectId,
    dedupeKey: outboxId,
    ownerKind: "harvest",
    ownerOperationId: "unstarted",
    eventType: "harvest_completed",
    featureId,
    phaseId,
    recipient: {
      projectId,
      surface: "slack",
      channelId: "C1",
      threadTs: "1.2",
    },
    payload: { text: "Harvest completed" },
    clientMetadataKey: outboxId,
    status,
    workspaceId: null,
    channelId: null,
    threadTs: null,
    messageTs: null,
    attemptCount: status === "pending" ? 0 : 1,
    lastError: null,
    createdAt,
    updatedAt: createdAt,
    deliveredAt: null,
    ...overrides,
  };
}

function restoreRecoveryStore(persisted: {
  dispatches?: DurableDispatchOperation[];
  featureThreads?: SlackFeatureThread[];
  slackBindings?: Record<string, ProjectSlackBinding>;
  harvests: DurableHarvestOperation[];
  stages: HarvestStageReceipt[];
  outboxItems: OutboxItem[];
}) {
  const {
    dispatches = [],
    featureThreads = [],
    slackBindings = {},
    harvests,
    stages,
    outboxItems,
  } = structuredClone(persisted);
  const resumableHarvests = ["accepted", "running", "delivery_pending"];
  const byCreation = (a: { createdAt: string }, b: { createdAt: string }) =>
    a.createdAt.localeCompare(b.createdAt);

  const store: RecoveryStore = {
    getDispatchOperation({ projectId, featureId, phaseId }) {
      const [operation] = dispatches
        .filter(
          (row) =>
            row.projectId === projectId &&
            row.featureId === featureId &&
            row.phaseId === phaseId,
        )
        .sort(
          (a, b) =>
            byCreation(b, a) || b.operationId.localeCompare(a.operationId),
        );
      return structuredClone(operation ?? null);
    },
    listRecoverableHarvests({ nowIso, projectId }) {
      return harvests
        .filter((row) => projectId === undefined || row.projectId === projectId)
        .filter((row) => resumableHarvests.includes(row.status))
        .filter((row) => !row.leaseExpiresAt || row.leaseExpiresAt <= nowIso)
        .sort(byCreation);
    },
    claimHarvestLease({ operationId, nowIso, leaseOwner, leaseExpiresAt }) {
      const row = store
        .listRecoverableHarvests({ nowIso })
        .find((row) => row.operationId === operationId);
      if (!row) return null;
      row.leaseOwner = leaseOwner;
      row.leaseEpoch += 1;
      row.leaseExpiresAt = leaseExpiresAt;
      return {
        fence: { operationId, leaseOwner, leaseEpoch: row.leaseEpoch },
        operation: { ...row },
        stages: stages.filter((stage) => stage.operationId === operationId),
      };
    },
    heartbeatHarvestLease({ fence, nowIso, leaseExpiresAt }) {
      const row = harvests.find((row) => row.operationId === fence.operationId);
      if (!row) return { ok: false, code: "LEASE_FENCED" };
      const result = validateLeaseFence(row, fence, nowIso);
      if (!result.ok) return result;
      row.leaseExpiresAt = leaseExpiresAt;
      row.updatedAt = nowIso;
      return result;
    },
    initializeHarvestStages({ fence, nowIso, phaseIds, stages: plan }) {
      const row = harvests.find((row) => row.operationId === fence.operationId);
      if (!row) return { ok: false, code: "LEASE_FENCED" };
      const lease = validateLeaseFence(row, fence, nowIso);
      if (!lease.ok) return lease;
      const saved = stages.filter(
        ({ operationId }) => operationId === fence.operationId,
      );
      const recipient = saved.length
        ? row.plannedSlackRecipient
        : resolveHarvestSlackRecipient({
            projectId: row.projectId,
            featureId: row.featureId,
            recipient: row.recipient,
            binding: slackBindings[row.projectId] ?? null,
            thread: featureThreads.find(
              (entry) =>
                entry.projectId === row.projectId &&
                entry.featureId === row.featureId,
            ),
          });
      if (
        (row.phaseId !== null &&
          (phaseIds.length !== 1 || phaseIds[0] !== row.phaseId)) ||
        !isCompleteHarvestStagePlan({
          terminalEvent: row.terminalEvent,
          phaseIds,
          hasSlackTarget: recipient !== null,
          hasRemoteBranchTarget: hasVerifiedBranchCleanupTarget(row),
          stages: plan,
        })
      ) {
        return { ok: false, code: "HARVEST_PLAN_CONFLICT" };
      }
      const key = ({ phaseKey, stage }: { phaseKey: string; stage: string }) =>
        JSON.stringify([phaseKey, stage]);
      const keys = new Set(plan.map(key));
      if (
        saved.length &&
        (saved.length !== keys.size ||
          !saved.every((entry) => keys.has(key(entry))))
      ) {
        return { ok: false, code: "HARVEST_PLAN_CONFLICT" };
      }
      if (!saved.length) {
        row.plannedSlackRecipient = recipient;
        stages.push(
          ...plan.map(({ phaseKey, stage, initialStatus }) => ({
            ...learningReceipt(fence.operationId),
            phaseKey,
            stage,
            status: initialStatus,
            leaseEpoch: fence.leaseEpoch,
            attemptCount: 0,
            updatedAt: nowIso,
            completedAt: null,
          })),
        );
      }
      return { ok: true };
    },
    transitionHarvestStage({
      fence,
      nowIso,
      phaseKey,
      stage,
      status,
      failureNotice,
      evidenceJson,
      error,
      linkedRunId,
    }) {
      const row = harvests.find((row) => row.operationId === fence.operationId);
      if (!row) return { ok: false, code: "LEASE_FENCED" };
      const result = validateLeaseFence(row, fence, nowIso);
      if (!result.ok) return result;
      const planned = stages.filter(
        (entry) => entry.operationId === fence.operationId,
      );
      const receipt = planned.find(
        (entry) => entry.phaseKey === phaseKey && entry.stage === stage,
      );
      if (!receipt) return { ok: false, code: "HARVEST_STAGE_UNPLANNED" };
      const invalid = {
        ok: false,
        code: "HARVEST_STAGE_TRANSITION_INVALID",
      } as const;
      const gateFailure = stage === "gate_verify" && status === "gate_failed";
      const replay =
        gateFailure &&
        row.status === "gate_failed" &&
        receipt.status === "gate_failed";
      if (
        !replay &&
        (!resumableHarvests.includes(row.status) ||
          !isValidHarvestStageTransition(receipt, status))
      ) {
        return invalid;
      }
      if (gateFailure) {
        const dedupeKey = JSON.stringify([
          "harvest_gate_failed",
          row.operationId,
          phaseKey,
        ]);
        const savedNotice = outboxItems.find(
          (item) =>
            item.projectId === row.projectId && item.dedupeKey === dedupeKey,
        );
        const recipient = savedNotice?.recipient ?? row.plannedSlackRecipient;
        if ((recipient !== null) !== (failureNotice != null)) return invalid;
        if (
          failureNotice &&
          (failureNotice.eventType !== "harvest_gate_failed" ||
            failureNotice.ownerKind !== "harvest" ||
            failureNotice.ownerOperationId !== row.operationId ||
            failureNotice.projectId !== row.projectId ||
            recipient?.projectId !== row.projectId ||
            !matchesHarvestNoticeRecipient(
              recipient,
              failureNotice.recipient,
            ) ||
            failureNotice.featureId !== row.featureId ||
            failureNotice.phaseId !== phaseKey)
        ) {
          return invalid;
        }
        if (replay) return result;
        if (failureNotice && recipient && !savedNotice) {
          if (
            !failureNotice.clientMetadataKey.trim() ||
            outboxItems.some((item) => item.outboxId === failureNotice.outboxId)
          ) {
            return invalid;
          }
          outboxItems.push({
            ...failureNotice,
            recipient,
            dedupeKey,
            status: "pending",
            workspaceId: null,
            channelId: null,
            threadTs: null,
            messageTs: null,
            attemptCount: 0,
            lastError: null,
            createdAt: nowIso,
            updatedAt: nowIso,
            deliveredAt: null,
          });
        }
      }
      Object.assign(receipt, {
        status,
        leaseEpoch: fence.leaseEpoch,
        evidenceJson: evidenceJson ?? null,
        error: error ?? null,
        updatedAt: nowIso,
        completedAt: ["pending", "running", "retryable_failure"].includes(
          status,
        )
          ? null
          : nowIso,
      });
      if (
        stage === "learning_record" &&
        status === "succeeded" &&
        linkedRunId !== undefined
      ) {
        row.linkedRunId = linkedRunId;
      }
      row.status = deriveHarvestTerminalStatus({
        terminalEvent: row.terminalEvent,
        phaseIds: [...new Set(planned.map((entry) => entry.phaseKey))],
        stages: planned,
      });
      row.updatedAt = nowIso;
      row.completedAt = resumableHarvests.includes(row.status) ? null : nowIso;
      return result;
    },
    getOutboxItem(outboxId) {
      return structuredClone(
        outboxItems.find((item) => item.outboxId === outboxId) ?? null,
      );
    },
    listRecoverableOutboxItems({ projectId, nowIso }) {
      // The fixture treats a send as abandoned after one minute.
      return outboxItems
        .filter((row) => row.projectId === projectId)
        .filter(
          (row) =>
            row.status === "pending" ||
            row.status === "uncertain" ||
            (row.status === "sending" &&
              Date.parse(nowIso) - Date.parse(row.updatedAt) >= 60_000),
        )
        .sort(byCreation);
    },
    claimOutboxItem({ outboxId, nowIso, destination }) {
      const candidate = outboxItems.find((row) => row.outboxId === outboxId);
      if (!candidate) return null;
      const row = store
        .listRecoverableOutboxItems({ projectId: candidate.projectId, nowIso })
        .find((row) => row.outboxId === outboxId);
      if (!row) return null;
      const action = row.status === "pending" ? "send" : "reconcile";
      let route = {
        workspaceId: row.workspaceId,
        channelId: row.channelId,
        threadTs: row.threadTs,
      };
      if (action === "send") {
        if (row.eventType === "harvest_gate_failed") {
          if (!isHarvestSlackRecipient(row.recipient)) return null;
          route = {
            workspaceId: row.recipient.workspaceId,
            channelId: row.recipient.channelId,
            threadTs: row.recipient.threadTs ?? null,
          };
        } else {
          if (destination === null) {
            row.status = "skipped_no_target";
            row.updatedAt = nowIso;
            return { action: "skipped_no_target", item: { ...row } };
          }
          route = destination;
        }
      }
      const { workspaceId, channelId, threadTs } = route;
      if (
        !workspaceId?.trim() ||
        !channelId?.trim() ||
        !row.clientMetadataKey.trim()
      ) {
        return null;
      }
      Object.assign(row, route);
      row.status = "sending";
      row.updatedAt = nowIso;
      row.attemptCount += 1;
      return {
        claim: {
          outboxId,
          attemptNumber: row.attemptCount,
          clientMetadataKey: row.clientMetadataKey,
        },
        item: { ...row, workspaceId, channelId, threadTs },
        action,
      };
    },
  };
  return Object.assign(store, {
    snapshot: () =>
      structuredClone({
        dispatches,
        featureThreads,
        slackBindings,
        harvests,
        stages,
        outboxItems,
      }),
  });
}

describe("durable recovery store contract", () => {
  it.each(["running", "completed"] as const)(
    "reads the latest persisted %s dispatch across task scopes after restart",
    (status) => {
      const dispatches = [["T001"], ["T002"]].map((taskIds, index) => {
        const accepted = evaluateDispatchAcceptance({
          projectId,
          featureId,
          phaseId,
          backend: "test-worker",
          trunkBranch: "develop",
          taskIds,
          newOperationId: `dispatch-${index}`,
          nowIso: createdAt,
          existingActive: null,
        });
        if (accepted.kind !== "create_new")
          throw new Error("Expected new dispatch");
        return accepted.operation;
      });
      const [older, latest] = dispatches;
      const operation: DurableDispatchOperation = {
        ...latest,
        status,
        createdAt: nowIso,
        updatedAt: nowIso,
        attemptCount: 1,
        leaseEpoch: 1,
        leaseOwner: status === "running" ? "worker" : null,
        leaseExpiresAt: status === "running" ? leaseExpiresAt : null,
        completedAt: status === "completed" ? nowIso : null,
      };
      const lookup = { projectId, featureId, phaseId };
      const store = restoreRecoveryStore({
        dispatches: [
          { ...older, updatedAt: leaseExpiresAt },
          { ...operation, operationId: "dispatch-0-tie" },
          {
            ...operation,
            operationId: "other-project",
            projectId: "project-b",
          },
          { ...operation, operationId: "other-feature", featureId: "other" },
          { ...operation, operationId: "other-phase", phaseId: "phase-02" },
          operation,
        ],
        harvests: [],
        stages: [],
        outboxItems: [],
      });

      expect(store.getDispatchOperation(lookup)).toEqual(operation);
      expect(
        store.getDispatchOperation({ ...lookup, projectId: "missing" }),
      ).toBeNull();
    },
  );

  it("discovers and claims harvests from durable rows without intake receipts", () => {
    const store = restoreRecoveryStore({
      harvests: [
        harvest("resumable", {
          status: "running",
          leaseOwner: "old-worker",
          leaseEpoch: 1,
          leaseExpiresAt: nowIso,
          createdAt: "2026-11-11T11:59:00.000Z",
        }),
        harvest("live", {
          status: "running",
          leaseOwner: "worker",
          leaseExpiresAt,
        }),
        harvest("complete", { status: "completed", completedAt: createdAt }),
        harvest("unstarted"),
        harvest("other", { projectId: "project-b" }),
      ],
      stages: [
        {
          operationId: "resumable",
          phaseKey: phaseId,
          stage: "git_sync",
          status: "succeeded",
          leaseEpoch: 1,
          attemptCount: 1,
          evidenceJson: null,
          error: null,
          updatedAt: createdAt,
          completedAt: createdAt,
        },
      ],
      outboxItems: [],
    });
    expect(store.listRecoverableHarvests({ nowIso })).toHaveLength(3);
    const candidates = store.listRecoverableHarvests({ nowIso, projectId });
    expect(candidates.map((row) => row.operationId)).toEqual([
      "unstarted",
      "resumable",
    ]);
    const claims = candidates.map(({ operationId }) => ({
      operationId,
      leaseOwner: "new-worker",
      nowIso,
      leaseExpiresAt,
    }));
    expect(store.claimHarvestLease(claims[0])).toMatchObject({
      operation: { status: "accepted", headRepoSlug: "acme/a" },
      fence: { leaseEpoch: 1 },
      stages: [],
    });
    expect(store.claimHarvestLease(claims[1])).toMatchObject({
      fence: { leaseEpoch: 2 },
      stages: [{ stage: "git_sync", status: "succeeded" }],
    });
    expect(claims.map((claim) => store.claimHarvestLease(claim))).toEqual([
      null,
      null,
    ]);
  });

  it("renews a live harvest lease and fences the old epoch after takeover", () => {
    const store = restoreRecoveryStore({
      harvests: [harvest("interrupted")],
      stages: [],
      outboxItems: [],
    });
    const [candidate] = store.listRecoverableHarvests({ projectId, nowIso });
    const claimInput = {
      operationId: candidate.operationId,
      leaseOwner: "worker",
      nowIso,
      leaseExpiresAt,
    };
    const claim = store.claimHarvestLease(claimInput);
    if (!claim) throw new Error("Expected a harvest lease");

    const renewedUntil = "2026-11-11T12:02:00.000Z";
    expect(
      store.heartbeatHarvestLease({
        fence: claim.fence,
        nowIso: "2026-11-11T12:00:30.000Z",
        leaseExpiresAt: renewedUntil,
      }),
    ).toEqual({ ok: true });
    expect(
      store.listRecoverableHarvests({ projectId, nowIso: leaseExpiresAt }),
    ).toEqual([]);

    const rejectedRenewal = {
      fence: claim.fence,
      nowIso: renewedUntil,
      leaseExpiresAt: "2026-11-11T12:03:00.000Z",
    };
    expect(store.heartbeatHarvestLease(rejectedRenewal)).toEqual({
      ok: false,
      code: "LEASE_EXPIRED",
    });
    expect(
      store.listRecoverableHarvests({ projectId, nowIso: renewedUntil }),
    ).toMatchObject([
      { leaseEpoch: claim.fence.leaseEpoch, leaseExpiresAt: renewedUntil },
    ]);

    const takeover = store.claimHarvestLease({
      ...claimInput,
      nowIso: renewedUntil,
      leaseExpiresAt: rejectedRenewal.leaseExpiresAt,
    });
    expect(takeover?.fence).toEqual({
      ...claim.fence,
      leaseEpoch: claim.fence.leaseEpoch + 1,
    });
    expect(store.heartbeatHarvestLease(rejectedRenewal)).toEqual({
      ok: false,
      code: "LEASE_FENCED",
    });
  });

  it.each([true, false])(
    "reuses phase receipts for a whole-feature manual harvest after PR first: %s",
    (prFirst) => {
      const manual = harvestIntake("manual", {
        ...verifiedOffline,
        phaseId: null,
      });
      const children = scopeManualHarvestToPhases(manual.candidate, [
        "phase-1",
        "phase-02",
        "phase-01",
      ]);
      expect(children.map(({ explicitPhaseId }) => explicitPhaseId)).toEqual([
        phaseId,
        "phase-02",
      ]);
      const inputs = children.map((candidate) => ({
        ...harvestIntake(candidate.deliveryId, {
          ...verifiedOffline,
          phaseId: candidate.explicitPhaseId,
        }),
        candidate,
      }));
      const pull = harvestIntake("verified-pull");
      const first = prFirst ? pull : inputs[0];
      const overlapping = prFirst ? inputs[0] : pull;
      if (!first.target.accepted) throw new Error("Expected initial intake");
      const [original] = first.target.operations;
      const recordLearning = vi.fn((operation: DurableHarvestOperation) => ({
        ...learningReceipt(operation.operationId),
        phaseKey: operation.phaseId ?? "feature",
      }));
      const stage = recordLearning(original);
      const resumed = restoreHarvestIntake({
        harvests: [original],
        stages: [stage],
      });
      expect(resumed.store.recordHarvestIntake(overlapping)).toMatchObject({
        deduplicatedWork: true,
        operations: [{ operationId: original.operationId }],
      });
      expect(resumed.store.recordHarvestIntake(inputs[1])).toMatchObject({
        deduplicatedWork: false,
        operations: [{ phaseId: "phase-02" }],
      });
      const persisted = resumed.snapshot();
      expect(persisted.harvests.map(({ phaseId }) => phaseId)).toEqual([
        phaseId,
        "phase-02",
      ]);
      expect(persisted.stages).toEqual([stage]);

      const replay = restoreHarvestIntake(persisted).store;
      for (const intake of [pull, ...inputs]) {
        const result = replay.recordHarvestIntake(intake);
        if (!result.ok || !result.operations.length)
          throw new Error("Expected replay");
        const [operation] = result.operations;
        const receipt = persisted.stages.find(
          ({ operationId, phaseKey }) =>
            operationId === operation.operationId &&
            phaseKey === operation.phaseId,
        );
        if (!receipt) persisted.stages.push(recordLearning(operation));
      }
      expect(recordLearning.mock.calls.map(([row]) => row.phaseId)).toEqual([
        phaseId,
        "phase-02",
      ]);
    },
  );

  it("persists a complete phase plan before work and preserves progress after takeover", () => {
    const store = restoreRecoveryStore({
      slackBindings: {
        [projectId]: {
          workspaceId: "W1",
          channelId: "C1",
          sharedChannel: false,
        },
      },
      harvests: [
        harvest("planned", {
          phaseId: null,
          headBranch: `feat/${featureId}`,
          recipient: outbox("notice", "pending").recipient,
        }),
      ],
      stages: [],
      outboxItems: [],
    });
    const claim = store.claimHarvestLease({
      operationId: "planned",
      leaseOwner: "first",
      nowIso,
      leaseExpiresAt,
    });
    if (!claim) throw new Error("Expected a harvest lease");
    const phaseIds = [phaseId, "phase-02"];
    const targets = { hasSlackTarget: true, hasRemoteBranchTarget: true };
    const plan = planHarvestStages({
      phaseIds,
      terminalEvent: "merged",
      ...targets,
    });
    const init = {
      fence: claim.fence,
      nowIso,
      phaseIds,
      ...targets,
      stages: plan,
    };
    const firstStage = {
      ...init,
      phaseKey: phaseId,
      stage: "git_sync" as const,
      status: "succeeded" as const,
    };
    expect(store.transitionHarvestStage(firstStage)).toEqual({
      ok: false,
      code: "HARVEST_STAGE_UNPLANNED",
    });
    for (const incompletePlan of [plan.slice(0, 5), plan.slice(0, -1)]) {
      expect(
        store.initializeHarvestStages({ ...init, stages: incompletePlan }),
      ).toEqual({ ok: false, code: "HARVEST_PLAN_CONFLICT" });
      expect(store.snapshot().stages).toEqual([]);
    }
    expect(store.initializeHarvestStages(init)).toEqual({ ok: true });
    const afterPlan = restoreRecoveryStore(store.snapshot());
    const later = "2026-11-11T12:02:00.000Z";
    const takeover = afterPlan.claimHarvestLease({
      operationId: "planned",
      leaseOwner: "second",
      nowIso: leaseExpiresAt,
      leaseExpiresAt: later,
    });
    if (!takeover) throw new Error("Expected takeover");
    expect(takeover.stages).toHaveLength(plan.length);
    expect(
      afterPlan.initializeHarvestStages({ ...init, nowIso: leaseExpiresAt }),
    ).toEqual({
      ok: false,
      code: "LEASE_FENCED",
    });
    const resumed = { fence: takeover.fence, nowIso: leaseExpiresAt };
    for (const { phaseKey, stage } of plan.filter(
      (entry) => entry.phaseKey === phaseId,
    )) {
      expect(
        afterPlan.transitionHarvestStage({
          ...resumed,
          phaseKey,
          stage,
          status: "succeeded",
        }),
      ).toEqual({ ok: true });
    }
    expect(afterPlan.initializeHarvestStages({ ...init, ...resumed })).toEqual({
      ok: true,
    });
    expect(
      afterPlan.initializeHarvestStages({
        ...init,
        ...resumed,
        stages: plan.slice(0, 5),
      }),
    ).toEqual({
      ok: false,
      code: "HARVEST_PLAN_CONFLICT",
    });
    const restarted = restoreRecoveryStore(afterPlan.snapshot());
    const finalLeaseExpiry = "2026-11-11T12:03:00.000Z";
    const afterFirstPhase = restarted.claimHarvestLease({
      operationId: "planned",
      leaseOwner: "third",
      nowIso: later,
      leaseExpiresAt: finalLeaseExpiry,
    });
    if (!afterFirstPhase) throw new Error("Expected second takeover");
    expect(afterFirstPhase.operation).toMatchObject({
      status: "running",
      updatedAt: leaseExpiresAt,
      completedAt: null,
    });
    expect(
      afterFirstPhase.stages
        .filter((entry) => entry.status === "pending")
        .map((entry) => entry.phaseKey),
    ).toEqual(Array(5).fill("phase-02"));
    const finalWriteAt = "2026-11-11T12:02:30.000Z";
    for (const { phaseKey, stage } of afterFirstPhase.stages.filter(
      (entry) => entry.status === "pending",
    )) {
      expect(
        restarted.transitionHarvestStage({
          fence: afterFirstPhase.fence,
          nowIso: finalWriteAt,
          phaseKey,
          stage,
          status: "succeeded",
        }),
      ).toEqual({ ok: true });
    }
    const persisted = restarted.snapshot();
    expect(persisted.harvests[0]).toMatchObject({
      status: "completed",
      updatedAt: finalWriteAt,
      completedAt: finalWriteAt,
    });
    const completed = restoreRecoveryStore(persisted);
    expect(
      completed.listRecoverableHarvests({
        nowIso: finalLeaseExpiry,
        projectId,
      }),
    ).toEqual([]);
    expect(
      completed.claimHarvestLease({
        operationId: "planned",
        leaseOwner: "fourth",
        nowIso: finalLeaseExpiry,
        leaseExpiresAt: "2026-11-11T12:04:00.000Z",
      }),
    ).toBeNull();
  });

  it.each([
    ["gate_verify", "skipped_no_target"],
    ["gate_verify", "forecast_missing"],
    ["gate_verify", "uncertain"],
    ["gate_verify", "blocked_tip_mismatch"],
    ["git_sync", "gate_failed"],
  ] as const)(
    "rejects %s changing to %s and preserves the receipt after takeover",
    (stage, status) => {
      const store = restoreRecoveryStore({
        harvests: [harvest("planned")],
        stages: [],
        outboxItems: [],
      });
      const claim = store.claimHarvestLease({
        operationId: "planned",
        leaseOwner: "first",
        nowIso,
        leaseExpiresAt,
      });
      if (!claim) throw new Error("Expected a harvest lease");
      const plan = {
        terminalEvent: "merged" as const,
        phaseIds: [phaseId],
        hasSlackTarget: false,
        hasRemoteBranchTarget: true,
      };
      expect(
        store.initializeHarvestStages({
          ...plan,
          fence: claim.fence,
          nowIso,
          stages: planHarvestStages(plan),
        }),
      ).toEqual({ ok: true });
      const before = store.snapshot();
      expect(
        store.transitionHarvestStage({
          fence: claim.fence,
          nowIso,
          phaseKey: phaseId,
          stage,
          ...(status === "gate_failed"
            ? { status, failureNotice: null }
            : { status }),
        }),
      ).toEqual({ ok: false, code: "HARVEST_STAGE_TRANSITION_INVALID" });
      expect(store.snapshot()).toEqual(before);
      const resumed = restoreRecoveryStore(store.snapshot()).claimHarvestLease({
        operationId: "planned",
        leaseOwner: "second",
        nowIso: leaseExpiresAt,
        leaseExpiresAt: "2026-11-11T12:02:00.000Z",
      });
      expect(
        resumed?.stages.find((entry) => entry.stage === stage)?.status,
      ).toBe("pending");
    },
  );

  it.each(["gate_verify", "slack_delivery", "branch_cleanup"] as const)(
    "rejects an initial plan that skips %s when required",
    (skippedStage) => {
      const store = restoreRecoveryStore({
        slackBindings: {
          [projectId]: {
            workspaceId: "W1",
            channelId: "C1",
            sharedChannel: false,
          },
        },
        harvests: [
          harvest("planned", {
            recipient: outbox("notice", "pending").recipient,
          }),
        ],
        stages: [],
        outboxItems: [],
      });
      const claim = store.claimHarvestLease({
        operationId: "planned",
        leaseOwner: "worker",
        nowIso,
        leaseExpiresAt,
      });
      if (!claim) throw new Error("Expected a harvest lease");
      const targets = { hasSlackTarget: true, hasRemoteBranchTarget: true };
      const phaseIds = [phaseId];
      const plan = planHarvestStages({
        terminalEvent: "merged",
        phaseIds,
        ...targets,
      });
      const invalidPlan = plan.map((entry) =>
        entry.stage === skippedStage
          ? { ...entry, initialStatus: "skipped_no_target" as const }
          : entry,
      );
      expect(
        store.initializeHarvestStages({
          fence: claim.fence,
          nowIso,
          phaseIds,
          ...targets,
          stages: invalidPlan,
        }),
      ).toEqual({ ok: false, code: "HARVEST_PLAN_CONFLICT" });
      expect(store.snapshot().stages).toEqual([]);
    },
  );

  it("discovers project sends and claims abandoned or uncertain sends for reconciliation", () => {
    const store = restoreRecoveryStore({
      harvests: [],
      stages: [],
      outboxItems: [
        outbox("uncertain", "uncertain", { ...destination, createdAt: nowIso }),
        outbox("live", "sending", { ...destination, updatedAt: nowIso }),
        outbox("delivered", "delivered"),
        outbox("abandoned", "sending", {
          ...destination,
          createdAt: "2026-11-11T11:59:00.000Z",
        }),
        outbox("other", "pending", { projectId: "project-b" }),
        outbox("pending", "pending"),
      ],
    });
    const candidates = store.listRecoverableOutboxItems({ nowIso, projectId });
    expect(candidates.map((row) => row.outboxId)).toEqual([
      "pending",
      "abandoned",
      "uncertain",
    ]);
    const claims = candidates.map(({ outboxId }) => ({
      outboxId,
      nowIso,
      destination,
    }));
    expect(claims.map((claim) => store.claimOutboxItem(claim)?.action)).toEqual(
      ["send", "reconcile", "reconcile"],
    );
    expect(store.listRecoverableOutboxItems({ nowIso, projectId })).toEqual([]);
    expect(claims.map((claim) => store.claimOutboxItem(claim))).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("resolves a pending delivery by ID before claiming its destination", () => {
    const outboxId = "resumed-notification";
    const store = restoreRecoveryStore({
      harvests: [],
      stages: [],
      outboxItems: [outbox(outboxId, "pending")],
    });
    const pending = store.getOutboxItem(outboxId);
    expect(pending).toMatchObject({
      projectId,
      featureId,
      status: "pending",
      recipient: { channelId: "C1", threadTs: "1.2" },
    });
    if (!pending) throw new Error("Expected an outbox item");
    const featureThreads = new Map([
      [`${projectId}/${featureId}`, destination],
    ]);
    const resolved = featureThreads.get(
      `${pending.projectId}/${pending.featureId}`,
    );
    expect(resolved).toEqual(destination);
    expect(store.getOutboxItem(outboxId)).toMatchObject({
      status: "pending",
      attemptCount: 0,
    });
    expect(
      store.claimOutboxItem({
        outboxId,
        nowIso,
        destination: resolved ?? null,
      }),
    ).toMatchObject({
      action: "send",
      item: { ...destination, status: "sending" },
    });
    expect(store.getOutboxItem("missing")).toBeNull();
  });

  it("persists a no-target claim across restart without retrying delivery", () => {
    const pending = outbox("no-target", "pending");
    const store = restoreRecoveryStore({
      harvests: [],
      stages: [],
      outboxItems: [pending],
    });
    expect(
      store.claimOutboxItem({
        outboxId: pending.outboxId,
        nowIso,
        destination: null,
      }),
    ).toEqual({
      action: "skipped_no_target",
      item: { ...pending, status: "skipped_no_target", updatedAt: nowIso },
    });

    const restarted = restoreRecoveryStore(store.snapshot());
    expect(restarted.getOutboxItem(pending.outboxId)).toMatchObject({
      status: "skipped_no_target",
      attemptCount: 0,
    });
    expect(
      restarted.listRecoverableOutboxItems({
        nowIso: leaseExpiresAt,
        projectId,
      }),
    ).toEqual([]);
    expect(
      restarted.claimOutboxItem({
        outboxId: pending.outboxId,
        nowIso: leaseExpiresAt,
        destination,
      }),
    ).toBeNull();
  });

  it.each([
    ["pending", { clientMetadataKey: "" }],
    ["uncertain", { ...destination, workspaceId: null }],
    ["sending", { ...destination, channelId: null }],
    ["uncertain", { ...destination, clientMetadataKey: "" }],
  ] as const)(
    "rejects a %s outbox claim with missing delivery facts",
    (status, overrides) => {
      const item = outbox("incomplete-delivery", status, overrides);
      const store = restoreRecoveryStore({
        harvests: [],
        stages: [],
        outboxItems: [item],
      });
      expect(
        store.claimOutboxItem({
          outboxId: item.outboxId,
          nowIso: leaseExpiresAt,
          destination,
        }),
      ).toBeNull();
      expect(store.snapshot().outboxItems).toEqual([item]);
    },
  );

  it("reconciles at the persisted destination after the feature thread changes", () => {
    const store = restoreRecoveryStore({
      harvests: [],
      stages: [],
      outboxItems: [outbox("notification", "pending")],
    });
    const [pending] = store.listRecoverableOutboxItems({ nowIso, projectId });
    const send = store.claimOutboxItem({
      outboxId: pending.outboxId,
      nowIso,
      destination,
    });
    expect(send).toMatchObject({ action: "send", item: destination });
    if (!send) throw new Error("Expected a send claim");
    const deliveryKey = ({
      workspaceId,
      channelId,
      threadTs,
      clientMetadataKey,
    }: OutboxItem) =>
      JSON.stringify([workspaceId, channelId, threadTs, clientMetadataKey]);
    const providerMessages = new Map([[deliveryKey(send.item), "message-1"]]);

    const restartAt = leaseExpiresAt;
    const restarted = restoreRecoveryStore({
      harvests: [],
      stages: [],
      outboxItems: store.listRecoverableOutboxItems({
        nowIso: restartAt,
        projectId,
      }),
    });
    const [abandoned] = restarted.listRecoverableOutboxItems({
      nowIso: restartAt,
      projectId,
    });
    expect(abandoned).toMatchObject({ status: "sending", messageTs: null });
    const changedDestination = {
      workspaceId: "W2",
      channelId: "C3",
      threadTs: "3.1",
    };
    const recovery = restarted.claimOutboxItem({
      outboxId: abandoned.outboxId,
      nowIso: restartAt,
      destination: changedDestination,
    });
    expect(recovery).toMatchObject({
      action: "reconcile",
      claim: { clientMetadataKey: pending.clientMetadataKey },
      item: destination,
    });
    if (!recovery) throw new Error("Expected a reconciliation claim");
    expect(providerMessages.get(deliveryKey(recovery.item))).toBe("message-1");
  });
});

describe("persisted harvest intake contract", () => {
  it.each([true, false])(
    "checks verified checkout identity on local delivery replay accepted=%s",
    (accepted) => {
      const deliveryId = "local-checkout-replay";
      const request = (checkoutRepoSlug: string | null) => {
        const intake = harvestIntake(deliveryId, {
          ...offline,
          repoSlug: checkoutRepoSlug,
          checkoutRepoSlug,
          phaseId: accepted ? phaseId : null,
        });
        if (!intake.target.accepted) throw new Error("Expected local target");
        return {
          ...intake,
          candidate: { ...intake.candidate, repoSlug: null },
          target: accepted
            ? intake.target
            : { accepted: false as const, projectId, reason: "No coverage" },
        };
      };
      const original = request("ACME/A");
      const initial = restoreHarvestIntake({ harvests: [], stages: [] });
      const result = initial.store.recordHarvestIntake(original);
      if (!result.ok) throw new Error("Expected original delivery to persist");
      const saved = initial.snapshot();
      const reopened = restoreHarvestIntake(saved);
      for (const checkoutRepoSlug of ["acme/b", null]) {
        expect(
          reopened.store.recordHarvestIntake(request(checkoutRepoSlug)),
        ).toEqual({
          ok: false,
          code: "DELIVERY_ID_CONFLICT",
        });
        expect(reopened.snapshot()).toEqual(saved);
      }
      expect(
        reopened.store.recordHarvestIntake(request("acme/a")),
      ).toMatchObject({
        ok: true,
        deduplicatedTransport: true,
        operations: result.operations,
      });
    },
  );

  it.each<HarvestIntakeFacts>([
    { expectedHeadSha: "b".repeat(40) },
    { headRepoSlug: "fork/a" },
    { headBranch: `phase/${featureId}` },
  ])("rolls back intake on conflicting verified head facts %o", (conflict) => {
    const phaseIds = ["phase-01", "phase-02"];
    const facts = {
      phaseId: null,
      headBranch: `feat/${featureId}`,
      expectedHeadSha: "a".repeat(40),
    };
    const original = harvestIntake(
      "original-merge",
      { ...facts, headRepoSlug: null, expectedHeadSha: null },
      "github_webhook",
      phaseIds,
    );
    const phaseTwoEvidence = harvestIntake(
      "verify-phase-two",
      { ...facts, phaseId: "phase-02" },
      "manual_cli",
      phaseIds,
    );
    const poll = harvestIntake(
      "poll-merge",
      { ...facts, ...conflict },
      "github_poller",
      phaseIds,
    );
    const initial = restoreHarvestIntake({ harvests: [], stages: [] });
    const accepted = initial.store.recordHarvestIntake(original);
    if (!accepted.ok) throw new Error("Expected original merge");
    expect(initial.store.recordHarvestIntake(phaseTwoEvidence)).toMatchObject({
      ok: true,
      deduplicatedWork: true,
    });
    const reopened = restoreHarvestIntake({
      ...initial.snapshot(),
      stages: accepted.operations.map(({ operationId, phaseId }) => ({
        ...learningReceipt(operationId),
        phaseKey: phaseId ?? "feature",
      })),
    });
    const saved = reopened.snapshot();
    expect(
      saved.harvests.map(({ expectedHeadSha }) => expectedHeadSha),
    ).toEqual([null, facts.expectedHeadSha]);
    expect(reopened.store.recordHarvestIntake(poll)).toEqual({
      ok: false,
      code: "HARVEST_IDENTITY_MISMATCH",
    });
    expect(reopened.snapshot()).toEqual(saved);
    expect(reopened.store.recordHarvestIntake(original)).toMatchObject({
      ok: true,
      deduplicatedTransport: true,
      operations: saved.harvests,
    });
  });

  it.each([true, false])(
    "checks the resolved project before replaying a repository-less delivery accepted=%s",
    (accepted) => {
      const deliveryId = "shared-manual-delivery";
      const owner = harvestIntake(deliveryId, { ...offline, projectId });
      const foreignId = "project-b";
      const foreign = harvestIntake(deliveryId, {
        ...offline,
        projectId: foreignId,
      });
      const requests: [HarvestIntake, HarvestIntake] = accepted
        ? [owner, foreign]
        : [
            {
              ...owner,
              target: { accepted: false, projectId, reason: "No coverage" },
            },
            {
              ...foreign,
              target: {
                accepted: false,
                projectId: foreignId,
                reason: "No coverage",
              },
            },
          ];
      expect(requests[0].candidate).toEqual(requests[1].candidate);
      expect(requests[0].candidate.repoSlug).toBeNull();
      const initial = restoreHarvestIntake({ harvests: [], stages: [] });
      const result = initial.store.recordHarvestIntake(requests[0]);
      if (!result.ok) throw new Error("Expected original delivery to persist");
      const saved = initial.snapshot();
      const reopened = restoreHarvestIntake(saved);
      expect(reopened.store.recordHarvestIntake(requests[1])).toEqual({
        ok: false,
        code: "DELIVERY_ID_CONFLICT",
      });
      expect(reopened.snapshot()).toEqual(saved);
      expect(reopened.store.recordHarvestIntake(requests[0])).toMatchObject({
        ok: true,
        deduplicatedTransport: true,
        operations: result.operations,
      });
    },
  );

  it.each(["local", "pull request"])(
    "keeps an unknown checkout separate across restart when %s arrives first",
    (firstSource) => {
      const local = harvestIntake("unknown-checkout", offline);
      const pull = harvestIntake("verified-pull");
      const [first, second] =
        firstSource === "local" ? [local, pull] : [pull, local];
      const initial = restoreHarvestIntake({ harvests: [], stages: [] });
      expect(initial.store.recordHarvestIntake(first)).toMatchObject({
        ok: true,
      });
      const restarted = restoreHarvestIntake(initial.snapshot());
      expect(restarted.store.recordHarvestIntake(second)).toMatchObject({
        ok: true,
        deduplicatedWork: false,
      });
      const saved = restarted.snapshot();
      expect(saved.harvests).toHaveLength(2);
      expect(saved.aliases).toEqual([]);
      const replay = restoreHarvestIntake(saved).store;
      expect(replay.recordHarvestIntake(local)).toMatchObject({
        ok: true,
        deduplicatedTransport: true,
        operations: [{ operationId: "unknown-checkout", repoSlug: null }],
      });
      expect(replay.recordHarvestIntake(pull)).toMatchObject({
        ok: true,
        deduplicatedTransport: true,
        operations: [{ operationId: "verified-pull", repoSlug: "acme/a" }],
      });
    },
  );

  it("rejects an enrolled repository substituted for unknown checkout evidence", () => {
    const local = harvestIntake("unknown-checkout", offline);
    if (!local.target.accepted) throw new Error("Expected local intake");
    const [operation] = local.target.operations;
    const initial = restoreHarvestIntake({ harvests: [], stages: [] });
    const before = initial.snapshot();
    expect(
      initial.store.recordHarvestIntake({
        ...local,
        target: {
          ...local.target,
          operations: [{ ...operation, repoSlug: "acme/a" }],
        },
      }),
    ).toEqual({ ok: false, code: "HARVEST_IDENTITY_MISMATCH" });
    expect(initial.snapshot()).toEqual(before);
  });

  it("rejects an accepted unscoped manual batch without checkout coverage", () => {
    const local = harvestIntake("missing-coverage", {
      ...offline,
      phaseId: null,
    });
    const initial = restoreHarvestIntake({ harvests: [], stages: [] });
    const before = initial.snapshot();
    expect(initial.store.recordHarvestIntake(local)).toEqual({
      ok: false,
      code: "HARVEST_IDENTITY_MISMATCH",
    });
    expect(initial.snapshot()).toEqual(before);
  });

  it("rejects duplicate operation IDs for distinct verified phases before writing", () => {
    const valid = wholeFeatureMergeIntake("verified-merge", 42, [
      "phase-01",
      "phase-02",
    ]);
    if (!valid.target.accepted) throw new Error("Expected verified intake");
    const [first, second] = valid.target.operations;
    const initial = restoreHarvestIntake({ harvests: [], stages: [] });
    const empty = initial.snapshot();
    expect(
      initial.store.recordHarvestIntake({
        ...valid,
        target: {
          ...valid.target,
          operations: [first, { ...second, operationId: first.operationId }],
        },
      }),
    ).toEqual({ ok: false, code: "HARVEST_IDENTITY_MISMATCH" });
    expect(initial.snapshot()).toEqual(empty);
    const restarted = restoreHarvestIntake(empty);
    expect(restarted.store.recordHarvestIntake(valid)).toMatchObject({
      ok: true,
      operations: [
        { phaseId: "phase-01", operationId: first.operationId },
        { phaseId: "phase-02", operationId: second.operationId },
      ],
    });
    expect(
      restoreHarvestIntake(restarted.snapshot()).store.recordHarvestIntake(
        valid,
      ),
    ).toMatchObject({
      ok: true,
      deduplicatedTransport: true,
      operations: [{ phaseId: "phase-01" }, { phaseId: "phase-02" }],
    });
  });

  it("rolls back harvest intake when a new phase reuses another project's operation ID", () => {
    const original = harvestIntake("project-a-pull-42");
    const local = harvestIntake("project-b-local", {
      ...verifiedOffline,
      projectId: "project-b",
    });
    const verified = harvestIntake(
      "project-b-pull-43",
      {
        projectId: "project-b",
        prNumber: 43,
        prUrl: "https://github.com/acme/a/pull/43",
        phaseId: null,
        headBranch: `feat/${featureId}`,
      },
      "github_webhook",
      ["phase-01", "phase-02"],
    );
    if (!verified.target.accepted) throw new Error("Expected verified intake");
    const [first, second] = verified.target.operations;
    const initial = restoreHarvestIntake({ harvests: [], stages: [] });
    const accepted = initial.store.recordHarvestIntake(original);
    if (!accepted.ok) throw new Error("Expected original intake");
    const [originalOperation] = accepted.operations;
    expect(initial.store.recordHarvestIntake(local)).toMatchObject({
      ok: true,
    });
    const restarted = restoreHarvestIntake({
      ...initial.snapshot(),
      stages: [
        learningReceipt(originalOperation.operationId),
        learningReceipt("project-b-local"),
      ],
    });
    const before = restarted.snapshot();

    expect(
      restarted.store.recordHarvestIntake({
        ...verified,
        target: {
          ...verified.target,
          operations: [
            first,
            { ...second, operationId: originalOperation.operationId },
          ],
        },
      }),
    ).toEqual({ ok: false, code: "HARVEST_IDENTITY_MISMATCH" });
    const saved = restarted.snapshot();
    expect(saved).toEqual(before);

    const replay = restoreHarvestIntake(saved).store;
    expect(replay.recordHarvestIntake(original)).toMatchObject({
      ok: true,
      deduplicatedTransport: true,
      operations: [originalOperation],
    });
    expect(
      replay.recordHarvestIntake({
        ...verified,
        target: {
          ...verified.target,
          operations: [
            { ...first, operationId: originalOperation.operationId },
            second,
          ],
        },
      }),
    ).toMatchObject({
      ok: true,
      deduplicatedTransport: false,
      operations: [
        {
          operationId: "project-b-local",
          projectId: "project-b",
          prNumber: 43,
        },
        {
          operationId: second.operationId,
          projectId: "project-b",
          prNumber: 43,
        },
      ],
    });
  });

  it.each<Partial<DurableHarvestOperation>>([
    { projectId: "unverified-project" },
    { repoSlug: "acme/other" },
    { trunkBranch: "main" },
    { prNumber: 43 },
    { terminalEvent: "closed_unmerged" },
    { mergeCommitSha: "b".repeat(40) },
    { featureId: "different-feature" },
    { phaseId: "phase-04" },
    { workKey: "forged-work-key" },
    { prUrl: "https://github.com/acme/other/pull/42" },
    { headRepoSlug: "acme/other" },
    { headBranch: "feat/different-feature" },
    { expectedHeadSha: "c".repeat(40) },
    { terminalAt: leaseExpiresAt },
    { status: "completed", completedAt: nowIso },
    { leaseEpoch: 1 },
    { leaseOwner: "worker" },
    { leaseExpiresAt },
    { completedAt: nowIso },
    { linkedRunId: 77 },
    { lastError: "forged error" },
    {
      plannedSlackRecipient: {
        projectId: "another-project",
        surface: "slack",
        workspaceId: "W9",
        channelId: "C9",
        threadTs: "9.9",
      },
    },
  ])("rejects substituted scope %o before any write", (substitution) => {
    const valid = wholeFeatureMergeIntake("verified-merge", 42, [
      "phase-01",
      "phase-02",
    ]);
    if (!valid.target.accepted) throw new Error("Expected verified intake");
    const [first, second] = valid.target.operations;
    const initial = restoreHarvestIntake({ harvests: [], stages: [] });

    expect(
      initial.store.recordHarvestIntake({
        ...valid,
        target: {
          ...valid.target,
          operations: [first, { ...second, ...substitution }],
        },
      }),
    ).toEqual({ ok: false, code: "HARVEST_IDENTITY_MISMATCH" });
    const saved = initial.snapshot();
    expect(saved.harvests).toEqual([]);
    expect(saved.deliveries).toEqual([]);
    expect(saved.aliases).toEqual([]);
    expect(
      restoreHarvestIntake(saved).store.recordHarvestIntake(valid),
    ).toMatchObject({
      ok: true,
      deduplicatedTransport: false,
      operations: [{ phaseId: "phase-01" }, { phaseId: "phase-02" }],
    });
  });

  it("persists the candidate recipient for new harvest operations", () => {
    const intake = harvestIntake("verified-pull");
    const recipient = outbox("notice", "pending").recipient;
    const initial = restoreHarvestIntake({ harvests: [], stages: [] });
    const delivery = {
      ...intake,
      candidate: { ...intake.candidate, recipient },
    };
    expect(initial.store.recordHarvestIntake(delivery)).toMatchObject({
      ok: true,
      deduplicatedWork: false,
    });
    const restarted = restoreHarvestIntake(initial.snapshot());
    expect(restarted.store.recordHarvestIntake(delivery)).toMatchObject({
      ok: true,
      deduplicatedTransport: true,
      operations: [{ recipient, plannedSlackRecipient: null }],
    });
  });

  it.each([
    { localRepoSlug: "acme/a", repoSlug: "acme/b", trunkBranch: "develop" },
    { localRepoSlug: null, repoSlug: "acme/b", trunkBranch: "develop" },
    { localRepoSlug: "acme/a", repoSlug: "acme/a", trunkBranch: "main" },
  ])(
    "keeps local work with delivery repository $localRepoSlug separate from $repoSlug $trunkBranch",
    ({ localRepoSlug, repoSlug, trunkBranch }) => {
      const local = harvestIntake("local-scope", {
        ...verifiedOffline,
        repoSlug: localRepoSlug,
      });
      const pull = harvestIntake("pull-scope", {
        repoSlug,
        trunkBranch,
        prUrl: `https://github.com/${repoSlug}/pull/42`,
      });
      for (const [first, second] of [
        [local, pull],
        [pull, local],
      ]) {
        const store = restoreHarvestIntake({ harvests: [], stages: [] });
        store.store.recordHarvestIntake(first);
        const restarted = restoreHarvestIntake(store.snapshot());
        expect(restarted.store.recordHarvestIntake(second)).toMatchObject({
          ok: true,
          deduplicatedWork: false,
          operations: [{ operationId: second.candidate.deliveryId }],
        });
        const saved = restarted.snapshot();
        expect(saved.harvests).toHaveLength(2);
        expect(saved.harvests).toContainEqual(
          expect.objectContaining({
            operationId: "local-scope",
            repoSlug: "acme/a",
          }),
        );
        expect(saved.aliases).toEqual([]);
        const replay = restoreHarvestIntake(saved).store;
        for (const intake of [first, second]) {
          expect(replay.recordHarvestIntake(intake)).toMatchObject({
            ok: true,
            deduplicatedTransport: true,
            operations: [{ operationId: intake.candidate.deliveryId }],
          });
        }
      }
    },
  );

  it("records an unscoped manual delivery with no checkout phases", () => {
    const manual = harvestIntake("manual-empty", {
      ...offline,
      phaseId: null,
    });
    const scopes = scopeManualHarvestToPhases(manual.candidate, []);
    const intake: HarvestIntake = {
      ...manual,
      target: scopes.length
        ? manual.target
        : { accepted: false, projectId, reason: "No phases at checkout" },
    };
    const initial = restoreHarvestIntake({ harvests: [], stages: [] });
    expect(initial.store.recordHarvestIntake(intake)).toMatchObject({
      ok: true,
      operations: [],
    });
    const saved = initial.snapshot();
    expect(saved.harvests).toEqual([]);
    expect(saved.stages).toEqual([]);
    expect(
      restoreRecoveryStore(saved).listRecoverableHarvests({
        projectId,
        nowIso,
      }),
    ).toEqual([]);
    expect(
      restoreHarvestIntake(saved).store.recordHarvestIntake(intake),
    ).toMatchObject({ ok: true, operations: [], deduplicatedTransport: true });
  });

  it.each([
    ["phase", "develop"],
    ["whole feature", "develop"],
    ["phase", "main"],
    ["whole feature", "main"],
  ] as const)(
    "keeps a verified %s merge on a later stale close targeting %s",
    (scope, trunkBranch) => {
      const merge =
        scope === "phase"
          ? harvestIntake("merge")
          : wholeFeatureMergeIntake("merge", 42, ["phase-01", "phase-02"]);
      const closed = {
        terminalEvent: "closed_unmerged" as const,
        mergeCommitSha: null,
        trunkBranch,
      };
      const stale = harvestIntake(
        "stale",
        scope === "phase"
          ? closed
          : { ...closed, phaseId: null, headBranch: `feat/${featureId}` },
        "github_poller",
      );
      const anotherRepository = harvestIntake("other-repo", {
        ...closed,
        repoSlug: "acme/b",
        prUrl: "https://github.com/acme/b/pull/42",
      });
      const anotherProject = harvestIntake("other-project", {
        ...closed,
        projectId: "project-b",
      });
      const initial = restoreHarvestIntake({ harvests: [], stages: [] });
      const merged = initial.store.recordHarvestIntake(merge);
      if (!merged.ok) throw new Error("Expected a recorded merge");
      const prior = {
        ...initial.snapshot(),
        stages: merged.operations.map((operation) => ({
          ...learningReceipt(operation.operationId),
          phaseKey: operation.phaseId ?? phaseId,
        })),
      };
      const resumed = restoreHarvestIntake(prior);
      const result = resumed.store.recordHarvestIntake(stale);

      expect(result).toMatchObject({
        ok: true,
        operations: [merged.operations[0]],
        deduplicatedWork: true,
      });
      const saved = resumed.snapshot();
      expect(saved.harvests).toEqual(prior.harvests);
      expect(saved.stages).toEqual(prior.stages);
      expect(saved.aliases).toEqual(prior.aliases);
      const replay = restoreHarvestIntake(saved).store;
      expect(replay.recordHarvestIntake(stale)).toEqual({
        ...result,
        deduplicatedTransport: true,
      });
      for (const independent of [anotherRepository, anotherProject]) {
        expect(replay.recordHarvestIntake(independent)).toMatchObject({
          ok: true,
          operations: [{ terminalEvent: "closed_unmerged" }],
          deduplicatedWork: false,
        });
      }
    },
  );

  it.each(["github_webhook", "github_poller"] as const)(
    "rejects a whole-feature %s merge without checkout coverage",
    (source) => {
      const intake = wholeFeatureMergeIntake("empty-coverage", 42, [], source);
      const initial = restoreHarvestIntake({ harvests: [], stages: [] });
      expect(initial.store.recordHarvestIntake(intake)).toMatchObject({
        ok: true,
        operations: [],
      });
      const persisted = initial.snapshot();
      expect(persisted.harvests).toEqual([]);
      expect(persisted.deliveries[0].operationIds).toEqual([]);
      expect(
        restoreHarvestIntake(persisted).store.recordHarvestIntake(intake),
      ).toMatchObject({
        ok: true,
        operations: [],
        deduplicatedTransport: true,
      });
    },
  );

  it.each(["manual", "pull request"])(
    "reuses both covered phases when a whole-feature %s arrives first",
    (firstSource) => {
      const phaseIds = ["phase-1", "phase-02", "phase-01"];
      const local = harvestIntake("local-feature", {
        ...verifiedOffline,
        phaseId: null,
      });
      const localScopes = scopeManualHarvestToPhases(
        local.candidate,
        phaseIds,
      ).map((candidate) => {
        const scoped = harvestIntake(candidate.deliveryId, {
          ...verifiedOffline,
          phaseId: candidate.explicitPhaseId,
        });
        if (!scoped.target.accepted)
          throw new Error("Expected scoped local target");
        return scoped.target.operations[0];
      });
      if (!local.target.accepted) throw new Error("Expected local target");
      const manual = {
        ...local,
        target: {
          ...local.target,
          checkoutPhaseIds: phaseIds,
          operations: [localScopes[0], ...localScopes.slice(1)],
        },
      } satisfies HarvestIntake;
      const pull = wholeFeatureMergeIntake("pull-feature", 42, phaseIds);
      const [first, second] =
        firstSource === "manual" ? [manual, pull] : [pull, manual];
      const initial = restoreHarvestIntake({ harvests: [], stages: [] });
      const accepted = initial.store.recordHarvestIntake(first);
      if (!accepted.ok) throw new Error("Expected initial intake");
      expect(accepted.operations.map((row) => row.phaseId)).toEqual([
        phaseId,
        "phase-02",
      ]);

      const recordLearning = vi.fn((row: DurableHarvestOperation) => ({
        ...learningReceipt(row.operationId),
        phaseKey: row.phaseId ?? "feature",
      }));
      const receipts = accepted.operations.map(recordLearning);
      const resumed = restoreHarvestIntake({
        ...initial.snapshot(),
        stages: receipts,
      });
      const expected = accepted.operations.map(
        ({ operationId, workKey, phaseId }) => ({
          operationId,
          workKey,
          phaseId,
          prNumber: 42,
        }),
      );
      expect(resumed.store.recordHarvestIntake(second)).toMatchObject({
        ok: true,
        deduplicatedTransport: false,
        deduplicatedWork: true,
        operations: expected,
      });
      const persisted = resumed.snapshot();
      expect(persisted.harvests).toHaveLength(2);
      expect(persisted.stages).toEqual(receipts);
      expect(persisted.deliveries).toHaveLength(2);

      const replay = restoreHarvestIntake(persisted);
      for (const intake of [first, second]) {
        if (!intake.target.accepted)
          throw new Error("Expected accepted intake");
        const result = replay.store.recordHarvestIntake({
          ...intake,
          target: {
            ...intake.target,
            operations: [intake.target.operations[0]],
          },
        });
        expect(result).toMatchObject({
          ok: true,
          deduplicatedTransport: true,
          operations: expected,
        });
        if (!result.ok) throw new Error("Expected delivery replay");
        for (const row of result.operations) {
          if (
            !persisted.stages.some(
              (receipt) =>
                receipt.operationId === row.operationId &&
                receipt.phaseKey === row.phaseId,
            )
          ) {
            persisted.stages.push(recordLearning(row));
          }
        }
      }
      expect(recordLearning.mock.calls.map(([row]) => row.phaseId)).toEqual([
        phaseId,
        "phase-02",
      ]);

      expect(
        replay.store.recordHarvestIntake({
          ...pull,
          payloadDigest: "different",
        }),
      ).toEqual({ ok: false, code: "DELIVERY_ID_CONFLICT" });
      expect(replay.snapshot()).toEqual(persisted);
      expect(
        replay.store.recordHarvestIntake(
          harvestIntake("uncovered", {
            ...verifiedOffline,
            phaseId: "phase-03",
          }),
        ),
      ).toMatchObject({
        ok: true,
        deduplicatedWork: false,
        operations: [{ operationId: "uncovered", phaseId: "phase-03" }],
      });
      expect(
        replay.store.recordHarvestIntake(
          wholeFeatureMergeIntake("other-pull", 43, phaseIds),
        ),
      ).toMatchObject({
        ok: true,
        deduplicatedWork: false,
        operations: [
          { operationId: `other-pull-${phaseId}`, phaseId, prNumber: 43 },
          {
            operationId: "other-pull-phase-02",
            phaseId: "phase-02",
            prNumber: 43,
          },
        ],
      });
      expect(replay.snapshot().harvests).toHaveLength(5);
      expect(replay.snapshot().stages).toEqual(receipts);
    },
  );

  it.each(["local", "pull request"])(
    "preserves the first operation and receipts when %s arrives first",
    (firstSource) => {
      const local = harvestIntake("local", {
        ...verifiedOffline,
        mergeCommitSha: ` ${sha.toUpperCase()} `,
      });
      const pull = harvestIntake("pull");
      const [first, second] =
        firstSource === "local" ? [local, pull] : [pull, local];
      if (!first.target.accepted) throw new Error("Expected accepted intake");
      const [firstOperation] = first.target.operations;
      const receipt = learningReceipt(firstOperation.operationId);
      const restarted = restoreHarvestIntake({
        harvests: [firstOperation],
        stages: [receipt],
      });
      const result = restarted.store.recordHarvestIntake(second);
      const expected = {
        operationId: firstOperation.operationId,
        workKey: firstOperation.workKey,
        repoSlug: "acme/a",
        headRepoSlug: "acme/a",
        prNumber: 42,
        prUrl: "https://github.com/acme/a/pull/42",
        headBranch: `feat/${featureId}-${phaseId}`,
        expectedHeadSha: sha,
      };
      expect(result).toMatchObject({
        ok: true,
        deduplicatedWork: true,
        operations: [expected],
      });
      const persisted = restarted.snapshot();
      expect(persisted.harvests).toHaveLength(1);
      expect(persisted.stages).toEqual([receipt]);
      const replay = restoreHarvestIntake(persisted).store;
      for (const intake of [first, second]) {
        expect(replay.recordHarvestIntake(intake)).toMatchObject({
          ok: true,
          deduplicatedWork: true,
          operations: [expected],
        });
      }
    },
  );

  it.each([
    ["project", { projectId: "project-b" }],
    ["feature", { featureId: "other-feature" }],
    ["phase", { phaseId: "phase-02" }],
    ["commit", { mergeCommitSha: "b".repeat(40) }],
  ] as const)("keeps different %s scopes separate", (_field, override) => {
    const local = harvestIntake("local", { ...verifiedOffline, ...override });
    if (!local.target.accepted)
      throw new Error("Expected accepted local intake");
    const restarted = restoreHarvestIntake({
      harvests: [...local.target.operations],
      stages: [],
    });
    expect(
      restarted.store.recordHarvestIntake(harvestIntake("pull")),
    ).toMatchObject({
      ok: true,
      deduplicatedWork: false,
      operations: [{ operationId: "pull" }],
    });
    expect(restarted.snapshot().harvests).toHaveLength(2);
  });

  it("keeps distinct verified pull requests at the same commit separate", () => {
    const first = harvestIntake("first-pull");
    if (!first.target.accepted)
      throw new Error("Expected accepted pull request");
    const restarted = restoreHarvestIntake({
      harvests: [...first.target.operations],
      stages: [],
    });
    expect(
      restarted.store.recordHarvestIntake(
        harvestIntake("local", verifiedOffline),
      ),
    ).toMatchObject({
      ok: true,
      deduplicatedWork: true,
      operations: [{ operationId: "first-pull" }],
    });
    const replay = restoreHarvestIntake(restarted.snapshot());
    expect(
      replay.store.recordHarvestIntake(
        harvestIntake("second-pull", {
          prNumber: 43,
          prUrl: "https://github.com/acme/a/pull/43",
        }),
      ),
    ).toMatchObject({
      ok: true,
      deduplicatedWork: false,
      operations: [{ operationId: "second-pull" }],
    });
    expect(replay.snapshot().harvests).toHaveLength(2);
  });
});

it("resumes a persisted retryable sync failure after lease expiry", () => {
  const secondPhase = "phase-02";
  const initial = restoreRecoveryStore({
    harvests: [
      harvest("retryable", { phaseId: null, headBranch: `feat/${featureId}` }),
    ],
    stages: [],
    outboxItems: [],
  });
  const first = initial.claimHarvestLease({
    operationId: "retryable",
    leaseOwner: "first",
    nowIso,
    leaseExpiresAt,
  });
  if (!first) throw new Error("Expected first lease");
  const plan = {
    terminalEvent: "merged" as const,
    phaseIds: [phaseId, secondPhase],
    hasSlackTarget: false,
    hasRemoteBranchTarget: true,
  };
  const stages = planHarvestStages(plan);
  expect(
    initial.initializeHarvestStages({
      ...plan,
      fence: first.fence,
      nowIso,
      stages,
    }),
  ).toEqual({ ok: true });
  for (const { phaseKey, stage } of stages.filter(
    (entry) => entry.phaseKey === phaseId && entry.initialStatus === "pending",
  )) {
    expect(
      initial.transitionHarvestStage({
        fence: first.fence,
        nowIso,
        phaseKey,
        stage,
        status: "succeeded",
      }),
    ).toEqual({ ok: true });
  }
  expect(
    initial.transitionHarvestStage({
      fence: first.fence,
      nowIso,
      phaseKey: secondPhase,
      stage: "git_sync",
      status: "retryable_failure",
      error: "transport timeout",
    }),
  ).toEqual({ ok: true });
  const restarted = restoreRecoveryStore(initial.snapshot());
  expect(restarted.listRecoverableHarvests({ nowIso })).toEqual([]);
  expect(restarted.listRecoverableHarvests({ nowIso: leaseExpiresAt })).toEqual(
    [
      expect.objectContaining({
        operationId: "retryable",
        status: "running",
        completedAt: null,
      }),
    ],
  );
  const next = restarted.claimHarvestLease({
    operationId: "retryable",
    leaseOwner: "second",
    nowIso: leaseExpiresAt,
    leaseExpiresAt: "2026-11-11T12:02:00.000Z",
  });
  expect(next?.fence.leaseEpoch).toBe(first.fence.leaseEpoch + 1);
  const firstPhaseReceipts = initial
    .snapshot()
    .stages.filter(({ phaseKey }) => phaseKey === phaseId);
  expect(next?.stages.filter(({ phaseKey }) => phaseKey === phaseId)).toEqual(
    firstPhaseReceipts,
  );
  expect(next?.stages).toContainEqual(
    expect.objectContaining({
      stage: "git_sync",
      phaseKey: secondPhase,
      status: "retryable_failure",
      error: "transport timeout",
      completedAt: null,
    }),
  );
  if (!next) throw new Error("Expected retry after lease expiry");
  for (const { phaseKey, stage } of next.stages.filter(
    (entry) =>
      entry.phaseKey === secondPhase && entry.status !== "skipped_no_target",
  )) {
    expect(
      restarted.transitionHarvestStage({
        fence: next.fence,
        nowIso: leaseExpiresAt,
        phaseKey,
        stage,
        status: "succeeded",
      }),
    ).toEqual({ ok: true });
  }
  expect(restarted.snapshot().harvests).toEqual([
    expect.objectContaining({
      status: "completed",
      completedAt: leaseExpiresAt,
    }),
  ]);
  expect(
    restarted.snapshot().stages.filter(({ phaseKey }) => phaseKey === phaseId),
  ).toEqual(firstPhaseReceipts);
});

it("rejects a stale cleanup skip when pull request evidence arrives after lease claim", () => {
  const local = harvestIntake("offline-claimed", verifiedOffline);
  if (!local.target.accepted) throw new Error("Expected offline operation");
  const initial = restoreRecoveryStore({
    harvests: [...local.target.operations],
    stages: [],
    outboxItems: [],
  });
  const claim = initial.claimHarvestLease({
    operationId: "offline-claimed",
    leaseOwner: "worker",
    nowIso,
    leaseExpiresAt,
  });
  if (!claim) throw new Error("Expected offline lease");
  const plan = {
    terminalEvent: "merged" as const,
    phaseIds: [phaseId],
    hasSlackTarget: false,
    hasRemoteBranchTarget: false,
  };
  const intake = restoreHarvestIntake(initial.snapshot());
  expect(
    intake.store.recordHarvestIntake(harvestIntake("verified-pull")),
  ).toMatchObject({
    ok: true,
    operations: [{ ...claim.fence, prNumber: 42, leaseExpiresAt }],
  });
  const persisted = intake.snapshot();
  const store = restoreRecoveryStore({ ...persisted, outboxItems: [] });
  const init = { ...plan, fence: claim.fence, nowIso };
  expect(
    store.initializeHarvestStages({
      ...init,
      stages: planHarvestStages(plan),
    }),
  ).toEqual({ ok: false, code: "HARVEST_PLAN_CONFLICT" });
  expect(store.snapshot().stages).toEqual([]);
  const current = persisted.harvests.find(
    ({ operationId }) => operationId === claim.fence.operationId,
  );
  if (!current) throw new Error("Expected persisted operation");
  expect(current).toMatchObject({
    headRepoSlug: "acme/a",
    expectedHeadSha: sha,
  });
  const currentPlan = {
    ...plan,
    hasRemoteBranchTarget: hasVerifiedBranchCleanupTarget(current),
  };
  expect(
    store.initializeHarvestStages({
      ...init,
      ...currentPlan,
      stages: planHarvestStages(currentPlan),
    }),
  ).toEqual({ ok: true });
  expect(store.snapshot().stages).toContainEqual(
    expect.objectContaining({ stage: "branch_cleanup", status: "pending" }),
  );
});

it.each([
  { hasSlackTarget: true, hasFeatureThread: false },
  { hasSlackTarget: true, hasFeatureThread: true },
  { hasSlackTarget: false, hasFeatureThread: false },
])(
  "persists gate failure with Slack target $hasSlackTarget and feature thread $hasFeatureThread",
  ({ hasSlackTarget, hasFeatureThread }) => {
    const operationId = "gate-failure";
    const existingNotice = outbox("existing-notice", "delivered");
    const acceptedNotice = outbox("gate-notice", "pending", {
      ownerOperationId: operationId,
      eventType: "harvest_gate_failed",
      payload: { text: "Harvest gate failed" },
    });
    const thread = {
      projectId,
      featureId,
      workspaceId: "W1",
      channelId: "C2",
      rootTs: "2.1",
      updatedAt: createdAt,
    };
    const notice = {
      ...acceptedNotice,
      recipient: hasFeatureThread
        ? {
            ...acceptedNotice.recipient,
            workspaceId: thread.workspaceId,
            channelId: thread.channelId,
            threadTs: thread.rootTs,
          }
        : {
            ...acceptedNotice.recipient,
            workspaceId: "W1",
            threadTs: undefined,
          },
    };
    const initial = restoreRecoveryStore({
      featureThreads: hasFeatureThread ? [thread] : [],
      slackBindings: {
        [projectId]: {
          workspaceId: "W1",
          channelId: hasFeatureThread ? thread.channelId : "C1",
          sharedChannel: false,
        },
      },
      harvests: [
        harvest(operationId, {
          recipient: hasFeatureThread
            ? { projectId, surface: "slack", workspaceId: thread.workspaceId }
            : hasSlackTarget
              ? acceptedNotice.recipient
              : null,
        }),
      ],
      stages: [],
      outboxItems: [existingNotice],
    });
    const claim = initial.claimHarvestLease({
      operationId,
      leaseOwner: "worker",
      nowIso,
      leaseExpiresAt,
    });
    if (!claim) throw new Error("Expected harvest lease");
    const plan = {
      terminalEvent: "merged" as const,
      phaseIds: [phaseId],
      hasSlackTarget,
      hasRemoteBranchTarget: true,
    };
    if (hasSlackTarget) {
      const before = initial.snapshot();
      const stalePlan = { ...plan, hasSlackTarget: false };
      expect(
        initial.initializeHarvestStages({
          ...stalePlan,
          fence: claim.fence,
          nowIso,
          stages: planHarvestStages(stalePlan),
        }),
      ).toEqual({ ok: false, code: "HARVEST_PLAN_CONFLICT" });
      expect(initial.snapshot()).toEqual(before);
    }
    const initialize = {
      ...plan,
      fence: claim.fence,
      nowIso,
      stages: planHarvestStages(plan),
    };
    expect(initial.initializeHarvestStages(initialize)).toEqual({ ok: true });
    const transition = {
      fence: claim.fence,
      nowIso,
      phaseKey: phaseId,
      stage: "gate_verify" as const,
      status: "gate_failed" as const,
      failureNotice: hasSlackTarget ? notice : null,
    };
    const beforeGate = restoreRecoveryStore({
      ...initial.snapshot(),
      featureThreads: [],
    });
    if (hasSlackTarget) {
      const before = beforeGate.snapshot();
      for (const failureNotice of [
        null,
        acceptedNotice,
        { ...notice, clientMetadataKey: "" },
        { ...notice, clientMetadataKey: " \t" },
        { ...notice, outboxId: existingNotice.outboxId },
        { ...notice, phaseId: "phase-02" },
        {
          ...notice,
          recipient: { ...notice.recipient, channelId: "C9", threadTs: "9.9" },
        },
      ]) {
        expect(
          beforeGate.transitionHarvestStage({ ...transition, failureNotice }),
        ).toEqual({ ok: false, code: "HARVEST_STAGE_TRANSITION_INVALID" });
        expect(beforeGate.snapshot()).toEqual(before);
      }
    }
    const beforeReplay = beforeGate.snapshot();
    const retry = restoreRecoveryStore(beforeReplay);
    expect(retry.initializeHarvestStages(initialize)).toEqual({
      ok: true,
    });
    expect(retry.snapshot()).toEqual(beforeReplay);
    expect(retry.transitionHarvestStage(transition)).toEqual({ ok: true });
    const persisted = retry.snapshot();
    const restartState = {
      ...persisted,
      featureThreads: hasFeatureThread
        ? [{ ...thread, channelId: "C3", rootTs: "3.1" }]
        : [],
    };
    const restarted = restoreRecoveryStore(restartState);
    expect(restarted.listRecoverableOutboxItems({ projectId, nowIso })).toEqual(
      hasSlackTarget
        ? [
            expect.objectContaining({
              eventType: "harvest_gate_failed",
              ownerOperationId: operationId,
              phaseId,
              status: "pending",
              recipient: notice.recipient,
            }),
          ]
        : [],
    );
    expect(restarted.snapshot().harvests).toEqual([
      expect.objectContaining({ status: "gate_failed", completedAt: nowIso }),
    ]);
    expect(restarted.snapshot().stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "gate_verify",
          status: "gate_failed",
        }),
        expect.objectContaining({
          stage: "learning_record",
          status: "pending",
        }),
      ]),
    );
    expect(
      restarted.listRecoverableHarvests({ nowIso: leaseExpiresAt }),
    ).toEqual([]);
    expect(
      restarted.transitionHarvestStage({
        fence: claim.fence,
        nowIso,
        phaseKey: phaseId,
        stage: "learning_record",
        status: "succeeded",
      }),
    ).toEqual({ ok: false, code: "HARVEST_STAGE_TRANSITION_INVALID" });
    expect(
      restarted.transitionHarvestStage({
        ...transition,
        failureNotice: hasSlackTarget
          ? { ...notice, outboxId: "duplicate", dedupeKey: "duplicate" }
          : null,
      }),
    ).toEqual({ ok: true });
    expect(restarted.snapshot()).toEqual(restartState);
    if (hasSlackTarget) {
      const savedDestination = {
        workspaceId: notice.recipient.workspaceId,
        channelId: notice.recipient.channelId,
        threadTs: notice.recipient.threadTs ?? null,
      };
      const changedDestination = {
        workspaceId: "W3",
        channelId: "C3",
        threadTs: "3.1",
      };
      expect(
        restarted.claimOutboxItem({
          outboxId: notice.outboxId,
          nowIso,
          destination: changedDestination,
        }),
      ).toMatchObject({
        action: "send",
        item: {
          ...savedDestination,
          clientMetadataKey: notice.clientMetadataKey,
        },
      });
      const afterSend = restoreRecoveryStore(restarted.snapshot());
      expect(
        afterSend.claimOutboxItem({
          outboxId: notice.outboxId,
          nowIso: leaseExpiresAt,
          destination: changedDestination,
        }),
      ).toMatchObject({
        action: "reconcile",
        claim: { clientMetadataKey: notice.clientMetadataKey },
        item: savedDestination,
      });
    }
  },
);

it.each([null, "C1"])(
  "rejects an incomplete saved gate notice with channel %s",
  (channelId) => {
    const notice = outbox("incomplete", "pending", {
      eventType: "harvest_gate_failed",
      channelId,
    });
    const store = restoreRecoveryStore({
      harvests: [],
      stages: [],
      outboxItems: [notice],
    });
    expect(
      store.claimOutboxItem({
        outboxId: notice.outboxId,
        nowIso,
        destination: { workspaceId: "W1", channelId: "C1", threadTs: "1.2" },
      }),
    ).toBeNull();
    expect(store.snapshot().outboxItems).toEqual([notice]);
  },
);

it("uses only the enrolled thread for the requested feature in a shared channel", () => {
  const route = {
    projectId,
    featureId,
    recipient: {
      projectId,
      surface: "slack" as const,
      workspaceId: "W1",
      channelId: "C1",
      threadTs: "9.9",
    },
    binding: { workspaceId: "W1", channelId: "C1", sharedChannel: true },
  };
  const otherThread = {
    projectId,
    featureId: "other-feature",
    workspaceId: "W1",
    channelId: "C1",
    rootTs: "9.9",
    updatedAt: nowIso,
  };
  expect(resolveHarvestSlackRecipient(route)?.threadTs).toBeUndefined();
  expect(
    resolveHarvestSlackRecipient({ ...route, thread: otherThread }),
  ).toEqual({
    ...route.recipient,
    threadTs: undefined,
  });
  expect(
    resolveHarvestSlackRecipient({
      ...route,
      thread: { ...otherThread, featureId, rootTs: "1.2" },
    })?.threadTs,
  ).toBe("1.2");
});

it("rejects a saved recipient outside the enrolled Slack binding", () => {
  const recipient = outbox("foreign", "pending").recipient;
  const route = {
    projectId,
    featureId,
    binding: { workspaceId: "W1", channelId: "C1", sharedChannel: false },
  };
  for (const foreign of [
    { ...recipient, workspaceId: "W2" },
    { ...recipient, channelId: "C2" },
    { ...recipient, projectId: "other-project" },
  ]) {
    expect(
      resolveHarvestSlackRecipient({ ...route, recipient: foreign }),
    ).toBeNull();
  }
  expect(
    resolveHarvestSlackRecipient({ ...route, binding: null, recipient }),
  ).toBeNull();
});

it("enriches a completed pull request harvest when a later delivery verifies its head", () => {
  const incomplete = harvestIntake("first-verified", { headRepoSlug: null });
  if (!incomplete.target.accepted)
    throw new Error("Expected first pull request");
  const [operation] = incomplete.target.operations;
  const receipts = planHarvestStages({
    phaseIds: [phaseId],
    terminalEvent: "merged",
    hasSlackTarget: false,
    hasRemoteBranchTarget: false,
  }).map(
    ({ phaseKey, stage, initialStatus }): HarvestStageReceipt => ({
      ...learningReceipt(operation.operationId),
      phaseKey,
      stage,
      status: initialStatus === "pending" ? "succeeded" : initialStatus,
    }),
  );
  const state = restoreHarvestIntake({
    harvests: [{ ...operation, status: "completed", completedAt: nowIso }],
    stages: receipts,
  });
  const foreign = harvestIntake(
    "foreign-head",
    { headRepoSlug: "other/repo" },
    "github_poller",
  );
  expect(
    restoreHarvestIntake(state.snapshot()).store.recordHarvestIntake(foreign),
  ).toMatchObject({
    ok: true,
    operations: [{ operationId: operation.operationId, status: "completed" }],
  });
  const complete = harvestIntake("verified-head", {}, "github_poller");
  expect(state.store.recordHarvestIntake(complete)).toMatchObject({
    ok: true,
    operations: [
      {
        operationId: operation.operationId,
        prNumber: 42,
        headRepoSlug: "acme/a",
        status: "running",
        completedAt: null,
      },
    ],
  });
  const restarted = restoreRecoveryStore({
    ...state.snapshot(),
    outboxItems: [],
  });
  const lease = restarted.claimHarvestLease({
    operationId: operation.operationId,
    nowIso,
    leaseOwner: "cleanup",
    leaseExpiresAt,
  });
  expect(
    lease?.stages.find(({ stage }) => stage === "branch_cleanup"),
  ).toMatchObject({ status: "pending", completedAt: null });
  expect(
    lease?.stages.filter(({ stage }) => stage !== "branch_cleanup"),
  ).toEqual(receipts.filter(({ stage }) => stage !== "branch_cleanup"));
});

it.each([
  { source: "offline commit", facts: verifiedOffline },
  {
    source: "offline commit with unverified head facts",
    facts: {
      ...verifiedOffline,
      headRepoSlug: "acme/a",
      headBranch: `feat/${featureId}-${phaseId}`,
      expectedHeadSha: sha,
    },
    attachIncompletePull: true,
  },
  {
    source: "pull request with an unknown head repository",
    facts: { headRepoSlug: null },
  },
])(
  "runs one tip-checked cleanup after verified facts enrich a completed $source harvest",
  ({ facts, attachIncompletePull }) =>
    verifyLateCleanupAfterRestart(facts, attachIncompletePull),
);

async function verifyLateCleanupAfterRestart(
  facts: HarvestIntakeFacts,
  attachIncompletePull = false,
) {
  const first = harvestIntake("completed-harvest", facts);
  if (!first.target.accepted) throw new Error("Expected harvest operation");
  const [operation] = first.target.operations;
  const originalLease = {
    leaseOwner: "harvest-worker",
    leaseEpoch: 1,
    leaseExpiresAt,
  };
  const cleanupLeaseExpiresAt = "2026-11-11T12:02:00.000Z";
  const receipts = planHarvestStages({
    phaseIds: [phaseId],
    terminalEvent: "merged",
    hasSlackTarget: false,
    hasRemoteBranchTarget: false,
  }).map(
    ({ phaseKey, stage, initialStatus }): HarvestStageReceipt => ({
      ...learningReceipt(operation.operationId),
      phaseKey,
      stage,
      status: initialStatus === "pending" ? "succeeded" : initialStatus,
    }),
  );
  let intake = restoreHarvestIntake({
    harvests: [
      {
        ...operation,
        ...originalLease,
        status: "completed",
        completedAt: nowIso,
      },
    ],
    stages: receipts,
  });
  if (attachIncompletePull) {
    expect(
      intake.store.recordHarvestIntake(
        harvestIntake("incomplete-pull", {
          headRepoSlug: null,
          expectedHeadSha: null,
        }),
      ),
    ).toMatchObject({ ok: true, deduplicatedWork: true });
    const saved = intake.snapshot();
    expect(saved.harvests).toMatchObject([
      {
        operationId: operation.operationId,
        prNumber: 42,
        headRepoSlug: null,
        expectedHeadSha: null,
        status: "completed",
        completedAt: nowIso,
      },
    ]);
    expect(saved.stages).toEqual(receipts);
    expect(
      restoreRecoveryStore({
        ...saved,
        outboxItems: [],
      }).listRecoverableHarvests({ nowIso: leaseExpiresAt }),
    ).toEqual([]);
    intake = restoreHarvestIntake(saved);
  }
  const pull = harvestIntake("verified-pull");
  expect(intake.store.recordHarvestIntake(pull)).toMatchObject({
    ok: true,
    operations: [
      {
        operationId: operation.operationId,
        workKey: operation.workKey,
        ...originalLease,
        status: "running",
        completedAt: null,
      },
    ],
  });
  const restarted = restoreRecoveryStore({
    ...intake.snapshot(),
    outboxItems: [],
  });
  expect(restarted.listRecoverableHarvests({ nowIso })).toEqual([]);
  const next = restarted.claimHarvestLease({
    operationId: operation.operationId,
    leaseOwner: "cleanup",
    nowIso: leaseExpiresAt,
    leaseExpiresAt: cleanupLeaseExpiresAt,
  });
  if (!next) throw new Error("Expected cleanup lease");
  expect(next.stages.filter(({ stage }) => stage !== "branch_cleanup")).toEqual(
    receipts.filter(({ stage }) => stage !== "branch_cleanup"),
  );
  expect(
    next.stages.find(({ stage }) => stage === "branch_cleanup"),
  ).toMatchObject({ status: "pending", completedAt: null });
  const target = {
    projectRepoSlug: "acme/a",
    candidateRepoSlug: next.operation.repoSlug,
    headRepoSlug: next.operation.headRepoSlug,
    trunkBranch: next.operation.trunkBranch,
    headBranch: next.operation.headBranch,
    expectedHeadSha: next.operation.expectedHeadSha,
  };
  expect(
    evaluateBranchCleanupSafety({
      ...target,
      observedRemoteHeadSha: "b".repeat(40),
    }),
  ).toMatchObject({ action: "block_cleanup", code: "TIP_MOVED" });
  const vcs: Pick<VcsPort, "deleteRemoteBranchAtTip"> = {
    deleteRemoteBranchAtTip: vi.fn(async () => ({ deleted: true })),
  };
  const decision = evaluateBranchCleanupSafety({
    ...target,
    observedRemoteHeadSha: sha,
  });
  if (decision.action !== "delete_at_tip")
    throw new Error("Expected safe cleanup");
  expect(
    await vcs.deleteRemoteBranchAtTip(
      "/repos/a",
      decision.branch,
      decision.expectedSha,
    ),
  ).toEqual({ deleted: true });
  expect(
    restarted.transitionHarvestStage({
      fence: next.fence,
      nowIso: leaseExpiresAt,
      phaseKey: phaseId,
      stage: "branch_cleanup",
      status: "succeeded",
    }),
  ).toEqual({ ok: true });
  const final = restoreHarvestIntake({
    ...intake.snapshot(),
    ...restarted.snapshot(),
  });
  for (const delivery of [
    pull,
    harvestIntake("poller-pull", {}, "github_poller"),
  ]) {
    expect(final.store.recordHarvestIntake(delivery)).toMatchObject({
      ok: true,
      deduplicatedWork: true,
      operations: [{ operationId: operation.operationId, status: "completed" }],
    });
  }
  const persisted = final.snapshot();
  expect(persisted.stages).toEqual(restarted.snapshot().stages);
  expect(
    persisted.stages.filter(({ stage }) => stage !== "branch_cleanup"),
  ).toEqual(receipts.filter(({ stage }) => stage !== "branch_cleanup"));
  expect(vcs.deleteRemoteBranchAtTip).toHaveBeenCalledExactlyOnceWith(
    "/repos/a",
    `feat/${featureId}-${phaseId}`,
    sha,
  );
  expect(
    restoreRecoveryStore({
      ...persisted,
      outboxItems: [],
    }).listRecoverableHarvests({
      nowIso: cleanupLeaseExpiresAt,
    }),
  ).toEqual([]);
}

it("records learning for an offline harvest after restart", async () => {
  const restarted = restoreRecoveryStore({
    harvests: [
      harvest("offline", {
        ...offline,
        recipient: { projectId, surface: "slack", workspaceId: "W1" },
      }),
    ],
    slackBindings: {
      [projectId]: { workspaceId: "W1", channelId: "C1", sharedChannel: false },
    },
    stages: [],
    outboxItems: [],
  });
  const [discovered] = restarted.listRecoverableHarvests({ projectId, nowIso });
  const claim = restarted.claimHarvestLease({
    operationId: discovered.operationId,
    leaseOwner: "learning-worker",
    nowIso,
    leaseExpiresAt,
  });
  if (!claim) throw new Error("Expected a learning claim");
  const { operation, fence } = claim;
  const targets = { hasSlackTarget: true, hasRemoteBranchTarget: false };
  expect(
    restarted.initializeHarvestStages({
      fence,
      nowIso,
      phaseIds: [phaseId],
      ...targets,
      stages: planHarvestStages({
        terminalEvent: "merged",
        phaseIds: [phaseId],
        ...targets,
      }),
    }),
  ).toEqual({ ok: true });
  for (const stage of ["git_sync", "gate_verify"] as const) {
    expect(
      restarted.transitionHarvestStage({
        fence,
        nowIso,
        phaseKey: phaseId,
        stage,
        status: "succeeded",
      }),
    ).toEqual({ ok: true });
  }
  const execution: Pick<HarvestExecutionPort, "recordLearningAtCheckout"> = {
    recordLearningAtCheckout: vi.fn(async () => ({
      linkedRunId: 77,
      forecastMissing: false,
      summaryText: "Recorded offline learning",
    })),
  };
  const result = await execution.recordLearningAtCheckout({
    checkoutDir: "/repos/a/checkout",
    projectId: operation.projectId,
    featureId: operation.featureId,
    phaseId: operation.phaseId,
    prNumber: operation.prNumber,
    prUrl: operation.prUrl,
    terminalEvent: operation.terminalEvent,
    mergeCommitSha: operation.mergeCommitSha,
    terminalAt: operation.terminalAt,
    gatePassed: true,
  });
  expect(
    restarted.transitionHarvestStage({
      fence,
      nowIso,
      phaseKey: phaseId,
      stage: "learning_record",
      status: "succeeded",
      linkedRunId: result.linkedRunId,
      evidenceJson: JSON.stringify(result),
    }),
  ).toEqual({ ok: true });
  expect(execution.recordLearningAtCheckout).toHaveBeenCalledWith(
    expect.objectContaining({
      prNumber: null,
      prUrl: null,
      mergeCommitSha: sha,
    }),
  );
  const restored = restoreRecoveryStore(restarted.snapshot());
  const replay = restored.claimHarvestLease({
    operationId: operation.operationId,
    leaseOwner: "replay-worker",
    nowIso: leaseExpiresAt,
    leaseExpiresAt: "2026-11-11T12:02:00.000Z",
  });
  if (!replay) throw new Error("Expected a replay claim");
  expect(replay.stages).toHaveLength(5);
  expect(
    replay.stages.filter(({ stage }) => stage === "learning_record"),
  ).toEqual([
    expect.objectContaining({
      operationId: "offline",
      stage: "learning_record",
      status: "succeeded",
      evidenceJson: expect.stringContaining(result.summaryText),
    }),
  ]);
  expect(replay.operation.linkedRunId).toBe(77);
  expect(
    restored.transitionHarvestStage({
      fence: replay.fence,
      nowIso: leaseExpiresAt,
      phaseKey: phaseId,
      stage: "slack_delivery",
      status: "succeeded",
    }),
  ).toEqual({ ok: true });
  expect(restored.snapshot().harvests[0].linkedRunId).toBe(77);
});

it("launches each persisted dispatch with its accepted task scope after restart", async () => {
  const rows = [["T001"], ["T002"], []].map((taskIds, index) => {
    const accepted = evaluateDispatchAcceptance({
      projectId,
      featureId,
      phaseId,
      backend: "test-worker",
      trunkBranch: "develop",
      taskIds,
      newOperationId: `dispatch-${index}`,
      nowIso,
      existingActive: null,
    });
    if (accepted.kind !== "create_new")
      throw new Error("Expected new dispatch");
    return JSON.stringify(accepted.operation);
  });
  const worker: Pick<WorkerExecutionPort, "launchPhaseShip"> = {
    launchPhaseShip: vi.fn(async () => ({ exitCode: 0, stderr: "" })),
  };
  for (const row of rows) {
    const { trunkBranch, branchName, featureId, phaseId, backend, taskIds } =
      JSON.parse(row) as DurableDispatchOperation;
    await worker.launchPhaseShip({
      projectRoot: "/repos/a",
      trunkBranch,
      branchName,
      featureId,
      phaseId,
      backend,
      taskIds,
    });
  }
  expect(
    vi
      .mocked(worker.launchPhaseShip)
      .mock.calls.map(([input]) => input.taskIds),
  ).toEqual([["T001"], ["T002"], []]);
});
