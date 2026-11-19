/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveProjectId } from "../../adapters/git/index.js";
import { createGitHubHarvestAdapter } from "../../adapters/github/index.js";
import { createHarvestExecutionAdapter } from "../../adapters/harvest/index.js";
import {
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../../adapters/sqlite/index.js";
import { getGateResults } from "../../db/gates.js";
import { openDatabase } from "../../db/index.js";
import { listRuns } from "../../db/runs.js";
import type { EnrolledProject } from "../../domain/project-registry.js";
import { harvestFeature } from "../../engine/harvest.js";
import type { NotificationPort } from "../../ports/notification-port.js";
import type {
  GitHubHarvestPort,
  HarvestExecutionPort,
  HarvestPullRequestFact,
} from "../../ports/operations-port.js";
import type { VcsHarvestExtensions, VcsPort } from "../../ports/vcs-port.js";
import { createOutboxDeliveryService } from "../delivery/outbox.js";
import { createDurableHarvestService } from "./index.js";

let root: string;
let dbPath: string;
let db: ReturnType<typeof openDatabase>;
let time: string;
let alphaProject: EnrolledProject;
let betaProject: EnrolledProject;

const SECRET = "test-webhook-secret";
const MERGE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const MOVED_SHA = "c".repeat(40);

function createEnrolledRepo(
  baseDir: string,
  slug: string,
  repoSlug: string,
  workspaceId: string,
  channelId: string,
): EnrolledProject {
  const repoDir = join(baseDir, slug);
  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync(
    "git",
    ["remote", "add", "origin", `https://github.com/${repoSlug}.git`],
    { cwd: repoDir },
  );
  const projectId = resolveProjectId(repoDir);
  return {
    projectId,
    slug,
    name: slug.toUpperCase(),
    repoSlug,
    trunkBranch: "main",
    localRoot: repoDir,
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["local"] },
    slack: { workspaceId, channelId, sharedChannel: false },
    legacyProjectIds: [],
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
  };
}

function advanceSeconds(seconds: number): void {
  time = new Date(Date.parse(time) + seconds * 1000).toISOString();
}

function signWebhook(payload: unknown, secret = SECRET) {
  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const signatureHeader = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return { rawBody, signatureHeader, parsedPayload: payload };
}

function prWebhookPayload(overrides?: {
  repoSlug?: string;
  headRepoSlug?: string | null;
  prNumber?: number;
  merged?: boolean;
  baseBranch?: string;
  headBranch?: string;
  headSha?: string;
  mergeCommitSha?: string | null;
  mergedAt?: string | null;
  closedAt?: string;
}) {
  const repoSlug = overrides?.repoSlug ?? "acme/alpha";
  const headRepoSlug =
    overrides?.headRepoSlug === undefined ? repoSlug : overrides.headRepoSlug;
  const prNumber = overrides?.prNumber ?? 42;
  const merged = overrides?.merged ?? true;
  return {
    action: "closed",
    repository: { full_name: repoSlug },
    pull_request: {
      number: prNumber,
      html_url: `https://github.com/${repoSlug}/pull/${prNumber}`,
      state: "closed",
      merged,
      merge_commit_sha:
        overrides?.mergeCommitSha !== undefined
          ? overrides.mergeCommitSha
          : merged
            ? MERGE_SHA
            : null,
      merged_at:
        overrides?.mergedAt !== undefined
          ? overrides.mergedAt
          : merged
            ? "2026-11-18T00:01:00.000Z"
            : null,
      closed_at: overrides?.closedAt ?? "2026-11-18T00:01:00.000Z",
      base: {
        ref: overrides?.baseBranch ?? "main",
        repo: { full_name: repoSlug },
      },
      head: {
        ref: overrides?.headBranch ?? "feat/049-durable-phase-01",
        sha: overrides?.headSha ?? HEAD_SHA,
        repo: headRepoSlug ? { full_name: headRepoSlug } : null,
      },
    },
  };
}

