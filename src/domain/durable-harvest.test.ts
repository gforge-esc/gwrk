/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import {
  DeliverySourceSchema,
  type HarvestCandidateInput,
  HarvestOperationStatusSchema,
  HarvestStageNameSchema,
  type HarvestStageReceipt,
  HarvestStageStatusSchema,
  HarvestTerminalEventSchema,
  OutboxStatusSchema,
  computeHarvestWorkKey,
  deriveHarvestTerminalStatus,
  evaluateBranchCleanupSafety,
  planHarvestStages,
  verifyHarvestTarget,
} from "./durable-harvest.js";

const featureId = "049-durable-dispatch-harvest";
const phaseId = "phase-01";
const sha = "a".repeat(40);
const now = "2026-11-11T12:00:00.000Z";
const project: Parameters<typeof verifyHarvestTarget>[0] = {
  projectId: "project-a",
  slug: "a",
  name: "A",
  repoSlug: "acme/a",
  trunkBranch: "develop",
  localRoot: "/repos/a",
  mirrorPath: null,
  runnerPolicy: { allowedKinds: ["local"] },
  slack: null,
  legacyProjectIds: [],
  createdAt: now,
  updatedAt: now,
};
function candidate(
  overrides: Partial<HarvestCandidateInput> = {},
): HarvestCandidateInput {
  return {
    source: "github_webhook",
    deliveryId: "delivery-1",
    repoSlug: "acme/a",
    headRepoSlug: "acme/a",
    baseBranch: "develop",
    headBranch: `phase/${featureId}-${phaseId}`,
    expectedHeadSha: sha,
    prNumber: 42,
    prUrl: "https://github.com/acme/a/pull/42",
    terminalEvent: "merged",
    mergeCommitSha: sha,
    terminalAt: now,
    ...overrides,
  };
}
function receipt(
  stage: HarvestStageReceipt["stage"],
  status: HarvestStageReceipt["status"] = "succeeded",
): HarvestStageReceipt {
  return {
    operationId: "harvest-1",
    phaseKey: phaseId,
    stage,
    status,
    leaseEpoch: 2,
    attemptCount: 1,
    evidenceJson: null,
    error: null,
    updatedAt: now,
    completedAt: status === "succeeded" ? now : null,
  };
}
const stageNames = [
  "git_sync",
  "gate_verify",
  "learning_record",
  "slack_delivery",
  "branch_cleanup",
] as const;
const cleanup = {
  projectRepoSlug: "acme/a",
  candidateRepoSlug: "acme/a",
  headRepoSlug: "Acme/A",
  trunkBranch: "develop",
  headBranch: `phase/${featureId}-${phaseId}`,
  expectedHeadSha: sha,
  observedRemoteHeadSha: sha,
};

