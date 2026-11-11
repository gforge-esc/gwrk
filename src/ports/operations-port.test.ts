/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";
import {
  type DurableDispatchOperation,
  evaluateDispatchAcceptance,
  validateLeaseFence,
} from "../domain/durable-dispatch.js";
import type { HarvestStageReceipt } from "../domain/durable-harvest.js";
import type {
  DurableHarvestOperation,
  OperationsStorePort,
  OutboxItem,
  WorkerExecutionPort,
} from "./operations-port.js";

type RecoveryStore = Pick<
  OperationsStorePort,
  | "listRecoverableHarvests"
  | "claimHarvestLease"
  | "heartbeatHarvestLease"
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
  harvests: DurableHarvestOperation[];
  stages: HarvestStageReceipt[];
  outboxItems: OutboxItem[];
}): RecoveryStore {
  const { harvests, stages, outboxItems } = structuredClone(persisted);
  const resumableHarvests = ["accepted", "running", "delivery_pending"];
  const byCreation = (a: { createdAt: string }, b: { createdAt: string }) =>
    a.createdAt.localeCompare(b.createdAt);

  const store: RecoveryStore = {
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
      if (action === "send" && row.channelId === null && destination) {
        Object.assign(row, destination);
      }
      row.status = "sending";
      row.updatedAt = nowIso;
      row.attemptCount += 1;
      return {
        claim: {
          outboxId,
          attemptNumber: row.attemptCount,
          clientMetadataKey: row.clientMetadataKey,
        },
        item: { ...row },
        action,
      };
    },
  };
  return store;
}

describe("durable recovery store contract", () => {
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

  it("discovers project sends and claims abandoned or uncertain sends for reconciliation", () => {
    const store = restoreRecoveryStore({
      harvests: [],
      stages: [],
      outboxItems: [
        outbox("uncertain", "uncertain", { createdAt: nowIso }),
        outbox("live", "sending", { updatedAt: nowIso }),
        outbox("delivered", "delivered"),
        outbox("abandoned", "sending", {
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
