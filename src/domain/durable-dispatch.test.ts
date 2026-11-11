/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DispatchAttemptStatusSchema,
  DispatchOperationStatusSchema,
  type DurableDispatchOperation,
  EvidenceLevelSchema,
  type WorkerRecoveryEvidence,
  computeDispatchWorkKey,
  evaluateDispatchAcceptance,
  evaluateStaleDispatchReconciliation,
  validateLeaseFence,
} from "./durable-dispatch.js";

const now = "2026-11-11T12:00:00.000Z";
const featureId = "049-durable-dispatch-harvest";
const phaseId = "phase-01";
const recipient = {
  projectId: "project-a",
  surface: "slack" as const,
  channelId: "C1",
  threadTs: "1.2",
};
const request = {
  projectId: "project-a",
  featureId,
  phaseId,
  backend: "test-worker",
  trunkBranch: "develop",
  recipient,
  newOperationId: "new-op",
  nowIso: now,
};
function operation(
  overrides: Partial<DurableDispatchOperation> = {},
): DurableDispatchOperation {
  return {
    operationId: "old-op",
    projectId: "project-a",
    workKey: `ship:${featureId}:${phaseId}`,
    featureId,
    phaseId,
    taskIds: [],
    backend: "test-worker",
    branchName: `phase/${featureId}-${phaseId}`,
    trunkBranch: "develop",
    recipient,
    status: "accepted",
    attemptCount: 0,
    leaseOwner: null,
    leaseEpoch: 0,
    leaseExpiresAt: null,
    heartbeatAt: null,
    prNumber: null,
    prUrl: null,
    lastRunId: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    evidenceLevel: "durable_verified",
    ...overrides,
  };
}
const noEvidence: WorkerRecoveryEvidence = {
  workerState: "stopped",
  pullRequestLookup: "complete",
  openPullRequest: null,
  mergedPullRequest: null,
  completedManifestRunId: null,
  sandboxDir: null,
};