describe("FR-002 harvest identity and target verification", () => {
  it("TR-002 converges transports and arrival order on the same verified work key", () => {
    const inputs = (
      ["manual_cli", "github_poller", "github_webhook"] as const
    ).map((source, i) =>
      candidate({
        source,
        deliveryId: `delivery-${i}`,
        terminalAt: `2026-11-${11 + i}T12:00:00.000Z`,
      }),
    );
    const results = inputs.map((input) => verifyHarvestTarget(project, input));
    const expected = {
      ok: true,
      featureId,
      phaseId,
      workKey: computeHarvestWorkKey({
        prNumber: 42,
        terminalEvent: "merged",
        mergeCommitSha: sha,
        featureId,
        phaseId,
      }),
    };
    expect(results).toEqual([expected, expected, expected]);
    expect(
      inputs.reverse().map((input) => verifyHarvestTarget(project, input)),
    ).toEqual([expected, expected, expected]);
  });
  it.each([null, "acme/a"])(
    "accepts an enrolled local commit without a pull request for %j",
    (repoSlug) => {
      const local = candidate({
        source: "manual_cli",
        deliveryId: "local-1",
        repoSlug,
        headRepoSlug: null,
        headBranch: null,
        expectedHeadSha: null,
        prNumber: null,
        prUrl: null,
        explicitFeatureId: featureId,
        explicitPhaseId: "phase-1",
      });
      const enrolled = { ...project, repoSlug };
      const result = verifyHarvestTarget(enrolled, local);

      expect(result).toMatchObject({ ok: true, featureId, phaseId });
      expect(
        verifyHarvestTarget(enrolled, {
          ...local,
          deliveryId: "local-2",
          mergeCommitSha: sha.toUpperCase(),
        }),
      ).toEqual(result);
      expect(
        verifyHarvestTarget({ ...enrolled, projectId: "project-b" }, local),
      ).not.toEqual(result);
      expect(
        verifyHarvestTarget(enrolled, { ...local, explicitPhaseId: undefined }),
      ).toMatchObject({ ok: true, featureId, phaseId: null });
      expect(
        verifyHarvestTarget(enrolled, { ...local, mergeCommitSha: "aabbcc" }),
      ).toMatchObject({ ok: false, code: "INVALID_MERGE_SHA" });
      expect(
        verifyHarvestTarget(enrolled, { ...local, source: "github_webhook" }),
      ).toMatchObject({ ok: false });
    },
  );

  it.each([
    [{ repoSlug: "acme/b" }, "REPO_MISMATCH"],
    [{ baseBranch: "foreign" }, "NOT_CONFIGURED_TRUNK"],
  ] as const)(
    "rejects conflicting local checkout evidence %j",
    (override, code) => {
      expect(
        verifyHarvestTarget(
          project,
          candidate({
            source: "manual_cli",
            repoSlug: "Acme/A",
            prNumber: null,
            prUrl: null,
            headRepoSlug: null,
            headBranch: null,
            expectedHeadSha: null,
            explicitFeatureId: featureId,
            ...override,
          }),
        ),
      ).toMatchObject({ ok: false, code });
    },
  );

  it("TR-002 distinguishes terminal events and separate merges", () => {
    const input = {
      prNumber: 42,
      terminalEvent: "merged" as const,
      mergeCommitSha: sha,
      featureId,
      phaseId,
    };
    const key = computeHarvestWorkKey(input);
    expect(key).not.toBe(computeHarvestWorkKey({ ...input, prNumber: 43 }));
    expect(key).not.toBe(
      computeHarvestWorkKey({ ...input, mergeCommitSha: "b".repeat(40) }),
    );
    expect(key).not.toBe(
      computeHarvestWorkKey({
        ...input,
        terminalEvent: "closed_unmerged",
        mergeCommitSha: null,
      }),
    );
  });
  it("TR-002 keeps matching PR numbers scoped to their enrolled repository", () => {
    const other = { ...project, projectId: "project-b", repoSlug: "acme/b" };
    const a = verifyHarvestTarget(project, candidate());
    const b = verifyHarvestTarget(
      other,
      candidate({
        repoSlug: "acme/b",
        prUrl: "https://github.com/acme/b/pull/42",
      }),
    );
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("Expected valid targets");
    expect([project.projectId, a.workKey]).not.toEqual([
      other.projectId,
      b.workKey,
    ]);
    expect(verifyHarvestTarget(other, candidate())).toMatchObject({
      ok: false,
      code: "REPO_MISMATCH",
    });
  });
  it.each([
    [{ repoSlug: "acme/b" }, "REPO_MISMATCH"],
    [{ repoSlug: null }, "REPO_MISMATCH"],
    [{ prNumber: 0, prUrl: null }, "INVALID_PR_NUMBER"],
    [{ prNumber: 1.5, prUrl: null }, "INVALID_PR_NUMBER"],
    [
      { prNumber: Number.MAX_SAFE_INTEGER + 1, prUrl: null },
      "INVALID_PR_NUMBER",
    ],
    [{ prUrl: "bad url" }, "PR_URL_MISMATCH"],
    [{ prUrl: "https://github.com/acme/b/pull/42" }, "PR_URL_MISMATCH"],
    [{ prUrl: "https://github.com/acme/a/pull/43" }, "PR_URL_MISMATCH"],
    [{ prUrl: "http://github.com/acme/a/pull/42" }, "PR_URL_MISMATCH"],
    [{ prUrl: "https://github.com.example/acme/a/pull/42" }, "PR_URL_MISMATCH"],
    [{ baseBranch: "main" }, "NOT_CONFIGURED_TRUNK"],
    [{ headBranch: "unrelated" }, "NOT_FEATURE_BRANCH"],
    [{ headBranch: null }, "NOT_FEATURE_BRANCH"],
    [{ mergeCommitSha: null }, "MISSING_MERGE_SHA"],
    [{ mergeCommitSha: "" }, "MISSING_MERGE_SHA"],
    [{ mergeCommitSha: "  " }, "MISSING_MERGE_SHA"],
    [{ mergeCommitSha: "HEAD" }, "INVALID_MERGE_SHA"],
    [{ mergeCommitSha: "refs/heads/develop" }, "INVALID_MERGE_SHA"],
    [{ mergeCommitSha: sha.slice(0, 12) }, "INVALID_MERGE_SHA"],
    [{ mergeCommitSha: "g".repeat(40) }, "INVALID_MERGE_SHA"],
    [{ explicitPhaseId: "phase-02" }, "PHASE_MISMATCH"],
  ] as const)("TR-002 rejects invalid target %j", (override, code) => {
    expect(verifyHarvestTarget(project, candidate(override))).toEqual({
      ok: false,
      code,
      reason: expect.any(String),
    });
  });
  it.each([40, 64])("accepts a full %i-digit Git object ID", (length) => {
    const mergeCommitSha = "ab".repeat(length / 2);
    const expected = verifyHarvestTarget(
      project,
      candidate({ mergeCommitSha }),
    );
    expect(expected).toMatchObject({
      ok: true,
      workKey: expect.stringContaining(mergeCommitSha),
    });
    expect(
      verifyHarvestTarget(
        project,
        candidate({ mergeCommitSha: ` ${mergeCommitSha.toUpperCase()} ` }),
      ),
    ).toEqual(expected);
  });
  it("TR-002 accepts a verified close without a merge SHA", () => {
    expect(
      verifyHarvestTarget(
        project,
        candidate({ terminalEvent: "closed_unmerged", mergeCommitSha: null }),
      ),
    ).toMatchObject({
      ok: true,
      featureId,
      phaseId,
      workKey: expect.any(String),
    });
  });

  it("uses the same phase identity for legacy and padded branch names", () => {
    expect(
      verifyHarvestTarget(
        project,
        candidate({ headBranch: `feat/${featureId}-phase-1` }),
      ),
    ).toEqual(verifyHarvestTarget(project, candidate()));
  });

  it("resolves a dispatch branch to its original harvest target", () => {
    expect(
      verifyHarvestTarget(
        project,
        candidate({
          headBranch: `feat/${featureId}-${phaseId}--dispatch-${sha.padEnd(64, "a")}`,
          explicitFeatureId: featureId,
          explicitPhaseId: phaseId,
          prUrl: "https://github.com/ACME/A/pull/42",
        }),
      ),
    ).toEqual(verifyHarvestTarget(project, candidate()));
  });

  it("rejects an explicit feature that conflicts with the branch", () => {
    expect(
      verifyHarvestTarget(project, candidate({ explicitFeatureId: "other" })),
    ).toMatchObject({ ok: false, code: "NOT_FEATURE_BRANCH" });
  });
});