function prFact(
  overrides?: Partial<HarvestPullRequestFact>,
): HarvestPullRequestFact {
  const repoSlug = overrides?.repoSlug ?? "acme/alpha";
  const prNumber = overrides?.prNumber ?? 42;
  const merged = overrides?.merged ?? true;
  return {
    repoSlug,
    headRepoSlug:
      overrides?.headRepoSlug !== undefined ? overrides.headRepoSlug : repoSlug,
    prNumber,
    prUrl:
      overrides?.prUrl ?? `https://github.com/${repoSlug}/pull/${prNumber}`,
    state: overrides?.state ?? (merged ? "MERGED" : "CLOSED"),
    merged,
    baseBranch: overrides?.baseBranch ?? "main",
    headBranch: overrides?.headBranch ?? "feat/049-durable-phase-01",
    headSha: overrides?.headSha !== undefined ? overrides.headSha : HEAD_SHA,
    mergeCommitSha:
      overrides?.mergeCommitSha !== undefined
        ? overrides.mergeCommitSha
        : merged
          ? MERGE_SHA
          : null,
    mergedAt:
      overrides?.mergedAt !== undefined
        ? overrides.mergedAt
        : merged
          ? "2026-11-18T00:01:00.000Z"
          : null,
    closedAt: overrides?.closedAt ?? "2026-11-18T00:01:00.000Z",
  };
}

function createHarness(options?: { leaseDurationMs?: number }) {
  let idSeq = 0;
  const realGithubVerifier = createGitHubHarvestAdapter();

  const vcs: VcsHarvestExtensions & Pick<VcsPort, "discoverIdentityFacts"> = {
    fetchBranch: vi.fn().mockResolvedValue(undefined),
    resolveRefSha: vi.fn().mockResolvedValue(MERGE_SHA),
    isCommitAncestorOfRef: vi.fn().mockResolvedValue(true),
    createDetachedCheckout: vi.fn().mockImplementation(async (cwd, sha) => ({
      checkoutDir: `${cwd}/.detached-${sha.slice(0, 8)}`,
      commitSha: sha,
    })),
    removeDetachedCheckout: vi.fn().mockResolvedValue(undefined),
    getRemoteBranchSha: vi.fn().mockResolvedValue(HEAD_SHA),
    deleteRemoteBranchAtTip: vi.fn().mockResolvedValue({ deleted: true }),
    discoverIdentityFacts: vi.fn().mockImplementation((cwd: string) => ({
      projectRoot: cwd,
      remoteOriginUrl:
        cwd === betaProject.localRoot
          ? "https://github.com/acme/beta.git"
          : "https://github.com/acme/alpha.git",
      gitCommonDir: `${cwd}/.git`,
    })),
  };

  const github: GitHubHarvestPort = {
    verifyWebhookSignature: (rawBody, sig, secret) =>
      realGithubVerifier.verifyWebhookSignature(rawBody, sig, secret),
    listTerminalPullRequests: vi.fn().mockResolvedValue([]),
    getPullRequest: vi.fn().mockResolvedValue(prFact()),
  };

  const executor: HarvestExecutionPort = {
    discoverPhasesAtCheckout: vi.fn().mockResolvedValue(["phase-01"]),
    verifyGatesAtCheckout: vi.fn().mockResolvedValue({
      passed: 2,
      failed: 0,
      total: 2,
      failedTaskIds: [],
    }),
    recordLearningAtCheckout: vi.fn().mockResolvedValue({
      linkedRunId: null,
      forecastMissing: false,
      pointCompression: 3.2,
      summaryText: "Done Done! 049-durable phase-01 shipped.",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Shipped" } }],
    }),
  };

  const notify = vi
    .fn<NotificationPort["notify"]>()
    .mockImplementation(async (payload) => ({
      delivered: true,
      channelId: payload.channel ?? payload.recipient?.channelId ?? "C1",
      messageTs: "1700000001.000100",
      threadTs: payload.threadTs ?? payload.recipient?.threadTs,
    }));

  const reconcileDelivery = vi
    .fn<NonNullable<NotificationPort["reconcileDelivery"]>>()
    .mockResolvedValue({
      status: "indeterminate",
      reason: "lookup_unavailable",
    });

  const build = () => {
    const store = createSqliteOperationsStoreAdapter({ db });
    const registry = createSqliteProjectRegistryAdapter({ db });
    const clock = { nowIso: () => time, nowMs: () => Date.parse(time) };
    const newId = () => `harv-${++idSeq}`;
    const outbox = createOutboxDeliveryService({
      store,
      registry,
      notifier: { notify, reconcileDelivery },
      clock,
      newId,
    });
    const service = createDurableHarvestService({
      store,
      registry,
      vcs,
      github,
      executor,
      outbox,
      clock,
      newId,
      leaseDurationMs: options?.leaseDurationMs ?? 60_000,
    });
    return { service, store, registry, outbox };
  };

  const reopen = () => {
    db.close();
    db = openDatabase({ dbPath });
    return build();
  };

  return {
    ...build(),
    reopen,
    vcs,
    github,
    executor,
    notify,
    reconcileDelivery,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gwrk-harvest-service-"));
  dbPath = join(root, "ledger.sqlite");
  db = openDatabase({ dbPath });
  time = "2026-11-18T00:00:00.000Z";
  alphaProject = createEnrolledRepo(root, "alpha", "acme/alpha", "W1", "C1");
  betaProject = createEnrolledRepo(root, "beta", "acme/beta", "W2", "C2");
  const registry = createSqliteProjectRegistryAdapter({ db });
  registry.enrollProject(alphaProject);
  registry.enrollProject(betaProject);
  registry.bindFeatureThread({
    projectId: alphaProject.projectId,
    featureId: "049-durable",
    workspaceId: "W1",
    channelId: "C1",
    rootTs: "1700000000.000000",
    updatedAt: time,
  });
});