describe("FR-001 dispatch work identity and acceptance", () => {
  it("TR-001 normalizes task order without mutating input or collapsing different work", () => {
    const tasks = Object.freeze(["T002", "T001"]);
    const key = computeDispatchWorkKey({ featureId, phaseId, taskIds: tasks });
    expect(key).toBe(
      computeDispatchWorkKey({ featureId, phaseId, taskIds: ["T001", "T002"] }),
    );
    expect(key).not.toBe(
      computeDispatchWorkKey({ featureId, phaseId, taskIds: ["T001"] }),
    );
    expect(key).not.toBe(computeDispatchWorkKey({ featureId, phaseId }));
    expect(tasks).toEqual(["T002", "T001"]);
  });
  it("TR-001 uses the documented phase key and isolates phases and features", () => {
    expect(computeDispatchWorkKey({ featureId, phaseId })).toBe(
      `ship:${featureId}:${phaseId}`,
    );
    expect(computeDispatchWorkKey({ featureId, phaseId, taskIds: [] })).toBe(
      `ship:${featureId}:${phaseId}`,
    );
    expect(computeDispatchWorkKey({ featureId, phaseId: "phase-02" })).not.toBe(
      `ship:${featureId}:${phaseId}`,
    );
    expect(
      computeDispatchWorkKey({
        featureId: "048-project-identity-slack",
        phaseId,
      }),
    ).not.toBe(`ship:${featureId}:${phaseId}`);
  });
  it("TR-001 creates a stable receipt and an unleased accepted operation", () => {
    const result = evaluateDispatchAcceptance({
      ...request,
      existingActive: null,
    });
    expect(result.kind).toBe("create_new");
    if (result.kind !== "create_new") throw new Error("Expected new operation");
    expect(result.operation).toMatchObject({
      operationId: "new-op",
      projectId: "project-a",
      featureId,
      phaseId,
      workKey: `ship:${featureId}:${phaseId}`,
      branchName: `feat/${featureId}-${phaseId}--dispatch-${createHash("sha256")
        .update(
          JSON.stringify([
            request.projectId,
            `ship:${featureId}:${phaseId}`,
            request.newOperationId,
          ]),
        )
        .digest("hex")}`,
      status: "accepted",
      attemptCount: 0,
      leaseEpoch: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      recipient,
      evidenceLevel: "durable_verified",
    });
    expect(result.receipt).toEqual({
      operationId: "new-op",
      projectId: "project-a",
      featureId,
      phaseId,
      workKey: result.operation.workKey,
      branchName: result.operation.branchName,
      status: "accepted",
      attemptCount: 0,
      deduplicated: false,
      recipient,
      createdAt: now,
    });
  });
  it.each(["accepted", "leased", "running", "reconciling"] as const)(
    "TR-001 preserves the original receipt for active %s work",
    (status) => {
      const existing = operation({ status, attemptCount: 2 });
      const before = structuredClone(existing);
      const result = evaluateDispatchAcceptance({
        ...request,
        existingActive: existing,
        nowIso: "2026-11-12T00:00:00.000Z",
        recipient: null,
      });
      expect(result).toEqual({
        kind: "deduplicated",
        receipt: {
          operationId: existing.operationId,
          projectId: existing.projectId,
          workKey: existing.workKey,
          featureId,
          phaseId,
          branchName: existing.branchName,
          status,
          attemptCount: 2,
          deduplicated: true,
          recipient,
          createdAt: now,
        },
      });
      expect(existing).toEqual(before);
    },
  );
  it.each(["completed", "failed", "superseded"] as const)(
    "TR-001 does not deduplicate terminal %s work",
    (status) => {
      expect(
        evaluateDispatchAcceptance({
          ...request,
          existingActive: operation({ status }),
        }),
      ).toMatchObject({
        kind: "create_new",
        receipt: { operationId: "new-op", deduplicated: false },
      });
    },
  );
  it.each([
    { projectId: "project-b" },
    { workKey: "ship:other:phase-01", featureId: "other" },
  ])("TR-001 does not reuse an unrelated active receipt %j", (override) => {
    expect(
      evaluateDispatchAcceptance({
        ...request,
        existingActive: operation(override),
      }),
    ).toMatchObject({
      kind: "create_new",
      receipt: { operationId: "new-op", projectId: "project-a" },
    });
  });
});

describe("FR-003 lease fencing", () => {
  const current = {
    operationId: "old-op",
    leaseOwner: "worker-a",
    leaseEpoch: 4,
    leaseExpiresAt: "2026-11-11T12:01:00.000Z",
  };
  const fence = {
    operationId: "old-op",
    leaseOwner: "worker-a",
    leaseEpoch: 4,
  };
  it("TR-003 accepts the current owner before expiry", () => {
    expect(validateLeaseFence(current, fence, now)).toEqual({ ok: true });
  });
  it("fences a persisted lease projection with missing operation identity", () => {
    const { operationId: _operationId, ...projection } = current;
    expect(
      validateLeaseFence(projection as typeof current, fence, now),
    ).toEqual({ ok: false, code: "LEASE_FENCED" });
  });
  it.each([{ leaseEpoch: 3 }, { leaseEpoch: 5 }, { leaseOwner: "worker-b" }])(
    "TR-003 fences a mismatched claim %j",
    (override) => {
      expect(
        validateLeaseFence(current, { ...fence, ...override }, now),
      ).toEqual({ ok: false, code: "LEASE_FENCED" });
    },
  );
  it.each(["2026-11-11T12:01:00.000Z", "2026-11-11T12:01:00.001Z"])(
    "TR-003 rejects expiry at %s",
    (at) => {
      expect(validateLeaseFence(current, fence, at)).toEqual({
        ok: false,
        code: "LEASE_EXPIRED",
      });
    },
  );
  it("TR-003 rejects a missing lease without accepting an epoch match", () => {
    expect(
      validateLeaseFence(
        { ...current, leaseOwner: null, leaseExpiresAt: null },
        fence,
        now,
      ),
    ).toEqual({ ok: false, code: "LEASE_FENCED" });
  });
});