describe("FR-003 independent harvest stages", () => {
  it("TR-003 plans five ordered stages for each phase", () => {
    const phases = Object.freeze(["phase-01", "phase-02"]);
    const plan = planHarvestStages({
      terminalEvent: "merged",
      phaseIds: phases,
      hasSlackTarget: true,
      hasRemoteBranchTarget: true,
    });
    for (const phaseKey of phases) {
      expect(plan.filter((item) => item.phaseKey === phaseKey)).toEqual(
        stageNames.map((stage) => ({
          phaseKey,
          stage,
          initialStatus: "pending",
        })),
      );
    }
    expect(plan).toHaveLength(10);
    expect(phases).toEqual(["phase-01", "phase-02"]);
  });
  it("TR-003 skips absent external targets without skipping gates or learning", () => {
    expect(
      planHarvestStages({
        terminalEvent: "merged",
        phaseIds: [phaseId],
        hasSlackTarget: false,
        hasRemoteBranchTarget: false,
      }),
    ).toEqual(
      stageNames.map((stage) => ({
        phaseKey: phaseId,
        stage,
        initialStatus:
          stage === "slack_delivery" || stage === "branch_cleanup"
            ? "skipped_no_target"
            : "pending",
      })),
    );
  });
  it("TR-003 completes only when all stage receipts have succeeded", () => {
    const stages = stageNames.map((stage) => receipt(stage));
    expect(
      deriveHarvestTerminalStatus({
        terminalEvent: "merged",
        phaseIds: [phaseId],
        stages,
      }),
    ).toBe("completed");
    stages[4] = receipt("branch_cleanup", "skipped_no_target");
    stages[3] = receipt("slack_delivery", "skipped_no_target");
    expect(
      deriveHarvestTerminalStatus({
        terminalEvent: "merged",
        phaseIds: [phaseId],
        stages,
      }),
    ).toBe("completed");
  });
  it.each(["merged", "closed_unmerged"] as const)(
    "keeps a %s harvest resumable until every planned phase has receipts",
    (terminalEvent) => {
      const phaseIds = [phaseId, "phase-02"];
      const plan = planHarvestStages({
        terminalEvent,
        phaseIds,
        hasSlackTarget: true,
        hasRemoteBranchTarget: true,
      });
      const stages = plan.map(({ phaseKey, stage }) => ({
        ...receipt(stage),
        phaseKey,
      }));
      expect(
        deriveHarvestTerminalStatus({
          terminalEvent,
          phaseIds,
          stages: stages.filter(({ phaseKey }) => phaseKey === phaseId),
        }),
      ).toBe("running");
      expect(
        deriveHarvestTerminalStatus({ terminalEvent, phaseIds, stages }),
      ).toBe(terminalEvent === "merged" ? "completed" : "closed_unmerged");
    },
  );
  it.each([
    ["gate_verify", "gate_failed", "gate_failed"],
    ["slack_delivery", "uncertain", "delivery_pending"],
    ["branch_cleanup", "blocked_tip_mismatch", "cleanup_blocked"],
    ["git_sync", "failed", "failed"],
  ] as const)(
    "TR-003 preserves unresolved %s status %s",
    (stage, status, expected) => {
      const stages = stageNames.map((name) =>
        receipt(name, name === stage ? status : "succeeded"),
      );
      expect(
        deriveHarvestTerminalStatus({
          terminalEvent: "merged",
          phaseIds: [phaseId],
          stages,
        }),
      ).toBe(expected);
    },
  );
  it.each(["pending", "running"] as const)(
    "TR-003 does not report completion for %s gates",
    (status) => {
      expect(
        deriveHarvestTerminalStatus({
          terminalEvent: "merged",
          phaseIds: [phaseId],
          stages: stageNames.map((stage) =>
            receipt(stage, stage === "gate_verify" ? status : "succeeded"),
          ),
        }),
      ).not.toBe("completed");
    },
  );
});

