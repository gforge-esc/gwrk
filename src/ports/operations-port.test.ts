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
  planHarvestStages,
  scopeManualHarvestToPhases,
  verifyHarvestTarget,
} from "../domain/durable-harvest.js";
import type {
  DurableHarvestOperation,
  HarvestExecutionPort,
  OperationsStorePort,
  OutboxItem,
  WorkerExecutionPort,
} from "./operations-port.js";

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

function harvestIntake(
  operationId: string,
  overrides: Partial<DurableHarvestOperation> = {},
): HarvestIntake {
  const operation = harvest(operationId, overrides);
  const candidate: HarvestCandidateInput = {
    source: operation.prNumber === null ? "manual_cli" : "github_webhook",
    deliveryId: operationId,
    repoSlug: operation.repoSlug,
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
  const verified = verifyHarvestTarget(
    {
      projectId: operation.projectId,
      slug: "a",
      name: "A",
      repoSlug: "acme/a",
      trunkBranch: "develop",
      localRoot: "/repos/a",
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local"] },
      slack: null,
      legacyProjectIds: [],
      createdAt,
      updatedAt: createdAt,
    },
    candidate,
  );
  if (!verified.ok) throw new Error(verified.reason);
  operation.workKey = verified.workKey;
  return {
    candidate,
    payloadDigest: operationId,
    receivedAt: nowIso,
    target: { accepted: true, operation },
  };
}

const offline = {
  prNumber: null,
  prUrl: null,
  repoSlug: null,
  headRepoSlug: null,
  headBranch: null,
  expectedHeadSha: null,
};

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
}) {
  const rows = structuredClone(persisted);
  const aliases = rows.aliases ?? [];
  const store: Pick<OperationsStorePort, "recordHarvestIntake"> = {
    recordHarvestIntake({ target }) {
      if (!target.accepted) throw new Error("Expected accepted intake");
      const incoming = target.operation;
      const alias = aliases.find(
        (row) =>
          row.projectId === incoming.projectId &&
          row.workKey === incoming.workKey,
      );
      const existing =
        rows.harvests.find(
          (row) =>
            row.projectId === incoming.projectId &&
            (row.workKey === incoming.workKey ||
              row.operationId === alias?.operationId),
        ) ??
        rows.harvests
          .filter((row) => canCorrelateHarvestIntake(row, incoming))
          .sort(
            (a, b) =>
              a.createdAt.localeCompare(b.createdAt) ||
              a.operationId.localeCompare(b.operationId),
          )[0];
      if (!existing) {
        rows.harvests.push(incoming);
      } else if (!alias && existing.workKey !== incoming.workKey) {
        aliases.push({
          projectId: incoming.projectId,
          workKey: incoming.workKey,
          operationId: existing.operationId,
        });
        if (existing.prNumber === null && incoming.prNumber !== null) {
          const {
            repoSlug,
            headRepoSlug,
            prNumber,
            prUrl,
            headBranch,
            expectedHeadSha,
            terminalAt,
          } = incoming;
          Object.assign(existing, {
            repoSlug,
            headRepoSlug,
            prNumber,
            prUrl,
            headBranch,
            expectedHeadSha,
            terminalAt,
          });
        }
      }
      return {
        ok: true,
        operation: existing ?? incoming,
        deduplicatedTransport: false,
        deduplicatedWork: Boolean(existing),
      };
    },
  };
  return { store, snapshot: () => structuredClone({ ...rows, aliases }) };
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
  harvests: DurableHarvestOperation[];
  stages: HarvestStageReceipt[];
  outboxItems: OutboxItem[];
}) {
  const {
    dispatches = [],
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
    initializeHarvestStages({ fence, nowIso, stages: plan }) {
      const row = harvests.find((row) => row.operationId === fence.operationId);
      if (!row) return { ok: false, code: "LEASE_FENCED" };
      const lease = validateLeaseFence(row, fence, nowIso);
      if (!lease.ok) return lease;
      const key = ({ phaseKey, stage }: { phaseKey: string; stage: string }) =>
        JSON.stringify([phaseKey, stage]);
      const keys = new Set(plan.map(key));
      const saved = stages.filter(
        ({ operationId }) => operationId === fence.operationId,
      );
      if (
        !plan.length ||
        keys.size !== plan.length ||
        (saved.length &&
          (saved.length !== keys.size ||
            !saved.every((entry) => keys.has(key(entry)))))
      ) {
        return { ok: false, code: "HARVEST_PLAN_CONFLICT" };
      }
      if (!saved.length) {
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
      evidenceJson,
    }) {
      const row = harvests.find((row) => row.operationId === fence.operationId);
      if (!row) return { ok: false, code: "LEASE_FENCED" };
      const result = validateLeaseFence(row, fence, nowIso);
      if (!result.ok) return result;
      const receipt = stages.find(
        (entry) =>
          entry.operationId === fence.operationId &&
          entry.phaseKey === phaseKey &&
          entry.stage === stage,
      );
      if (!receipt) return { ok: false, code: "HARVEST_STAGE_UNPLANNED" };
      Object.assign(receipt, {
        status,
        leaseEpoch: fence.leaseEpoch,
        evidenceJson: evidenceJson ?? null,
        updatedAt: nowIso,
        completedAt: nowIso,
      });
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
  return Object.assign(store, {
    snapshot: () =>
      structuredClone({ dispatches, harvests, stages, outboxItems }),
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
      const manual = harvestIntake("manual", { ...offline, phaseId: null });
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
          ...offline,
          phaseId: candidate.explicitPhaseId,
        }),
        candidate,
      }));
      const pull = harvestIntake("verified-pull");
      const first = prFirst ? pull : inputs[0];
      const overlapping = prFirst ? inputs[0] : pull;
      if (!first.target.accepted) throw new Error("Expected initial intake");
      const original = first.target.operation;
      const stage = learningReceipt(original.operationId);
      const resumed = restoreHarvestIntake({
        harvests: [original],
        stages: [stage],
      });
      expect(resumed.store.recordHarvestIntake(overlapping)).toMatchObject({
        deduplicatedWork: true,
        operation: { operationId: original.operationId },
      });
      expect(resumed.store.recordHarvestIntake(inputs[1])).toMatchObject({
        deduplicatedWork: false,
        operation: { phaseId: "phase-02" },
      });
      expect(resumed.snapshot().harvests.map(({ phaseId }) => phaseId)).toEqual(
        [phaseId, "phase-02"],
      );
      expect(resumed.snapshot().stages).toEqual([stage]);
    },
  );

  it("persists a complete phase plan before work and preserves progress after takeover", () => {
    const store = restoreRecoveryStore({
      harvests: [harvest("planned", { phaseId: null })],
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
    const plan = planHarvestStages({
      phaseIds,
      terminalEvent: "merged",
      hasSlackTarget: true,
      hasRemoteBranchTarget: true,
    });
    const init = { fence: claim.fence, nowIso, stages: plan };
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
    expect(
      afterPlan.initializeHarvestStages({ ...resumed, stages: plan }),
    ).toEqual({ ok: true });
    expect(
      afterPlan.initializeHarvestStages({
        ...resumed,
        stages: plan.slice(0, 5),
      }),
    ).toEqual({
      ok: false,
      code: "HARVEST_PLAN_CONFLICT",
    });
    const afterFirstPhase = restoreRecoveryStore(
      afterPlan.snapshot(),
    ).claimHarvestLease({
      operationId: "planned",
      leaseOwner: "third",
      nowIso: later,
      leaseExpiresAt: "2026-11-11T12:03:00.000Z",
    });
    if (!afterFirstPhase) throw new Error("Expected second takeover");
    expect(
      afterFirstPhase.stages
        .filter((entry) => entry.status === "pending")
        .map((entry) => entry.phaseKey),
    ).toEqual(Array(5).fill("phase-02"));
    expect(
      deriveHarvestTerminalStatus({
        terminalEvent: "merged",
        phaseIds,
        stages: afterFirstPhase.stages,
      }),
    ).toBe("running");
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

describe("persisted harvest intake contract", () => {
  it.each(["local", "pull request"])(
    "preserves the first operation and receipts when %s arrives first",
    (firstSource) => {
      const local = harvestIntake("local", {
        ...offline,
        mergeCommitSha: ` ${sha.toUpperCase()} `,
      });
      const pull = harvestIntake("pull");
      const [first, second] =
        firstSource === "local" ? [local, pull] : [pull, local];
      if (!first.target.accepted) throw new Error("Expected accepted intake");
      const firstOperation = first.target.operation;
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
        operation: expected,
      });
      const persisted = restarted.snapshot();
      expect(persisted.harvests).toHaveLength(1);
      expect(persisted.stages).toEqual([receipt]);
      const replay = restoreHarvestIntake(persisted).store;
      for (const intake of [first, second]) {
        expect(replay.recordHarvestIntake(intake)).toMatchObject({
          ok: true,
          deduplicatedWork: true,
          operation: expected,
        });
      }
    },
  );

  it.each([
    ["project", { projectId: "project-b" }],
    ["feature", { featureId: "other-feature" }],
    ["phase", { phaseId: null }],
    ["commit", { mergeCommitSha: "b".repeat(40) }],
  ] as const)("keeps different %s scopes separate", (_field, override) => {
    const local = harvestIntake("local", { ...offline, ...override });
    if (!local.target.accepted)
      throw new Error("Expected accepted local intake");
    const restarted = restoreHarvestIntake({
      harvests: [local.target.operation],
      stages: [],
    });
    expect(
      restarted.store.recordHarvestIntake(harvestIntake("pull")),
    ).toMatchObject({
      ok: true,
      deduplicatedWork: false,
      operation: { operationId: "pull" },
    });
    expect(restarted.snapshot().harvests).toHaveLength(2);
  });

  it("keeps distinct verified pull requests at the same commit separate", () => {
    const first = harvestIntake("first-pull");
    if (!first.target.accepted)
      throw new Error("Expected accepted pull request");
    const restarted = restoreHarvestIntake({
      harvests: [first.target.operation],
      stages: [],
    });
    expect(
      restarted.store.recordHarvestIntake(harvestIntake("local", offline)),
    ).toMatchObject({
      ok: true,
      deduplicatedWork: true,
      operation: { operationId: "first-pull" },
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
      operation: { operationId: "second-pull" },
    });
    expect(replay.snapshot().harvests).toHaveLength(2);
  });
});

it("records learning for an offline harvest after restart", async () => {
  const restarted = restoreRecoveryStore({
    harvests: [harvest("offline", offline)],
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
  expect(
    restarted.initializeHarvestStages({
      fence,
      nowIso,
      stages: planHarvestStages({
        terminalEvent: "merged",
        phaseIds: [phaseId],
        hasSlackTarget: false,
        hasRemoteBranchTarget: false,
      }),
    }),
  ).toEqual({ ok: true });
  const execution: Pick<HarvestExecutionPort, "recordLearningAtCheckout"> = {
    recordLearningAtCheckout: vi.fn(async () => ({
      linkedRunId: null,
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
  const replay = restarted.claimHarvestLease({
    operationId: operation.operationId,
    leaseOwner: "replay-worker",
    nowIso: leaseExpiresAt,
    leaseExpiresAt: "2026-11-11T12:02:00.000Z",
  });
  expect(replay?.stages).toHaveLength(5);
  expect(
    replay?.stages.filter(({ stage }) => stage === "learning_record"),
  ).toEqual([
    expect.objectContaining({
      operationId: "offline",
      stage: "learning_record",
      status: "succeeded",
      evidenceJson: expect.stringContaining(result.summaryText),
    }),
  ]);
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