describe("FR-001 stale dispatch reconciliation", () => {
  const first = evaluateDispatchAcceptance({
    ...request,
    newOperationId: "first-op",
    existingActive: null,
    taskIds: ["T001"],
  });
  if (first.kind !== "create_new") throw new Error("Expected first operation");
  const second = evaluateDispatchAcceptance({
    ...request,
    existingActive: first.operation,
    taskIds: ["T002"],
  });
  if (second.kind !== "create_new")
    throw new Error("Expected second operation");

  it("assigns distinct branches to different task sets in the same phase", () => {
    expect(second.receipt.branchName).not.toBe(first.receipt.branchName);
  });

  it.each(["openPullRequest", "mergedPullRequest"] as const)(
    "requeues stale work with foreign %s evidence",
    (pullRequestKind) => {
      expect(
        evaluateStaleDispatchReconciliation({
          operation: {
            ...second.operation,
            status: "running",
            attemptCount: 1,
          },
          evidence: {
            ...noEvidence,
            [pullRequestKind]: {
              operationId: first.operation.operationId,
              prNumber: 42,
              prUrl: "https://github.com/acme/a/pull/42",
              mergeCommitSha: "a".repeat(40),
            },
          },
          maxCrashRecoveryAttempts: 3,
        }),
      ).toMatchObject({ action: "requeue_attempt" });
    },
  );

  const unresolvedPullRequest = {
    operationId: null,
    prNumber: 42,
    prUrl: "https://github.com/acme/a/pull/42",
  };
  it.each([
    [
      "open pull request with unknown ownership",
      {
        openPullRequest: unresolvedPullRequest,
      },
    ],
    [
      "merged pull request with unknown ownership",
      {
        mergedPullRequest: {
          ...unresolvedPullRequest,
          mergeCommitSha: "a".repeat(40),
        },
      },
    ],
    ["unavailable lookup", { pullRequestLookup: "unavailable" }],
  ] as const)(
    "waits for evidence from a stopped worker with %s",
    (_label, evidence) => {
      for (const attemptCount of [1, 3]) {
        expect(
          evaluateStaleDispatchReconciliation({
            operation: { ...second.operation, status: "running", attemptCount },
            evidence: { ...noEvidence, ...evidence },
            maxCrashRecoveryAttempts: 3,
          }),
        ).toMatchObject({ action: "await_pr_evidence" });
      }
    },
  );

  it("TR-001 requeues a pre-launch crash with recovery budget", () => {
    expect(
      evaluateStaleDispatchReconciliation({
        operation: operation({ status: "leased", attemptCount: 1 }),
        evidence: noEvidence,
        maxCrashRecoveryAttempts: 3,
      }),
    ).toEqual({ action: "requeue_attempt", reason: expect.any(String) });
  });
  it("TR-001 completes an opened pull request without another launch", () => {
    expect(
      evaluateStaleDispatchReconciliation({
        operation: operation({ status: "running" }),
        evidence: {
          ...noEvidence,
          openPullRequest: {
            operationId: "old-op",
            prNumber: 42,
            prUrl: "https://github.com/acme/a/pull/42",
          },
        },
        maxCrashRecoveryAttempts: 3,
      }),
    ).toEqual({
      action: "complete_from_pr",
      prNumber: 42,
      prUrl: "https://github.com/acme/a/pull/42",
    });
  });
  it("TR-001 completes from verified merged evidence even with an incomplete lookup", () => {
    expect(
      evaluateStaleDispatchReconciliation({
        operation: operation({ status: "running", attemptCount: 3 }),
        evidence: {
          ...noEvidence,
          pullRequestLookup: "unavailable",
          mergedPullRequest: {
            operationId: "old-op",
            prNumber: 42,
            prUrl: "https://github.com/acme/a/pull/42",
            mergeCommitSha: "a".repeat(40),
          },
        },
        maxCrashRecoveryAttempts: 3,
      }),
    ).toEqual({
      action: "complete_from_pr",
      prNumber: 42,
      prUrl: "https://github.com/acme/a/pull/42",
      triggerHarvestMergeSha: "a".repeat(40),
    });
  });
  it.each([3, 4])(
    "TR-001 stops recovery at exhausted attempt %s",
    (attemptCount) => {
      expect(
        evaluateStaleDispatchReconciliation({
          operation: operation({ attemptCount }),
          evidence: noEvidence,
          maxCrashRecoveryAttempts: 3,
        }),
      ).toEqual({ action: "fail_exhausted", reason: expect.any(String) });
    },
  );
});