describe("FR-005 closed attempts and branch cleanup", () => {
  it("TR-004 records closed attempts without gate verification or phase promotion", () => {
    expect(
      planHarvestStages({
        terminalEvent: "closed_unmerged",
        phaseIds: [phaseId],
        hasSlackTarget: true,
        hasRemoteBranchTarget: true,
      }),
    ).toEqual([
      { phaseKey: phaseId, stage: "learning_record", initialStatus: "pending" },
    ]);
    expect(
      deriveHarvestTerminalStatus({
        terminalEvent: "closed_unmerged",
        phaseIds: [phaseId],
        stages: [receipt("learning_record")],
      }),
    ).toBe("closed_unmerged");
    expect(
      deriveHarvestTerminalStatus({
        terminalEvent: "merged",
        phaseIds: [phaseId],
        stages: [receipt("gate_verify", "gate_failed")],
      }),
    ).toBe("gate_failed");
  });
  it("TR-004 permits compare-and-delete only at the expected tip", () => {
    expect(evaluateBranchCleanupSafety(cleanup)).toEqual({
      action: "delete_at_tip",
      branch: cleanup.headBranch,
      expectedSha: sha,
    });
  });
  it("TR-004 reconciles an already deleted remote branch", () => {
    expect(
      evaluateBranchCleanupSafety({ ...cleanup, observedRemoteHeadSha: null }),
    ).toEqual({ action: "already_deleted" });
  });
  it.each([
    [{ candidateRepoSlug: "acme/b" }, "REPO_MISMATCH"],
    [{ headRepoSlug: "fork/a" }, "HEAD_REPO_MISMATCH"],
    [{ headRepoSlug: null }, "HEAD_REPO_MISMATCH"],
    [{ headBranch: "develop" }, "PROTECTED_BRANCH"],
    [{ headBranch: "chore/unrelated" }, "PROTECTED_BRANCH"],
    [{ expectedHeadSha: null }, "MISSING_EXPECTED_TIP"],
    [{ expectedHeadSha: "" }, "MISSING_EXPECTED_TIP"],
    [{ observedRemoteHeadSha: "b".repeat(40) }, "TIP_MOVED"],
  ] as const)("TR-004 blocks unsafe branch cleanup %j", (override, code) => {
    expect(evaluateBranchCleanupSafety({ ...cleanup, ...override })).toEqual({
      action: "block_cleanup",
      code,
    });
  });
});

