/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import type { HarvestStageReceipt } from "../domain/durable-harvest.js";
import type {
  DurableHarvestOperation,
  OperationsStorePort,
  OutboxItem,
} from "./operations-port.js";

type RecoveryStore = Pick<
  OperationsStorePort,
  | "listRecoverableHarvests"
  | "claimHarvestLease"
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
    claimOutboxItem({ outboxId, nowIso }) {
      const candidate = outboxItems.find((row) => row.outboxId === outboxId);
      if (!candidate) return null;
      const row = store
        .listRecoverableOutboxItems({ projectId: candidate.projectId, nowIso })
        .find((row) => row.outboxId === outboxId);
      if (!row) return null;
      const action = row.status === "pending" ? "send" : "reconcile";
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
    const claims = candidates.map(({ outboxId }) => ({ outboxId, nowIso }));
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
});