describe("FR-006 pure dispatch policy", () => {
  it("TR-001 repeats acceptance from supplied facts without changing them", () => {
    const input = {
      ...request,
      existingActive: null,
      taskIds: ["T002", "T001"],
    };
    const before = structuredClone(input);
    const first = evaluateDispatchAcceptance(input);
    expect(first.kind).toBe("create_new");
    expect(evaluateDispatchAcceptance(input)).toEqual(first);
    expect(input).toEqual(before);
    expect(
      evaluateDispatchAcceptance({ ...input, existingActive: operation() }),
    ).toEqual(first);
  });

  it("fences another operation with the same owner and epoch", () => {
    const current = operation({
      leaseOwner: "worker-a",
      leaseEpoch: 1,
      leaseExpiresAt: "2026-11-11T12:01:00.000Z",
    });
    expect(
      validateLeaseFence(
        current,
        { operationId: "other-op", leaseOwner: "worker-a", leaseEpoch: 1 },
        now,
      ),
    ).toEqual({ ok: false, code: "LEASE_FENCED" });
  });
});

describe("FR-006 durable status schemas", () => {
  it("TR-005 validates EvidenceLevelSchema values and rejects unknown or missing status", () => {
    for (const value of ["durable_verified", "legacy_unverified"])
      expect(EvidenceLevelSchema.parse(value)).toBe(value);
    for (const value of ["unknown", "", null, undefined, 42])
      expect(EvidenceLevelSchema.safeParse(value).success).toBe(false);
  });
  it("TR-005 validates DispatchOperationStatusSchema values and rejects unknown or missing status", () => {
    for (const value of [
      "accepted",
      "leased",
      "running",
      "reconciling",
      "completed",
      "failed",
      "superseded",
    ])
      expect(DispatchOperationStatusSchema.parse(value)).toBe(value);
    for (const value of ["unknown", "", null, undefined, 42])
      expect(DispatchOperationStatusSchema.safeParse(value).success).toBe(
        false,
      );
  });
  it("TR-005 validates DispatchAttemptStatusSchema values and rejects unknown or missing status", () => {
    for (const value of [
      "running",
      "completed",
      "failed",
      "interrupted",
      "reconciled_completed",
    ])
      expect(DispatchAttemptStatusSchema.parse(value)).toBe(value);
    for (const value of ["unknown", "", null, undefined, 42])
      expect(DispatchAttemptStatusSchema.safeParse(value).success).toBe(false);
  });
});

describe("stale worker restart safety", () => {
  it.each(["running", "unknown"] as const)(
    "keeps a %s worker from acquiring a replacement attempt",
    (workerState) => {
      expect(
        evaluateStaleDispatchReconciliation({
          operation: operation(),
          evidence: { ...noEvidence, workerState },
          maxCrashRecoveryAttempts: 3,
        }),
      ).toMatchObject({ action: "await_worker_stop" });
    },
  );
});