describe("FR-006 pure harvest policy", () => {
  it("TR-002 returns equal results for equal facts without changing inputs", () => {
    const input = candidate();
    const before = structuredClone({ project, input });
    const first = verifyHarvestTarget(project, input);
    expect(first.ok).toBe(true);
    expect(verifyHarvestTarget(project, input)).toEqual(first);
    expect({ project, input }).toEqual(before);
    expect(
      verifyHarvestTarget(project, { ...input, baseBranch: "wrong" }),
    ).toMatchObject({ ok: false, code: "NOT_CONFIGURED_TRUNK" });
  });
});

describe("FR-006 durable status schemas", () => {
  it("TR-005 validates DeliverySourceSchema values and rejects unknown or missing status", () => {
    for (const value of ["github_webhook", "github_poller", "manual_cli"])
      expect(DeliverySourceSchema.parse(value)).toBe(value);
    for (const value of ["unknown", "", null, undefined, 42])
      expect(DeliverySourceSchema.safeParse(value).success).toBe(false);
  });
  it("TR-005 validates HarvestTerminalEventSchema values and rejects unknown or missing status", () => {
    for (const value of ["merged", "closed_unmerged"])
      expect(HarvestTerminalEventSchema.parse(value)).toBe(value);
    for (const value of ["unknown", "", null, undefined, 42])
      expect(HarvestTerminalEventSchema.safeParse(value).success).toBe(false);
  });
  it("TR-005 validates HarvestOperationStatusSchema values and rejects unknown or missing status", () => {
    for (const value of [
      "accepted",
      "running",
      "completed",
      "gate_failed",
      "delivery_pending",
      "cleanup_blocked",
      "closed_unmerged",
      "failed",
    ])
      expect(HarvestOperationStatusSchema.parse(value)).toBe(value);
    for (const value of ["unknown", "", null, undefined, 42])
      expect(HarvestOperationStatusSchema.safeParse(value).success).toBe(false);
  });
  it("TR-005 validates HarvestStageNameSchema values and rejects unknown or missing status", () => {
    for (const value of [
      "git_sync",
      "gate_verify",
      "learning_record",
      "slack_delivery",
      "branch_cleanup",
    ])
      expect(HarvestStageNameSchema.parse(value)).toBe(value);
    for (const value of ["unknown", "", null, undefined, 42])
      expect(HarvestStageNameSchema.safeParse(value).success).toBe(false);
  });
  it("TR-005 validates HarvestStageStatusSchema values and rejects unknown or missing status", () => {
    for (const value of [
      "pending",
      "running",
      "succeeded",
      "gate_failed",
      "forecast_missing",
      "uncertain",
      "blocked_tip_mismatch",
      "skipped_no_target",
      "failed",
    ])
      expect(HarvestStageStatusSchema.parse(value)).toBe(value);
    for (const value of ["unknown", "", null, undefined, 42])
      expect(HarvestStageStatusSchema.safeParse(value).success).toBe(false);
  });
  it("TR-005 validates OutboxStatusSchema values and rejects unknown or missing status", () => {
    for (const value of [
      "pending",
      "sending",
      "uncertain",
      "delivered",
      "skipped_no_target",
      "failed",
    ])
      expect(OutboxStatusSchema.parse(value)).toBe(value);
    for (const value of ["unknown", "", null, undefined, 42])
      expect(OutboxStatusSchema.safeParse(value).success).toBe(false);
  });
});