afterEach(() => {
  if (db.open) db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("DurableHarvestService", () => {
  it("TR-002 converges duplicate webhook, poller and manual deliveries onto one merge and rejects stale close", async () => {
    const harness = createHarness();

    // Invalid signature is rejected before writing anything.
    const bad = await harness.service.ingestWebhook({
      deliveryId: "del-bad",
      eventType: "pull_request",
      ...signWebhook(prWebhookPayload(), "wrong-secret"),
      webhookSecret: SECRET,
    });
    expect(bad).toEqual({
      accepted: false,
      httpStatus: 401,
      reason: expect.any(String),
    });

    // 1. Signed webhook commits durable intake without executing gates on the HTTP path.
    const signed = signWebhook(prWebhookPayload());
    const firstWebhook = await harness.service.ingestWebhook({
      deliveryId: "del-1",
      eventType: "pull_request",
      ...signed,
      webhookSecret: SECRET,
    });
    expect(firstWebhook.accepted).toBe(true);
    if (!firstWebhook.accepted) return;
    expect(firstWebhook.summary.status).toBe("accepted");
    expect(firstWebhook.summary.deduplicatedTransport).toBe(false);
    expect(harness.executor.verifyGatesAtCheckout).not.toHaveBeenCalled();

    // 2. Duplicate transport delivery returns same operationId.
    const replayWebhook = await harness.service.ingestWebhook({
      deliveryId: "del-1",
      eventType: "pull_request",
      ...signed,
      webhookSecret: SECRET,
    });
    expect(replayWebhook.accepted).toBe(true);
    if (!replayWebhook.accepted) return;
    expect(replayWebhook.summary.operationId).toBe(
      firstWebhook.summary.operationId,
    );
    expect(replayWebhook.summary.deduplicatedTransport).toBe(true);

    // 3. Resume executes all 5 stages once.
    const resumed = await harness.service.resumeIncomplete("runner-1");
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toMatchObject({
      operationId: firstWebhook.summary.operationId,
      status: "completed",
      pendingStages: [],
      failedStages: [],
    });
    expect(harness.executor.verifyGatesAtCheckout).toHaveBeenCalledTimes(1);
    expect(harness.notify).toHaveBeenCalledTimes(1);
    expect(harness.vcs.deleteRemoteBranchAtTip).toHaveBeenCalledTimes(1);
    expect(harness.vcs.removeDetachedCheckout).toHaveBeenCalledTimes(1);

    // 4. Poller seeing the same merged PR converges on the completed operation without re-running stages.
    vi.mocked(harness.github.listTerminalPullRequests).mockResolvedValueOnce([
      prFact(),
    ]);
    const polled = await harness.service.pollProject(alphaProject, "poller-1");
    expect(polled).toHaveLength(1);
    expect(polled[0].operationId).toBe(firstWebhook.summary.operationId);
    expect(polled[0].deduplicatedWork).toBe(true);
    expect(polled[0].status).toBe("completed");
    expect(harness.executor.verifyGatesAtCheckout).toHaveBeenCalledTimes(1);
    expect(
      harness.store.getHarvestCursor(alphaProject.projectId),
    ).toMatchObject({
      lastTerminalAt: "2026-11-18T00:01:00.000Z",
      lastPrNumber: 42,
      lastError: null,
    });

    // 5. Manual CLI harvest for PR #42 converges on the same operation.
    const manual = await harness.service.runManualHarvest({
      project: alphaProject,
      featureId: "049-durable",
      phaseId: "phase-01",
      prNumber: 42,
      updateLocalTaskState: false,
      ownerId: "cli-1",
    });
    expect(manual).toHaveLength(1);
    expect(manual[0].operationId).toBe(firstWebhook.summary.operationId);
    expect(manual[0].status).toBe("completed");
    expect(harness.executor.verifyGatesAtCheckout).toHaveBeenCalledTimes(1);

    // 6. Out-of-order stale closed_unmerged webhook cannot overwrite verified merge.
    const staleClose = await harness.service.ingestWebhook({
      deliveryId: "del-stale-close",
      eventType: "pull_request",
      ...signWebhook(prWebhookPayload({ merged: false, mergeCommitSha: null })),
      webhookSecret: SECRET,
    });
    expect(staleClose.accepted).toBe(true);
    if (!staleClose.accepted) return;
    expect(staleClose.summary.operationId).toBe(
      firstWebhook.summary.operationId,
    );
    expect(staleClose.summary.status).toBe("completed");
    expect(
      harness.store.getOperationsStatus(alphaProject.projectId).harvest
        .closedUnmergedCount,
    ).toBe(0);
  });

  it("TR-002 isolates two enrolled repositories sharing the same feature, PR number and merge SHA", async () => {
    const harness = createHarness();
    const alphaIn = await harness.service.ingestWebhook({
      deliveryId: "del-alpha-42",
      eventType: "pull_request",
      ...signWebhook(
        prWebhookPayload({ repoSlug: "acme/alpha", prNumber: 42 }),
      ),
      webhookSecret: SECRET,
    });
    const betaIn = await harness.service.ingestWebhook({
      deliveryId: "del-beta-42",
      eventType: "pull_request",
      ...signWebhook(prWebhookPayload({ repoSlug: "acme/beta", prNumber: 42 })),
      webhookSecret: SECRET,
    });
    expect(alphaIn.accepted && betaIn.accepted).toBe(true);
    if (!alphaIn.accepted || !betaIn.accepted) return;
    expect(alphaIn.summary.operationId).not.toBe(betaIn.summary.operationId);

    const summaries = await harness.service.resumeIncomplete("runner-1");
    expect(summaries).toHaveLength(2);
    expect(summaries.every((s) => s.status === "completed")).toBe(true);
    expect(harness.notify).toHaveBeenCalledTimes(2);
    expect(harness.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: alphaProject.projectId,
        channel: "C1",
      }),
    );
    expect(harness.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: betaProject.projectId,
        channel: "C2",
      }),
    );
  });

  it("TR-003 resumes cleanly after injected faults at git_sync, gate_verify, learning_record, slack_delivery and branch_cleanup", async () => {
    const harness = createHarness();
    const accepted = await harness.service.ingestWebhook({
      deliveryId: "del-faults",
      eventType: "pull_request",
      ...signWebhook(prWebhookPayload()),
      webhookSecret: SECRET,
    });
    expect(accepted.accepted).toBe(true);

    // Fault 1: git_sync fetch fails.
    vi.mocked(harness.vcs.fetchBranch).mockRejectedValueOnce(
      new Error("network unreachable"),
    );
    const attempt1 = await harness.service.resumeIncomplete("runner-1");
    expect(attempt1[0].status).toBe("running");
    expect(attempt1[0].pendingStages).toContain("git_sync");
    expect(harness.executor.verifyGatesAtCheckout).not.toHaveBeenCalled();

    // Fault 2: lease expires, git_sync succeeds, gate_verify throws transient error.
    advanceSeconds(120);
    vi.mocked(harness.executor.verifyGatesAtCheckout).mockRejectedValueOnce(
      new Error("runner crashed"),
    );
    const attempt2 = await harness
      .reopen()
      .service.resumeIncomplete("runner-2");
    expect(attempt2[0].status).toBe("running");
    expect(attempt2[0].pendingStages).not.toContain("git_sync");
    expect(attempt2[0].pendingStages).toContain("gate_verify");
    expect(harness.vcs.removeDetachedCheckout).toHaveBeenCalledTimes(1);

    // Fault 3: lease expires, git_sync is skipped, gate_verify succeeds, learning_record throws.
    advanceSeconds(120);
    vi.mocked(harness.executor.recordLearningAtCheckout).mockRejectedValueOnce(
      new Error("sqlite busy"),
    );
    const attempt3 = await harness
      .reopen()
      .service.resumeIncomplete("runner-3");
    expect(attempt3[0].status).toBe("running");
    expect(harness.vcs.fetchBranch).toHaveBeenCalledTimes(2); // not re-run on attempt 3
    expect(harness.executor.verifyGatesAtCheckout).toHaveBeenCalledTimes(2);
    expect(attempt3[0].pendingStages).toContain("learning_record");

    // Fault 4: lease expires, learning_record succeeds, Slack send times out -> uncertain / delivery_pending,
    // while branch_cleanup runs and succeeds independently.
    advanceSeconds(120);
    harness.notify.mockRejectedValueOnce(new Error("slack socket timeout"));
    const attempt4 = await harness
      .reopen()
      .service.resumeIncomplete("runner-4");
    expect(attempt4[0].status).toBe("delivery_pending");
    expect(attempt4[0].pendingStages).toEqual(["slack_delivery"]);
    expect(harness.executor.verifyGatesAtCheckout).toHaveBeenCalledTimes(2); // skipped!
    expect(harness.executor.recordLearningAtCheckout).toHaveBeenCalledTimes(2);
    expect(harness.vcs.deleteRemoteBranchAtTip).toHaveBeenCalledTimes(1);
    expect(harness.notify).toHaveBeenCalledTimes(1);

    // Fault 5: reconcile returns indeterminate -> stays delivery_pending, zero blind resends.
    advanceSeconds(120);
    const attempt5 = await harness
      .reopen()
      .service.resumeIncomplete("runner-5");
    expect(attempt5[0].status).toBe("delivery_pending");
    expect(harness.notify).toHaveBeenCalledTimes(1);
    expect(harness.reconcileDelivery).toHaveBeenCalledTimes(1);

    // Recovery: reconcile finds the already-delivered message -> completes without resending!
    advanceSeconds(120);
    harness.reconcileDelivery.mockResolvedValueOnce({
      status: "found",
      receipt: {
        delivered: true,
        channelId: "C1",
        messageTs: "1700000001.000100",
        threadTs: "1700000000.000000",
      },
    });
    const attempt6 = await harness
      .reopen()
      .service.resumeIncomplete("runner-6");
    expect(attempt6[0].status).toBe("completed");
    expect(attempt6[0].pendingStages).toEqual([]);
    expect(harness.notify).toHaveBeenCalledTimes(1);
    expect(harness.vcs.deleteRemoteBranchAtTip).toHaveBeenCalledTimes(1);
  });

  it("TR-003 converges branch_cleanup after crash following remote deletion", async () => {
    const harness = createHarness();
    const accepted = await harness.service.ingestWebhook({
      deliveryId: "del-cleanup-crash",
      eventType: "pull_request",
      ...signWebhook(prWebhookPayload()),
      webhookSecret: SECRET,
    });
    expect(accepted.accepted).toBe(true);

    // Simulate network drop right after remote branch deletion actually occurred.
    vi.mocked(harness.vcs.deleteRemoteBranchAtTip).mockRejectedValueOnce(
      new Error("connection reset after delete"),
    );
    const first = await harness.service.resumeIncomplete("runner-1");
    expect(first[0].status).toBe("running");
    expect(first[0].pendingStages).toEqual(["branch_cleanup"]);

    // On resume, remote branch is already gone -> already_deleted -> completed without re-deleting.
    advanceSeconds(120);
    vi.mocked(harness.vcs.getRemoteBranchSha).mockResolvedValueOnce(null);
    const second = await harness.reopen().service.resumeIncomplete("runner-2");
    expect(second[0].status).toBe("completed");
    expect(harness.vcs.deleteRemoteBranchAtTip).toHaveBeenCalledTimes(1);
  });

  it("TR-003 fences a stale harvest lease owner when a successor takes over", async () => {
    const harness = createHarness({ leaseDurationMs: 60_000 });
    await harness.service.ingestWebhook({
      deliveryId: "del-fence",
      eventType: "pull_request",
      ...signWebhook(prWebhookPayload()),
      webhookSecret: SECRET,
    });

    let resolveStaleGates!: (result: {
      passed: number;
      failed: number;
      total: number;
      failedTaskIds: string[];
    }) => void;
    vi.mocked(harness.executor.verifyGatesAtCheckout)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStaleGates = resolve;
          }),
      )
      .mockResolvedValueOnce({
        passed: 2,
        failed: 0,
        total: 2,
        failedTaskIds: [],
      });

    const staleRun = harness.service.resumeIncomplete("runner-1");
    await vi.waitFor(() =>
      expect(harness.executor.verifyGatesAtCheckout).toHaveBeenCalledTimes(1),
    );

    // Lease expires; runner-2 takes over under epoch 2 and finishes cleanly.
    advanceSeconds(120);
    const successor = await harness.service.resumeIncomplete("runner-2");
    expect(successor[0].status).toBe("completed");
    expect(harness.executor.recordLearningAtCheckout).toHaveBeenCalledTimes(1);
    expect(harness.notify).toHaveBeenCalledTimes(1);
    expect(harness.vcs.deleteRemoteBranchAtTip).toHaveBeenCalledTimes(1);

    // Stale runner-1 resolves gates; its stage transition is fenced and it runs NO later effects.
    resolveStaleGates({ passed: 2, failed: 0, total: 2, failedTaskIds: [] });
    await staleRun;

    expect(harness.executor.recordLearningAtCheckout).toHaveBeenCalledTimes(1);
    expect(harness.notify).toHaveBeenCalledTimes(1);
    expect(harness.vcs.deleteRemoteBranchAtTip).toHaveBeenCalledTimes(1);
  });

  it("TR-004 records closed unmerged PR as terminal closed_unmerged without promoting phase or cleaning branch", async () => {
    const harness = createHarness();
    const intake = await harness.service.ingestWebhook({
      deliveryId: "del-closed",
      eventType: "pull_request",
      ...signWebhook(prWebhookPayload({ merged: false, mergeCommitSha: null })),
      webhookSecret: SECRET,
    });
    expect(intake.accepted).toBe(true);

    const summaries = await harness.service.resumeIncomplete("runner-1");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      status: "closed_unmerged",
      pendingStages: [],
      failedStages: [],
    });
    expect(harness.vcs.fetchBranch).not.toHaveBeenCalled();
    expect(harness.executor.verifyGatesAtCheckout).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
    expect(harness.vcs.deleteRemoteBranchAtTip).not.toHaveBeenCalled();
    expect(harness.executor.recordLearningAtCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalEvent: "closed_unmerged",
        gatePassed: false,
      }),
    );

    const status = harness.store.getOperationsStatus(alphaProject.projectId);
    expect(status.harvest.closedUnmergedCount).toBe(1);
    expect(status.harvest.unresolvedGateFailures).toBe(0);
  });

  it("TR-004 records gate failure distinctly, skips phase promotion, and delivers harvest_gate_failed to feature thread", async () => {
    const harness = createHarness();
    await harness.service.ingestWebhook({
      deliveryId: "del-gate-fail",
      eventType: "pull_request",
      ...signWebhook(prWebhookPayload()),
      webhookSecret: SECRET,
    });
    vi.mocked(harness.executor.verifyGatesAtCheckout).mockResolvedValueOnce({
      passed: 1,
      failed: 1,
      total: 2,
      failedTaskIds: ["T002"],
    });

    const summaries = await harness.service.resumeIncomplete("runner-1");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].status).toBe("gate_failed");
    expect(summaries[0].failedStages).toContain("gate_verify");
    expect(harness.executor.recordLearningAtCheckout).not.toHaveBeenCalled();
    expect(harness.vcs.deleteRemoteBranchAtTip).not.toHaveBeenCalled();

    // Gate failure notice is delivered to the project's feature thread.
    expect(harness.notify).toHaveBeenCalledTimes(1);
    expect(harness.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: alphaProject.projectId,
        channel: "C1",
        threadTs: "1700000000.000000",
        text: expect.stringContaining("T002"),
      }),
    );

    const status = harness.store.getOperationsStatus(alphaProject.projectId);
    expect(status.harvest.unresolvedGateFailures).toBe(1);
    expect(status.harvest.closedUnmergedCount).toBe(0);
  });

  it("TR-004 blocks remote branch cleanup when the remote tip moved past expectedHeadSha", async () => {
    const harness = createHarness();
    await harness.service.ingestWebhook({
      deliveryId: "del-tip-moved",
      eventType: "pull_request",
      ...signWebhook(prWebhookPayload()),
      webhookSecret: SECRET,
    });
    vi.mocked(harness.vcs.getRemoteBranchSha).mockResolvedValueOnce(MOVED_SHA);

    const summaries = await harness.service.resumeIncomplete("runner-1");
    expect(summaries[0]).toMatchObject({
      status: "cleanup_blocked",
      failedStages: ["branch_cleanup"],
    });
    expect(harness.vcs.deleteRemoteBranchAtTip).not.toHaveBeenCalled();
    expect(
      harness.store.getOperationsStatus(alphaProject.projectId).harvest
        .blockedCleanups,
    ).toBe(1);
  });

  it("TR-004 blocks branch cleanup when atomic leased deletion detects tip movement", async () => {
    const harness = createHarness();
    await harness.service.ingestWebhook({
      deliveryId: "del-tip-race",
      eventType: "pull_request",
      ...signWebhook(prWebhookPayload()),
      webhookSecret: SECRET,
    });
    vi.mocked(harness.vcs.deleteRemoteBranchAtTip).mockResolvedValueOnce({
      deleted: false,
      reason: "tip_moved",
    });

    const summaries = await harness.service.resumeIncomplete("runner-1");
    expect(summaries[0]).toMatchObject({
      status: "cleanup_blocked",
      failedStages: ["branch_cleanup"],
    });
  });

  it("scopes manual local commit harvest across discovered phases, retries idempotently, and skips Slack and remote delete", async () => {
    const harness = createHarness();
    vi.mocked(harness.executor.discoverPhasesAtCheckout).mockResolvedValue([
      "phase-01",
      "phase-02",
    ]);

    const first = await harness.service.runManualHarvest({
      project: alphaProject,
      featureId: "049-durable",
      commitSha: MERGE_SHA,
      updateLocalTaskState: true,
      ownerId: "cli-1",
    });
    expect(first).toHaveLength(2);
    expect(first.every((s) => s.status === "completed")).toBe(true);
    expect(harness.notify).not.toHaveBeenCalled();
    expect(harness.vcs.deleteRemoteBranchAtTip).not.toHaveBeenCalled();
    expect(harness.executor.verifyGatesAtCheckout).toHaveBeenCalledTimes(2);

    // Retry later (clock advanced) reuses stable scoped delivery IDs without conflict or re-execution.
    advanceSeconds(300);
    const second = await harness.service.runManualHarvest({
      project: alphaProject,
      featureId: "049-durable",
      commitSha: MERGE_SHA,
      updateLocalTaskState: true,
      ownerId: "cli-2",
    });
    expect(second.map((s) => s.operationId)).toEqual(
      first.map((s) => s.operationId),
    );
    expect(second.every((s) => s.deduplicatedTransport)).toBe(true);
    expect(harness.executor.verifyGatesAtCheckout).toHaveBeenCalledTimes(2);
  });

  it("TR-002 rejects conflicting deliveryId payloads with HTTP 400 and correlates local-then-PR merges with late branch cleanup", async () => {
    const harness = createHarness();
    vi.mocked(harness.executor.discoverPhasesAtCheckout).mockResolvedValue([
      "phase-01",
    ]);

    // 1. Local manual commit completes without PR facts (branch_cleanup is skipped_no_target).
    const local = await harness.service.runManualHarvest({
      project: alphaProject,
      featureId: "049-durable",
      phaseId: "phase-01",
      commitSha: MERGE_SHA,
      updateLocalTaskState: false,
      ownerId: "cli-1",
    });
    expect(local).toHaveLength(1);
    expect(local[0].status).toBe("completed");
    expect(harness.vcs.deleteRemoteBranchAtTip).not.toHaveBeenCalled();

    // 2. Verified merged PR arrives later for the same commit -> reuses operationId and activates late branch_cleanup.
    const webhook = await harness.service.ingestWebhook({
      deliveryId: "del-late-pr",
      eventType: "pull_request",
      ...signWebhook(prWebhookPayload()),
      webhookSecret: SECRET,
    });
    expect(webhook.accepted).toBe(true);
    if (!webhook.accepted) return;
    expect(webhook.summary.operationId).toBe(local[0].operationId);
    expect(webhook.summary.deduplicatedWork).toBe(true);

    // Conflicting payload on the same deliveryId returns HTTP 400.
    const conflict = await harness.service.ingestWebhook({
      deliveryId: "del-late-pr",
      eventType: "pull_request",
      ...signWebhook(prWebhookPayload({ prNumber: 99 })),
      webhookSecret: SECRET,
    });
    expect(conflict).toEqual({
      accepted: false,
      httpStatus: 400,
      reason: "DELIVERY_ID_CONFLICT",
    });

    // Resume runs ONLY the newly activated branch_cleanup stage without re-running gates.
    advanceSeconds(120);
    const resumed = await harness.service.resumeIncomplete("runner-1");
    expect(resumed).toHaveLength(1);
    expect(resumed[0].operationId).toBe(local[0].operationId);
    expect(resumed[0].status).toBe("completed");
    expect(harness.executor.verifyGatesAtCheckout).toHaveBeenCalledTimes(1);
    expect(harness.vcs.deleteRemoteBranchAtTip).toHaveBeenCalledTimes(1);
  });

  it("TR-003 resends once with the same clientMetadataKey after confirmed_absent reconciliation", async () => {
    const harness = createHarness();
    await harness.service.ingestWebhook({
      deliveryId: "del-resend",
      eventType: "pull_request",
      ...signWebhook(prWebhookPayload()),
      webhookSecret: SECRET,
    });

    harness.notify.mockRejectedValueOnce(new Error("transient timeout"));
    const first = await harness.service.resumeIncomplete("runner-1");
    expect(first[0].status).toBe("delivery_pending");
    const firstKey = harness.notify.mock.calls[0]?.[0]?.clientMetadataKey;
    expect(firstKey).toBeTruthy();

    advanceSeconds(120);
    harness.reconcileDelivery.mockResolvedValueOnce({
      status: "confirmed_absent",
    });
    const second = await harness.reopen().service.resumeIncomplete("runner-2");
    expect(second[0].status).toBe("completed");
    expect(harness.notify).toHaveBeenCalledTimes(2);
    expect(harness.notify.mock.calls[1]?.[0]?.clientMetadataKey).toBe(firstKey);
  });

  it("TR-002 scopes whole-feature merged PRs and enforces requested phase coverage", async () => {
    const harness = createHarness();
    vi.mocked(harness.executor.discoverPhasesAtCheckout).mockResolvedValue([
      "phase-01",
      "phase-02",
    ]);
    vi.mocked(harness.github.getPullRequest).mockResolvedValue(
      prFact({ headBranch: "feat/049-durable", prNumber: 55 }),
    );

    await expect(
      harness.service.runManualHarvest({
        project: alphaProject,
        featureId: "049-durable",
        phaseId: "phase-99",
        prNumber: 55,
        updateLocalTaskState: false,
        ownerId: "cli-1",
      }),
    ).rejects.toThrow(/not covered/i);

    const single = await harness.service.runManualHarvest({
      project: alphaProject,
      featureId: "049-durable",
      phaseId: "phase-02",
      prNumber: 55,
      updateLocalTaskState: false,
      ownerId: "cli-1",
    });
    expect(single).toHaveLength(1);
    expect(single[0].status).toBe("completed");
    expect(harness.executor.verifyGatesAtCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ phaseId: "phase-02" }),
    );
  });

  it("routes harvestFeature through DurableHarvestService and HarvestExecutionAdapter on a real enrolled git checkout", async () => {
    const repoDir = alphaProject.localRoot!;
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
    execFileSync("git", ["checkout", "-q", "-b", "main"], { cwd: repoDir });

    const featureDir = join(repoDir, "specs", "049-real");
    mkdirSync(join(featureDir, ".gwrk", "runs"), { recursive: true });
    writeFileSync(
      join(featureDir, "plan.md"),
      "# Plan\n\n### Phase 1: Durable core\n\n**Story Points**: 3 SP\n",
    );
    writeFileSync(
      join(featureDir, ".gwrk", "tasks.json"),
      JSON.stringify(
        {
          featureId: "049-real",
          createdAt: time,
          phases: [
            {
              id: "phase-01",
              title: "Durable core",
              tasks: [
                {
                  id: "T001",
                  title: "Pass gate",
                  description: "",
                  status: "open",
                  gateScript: "true",
                },
              ],
            },
          ],
        },
        null,
        2,
      ),
    );
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["commit", "-q", "-m", "feat: add 049-real"], {
      cwd: repoDir,
    });
    const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
      encoding: "utf8",
    }).trim();

    // Verify adapter discovers phases and records evidence directly.
    const adapter = createHarvestExecutionAdapter({ db });
    expect(await adapter.discoverPhasesAtCheckout(repoDir, "049-real")).toEqual(
      ["phase-01"],
    );

    // Run harvestFeature routed through DurableHarvestService on the real enrolled repo.
    await harvestFeature(
      repoDir,
      {
        featureId: "049-real",
        phaseId: "phase-01",
        prNumber: 0,
        prUrl: "",
        mergeCommitSha: commitSha,
        mergedAt: time,
        mergedBy: "manual",
        status: "merged",
      },
      { db, project: alphaProject, updateLocalTaskState: false },
    );

    const gates = getGateResults(
      "049-real",
      "phase-01",
      alphaProject.projectId,
      db,
    );
    expect(gates).toHaveLength(1);
    expect(gates[0].passed).toBe(1);
    const runs = listRuns("049-real", alphaProject.projectId, db);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("merged");
    expect(runs[0].merge_commit_sha).toBe(commitSha);
  });
});
