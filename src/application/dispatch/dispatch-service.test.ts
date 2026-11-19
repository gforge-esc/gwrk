/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveProjectId } from "../../adapters/git/index.js";
import {
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../../adapters/sqlite/index.js";
import { openDatabase } from "../../db/index.js";
import type { WorkerRecoveryEvidence } from "../../domain/durable-dispatch.js";
import type { EnrolledProject } from "../../domain/project-registry.js";
import type { WorkerExecutionPort } from "../../ports/operations-port.js";
import { createDurableDispatchService } from "./index.js";

let root: string;
let dbPath: string;
let db: ReturnType<typeof openDatabase>;
let time: string;
let alphaProject: EnrolledProject;
let betaProject: EnrolledProject;

function createEnrolledRepo(
  baseDir: string,
  slug: string,
  repoSlug: string,
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
    slack: { workspaceId: "W1", channelId, sharedChannel: false },
    legacyProjectIds: [],
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
  };
}

const stoppedNoPrEvidence: WorkerRecoveryEvidence = {
  workerState: "stopped",
  pullRequestLookup: "complete",
  openPullRequest: null,
  mergedPullRequest: null,
  completedManifestRunId: null,
  sandboxDir: null,
};

function advanceSeconds(seconds: number): void {
  time = new Date(Date.parse(time) + seconds * 1000).toISOString();
}

function createHarness(options?: {
  leaseDurationMs?: number;
  maxCrashRecoveryAttempts?: number;
  onRecoveredMerge?: (input: {
    project: EnrolledProject;
    prNumber: number;
    prUrl: string;
    mergeCommitSha: string;
  }) => Promise<void> | void;
}) {
  let idSeq = 0;
  const inspectRecoveredWork = vi
    .fn<WorkerExecutionPort["inspectRecoveredWork"]>()
    .mockResolvedValue(stoppedNoPrEvidence);
  const launchPhaseShip = vi
    .fn<WorkerExecutionPort["launchPhaseShip"]>()
    .mockResolvedValue({
      exitCode: 0,
      stderr: "",
      prNumber: 101,
      prUrl: "https://github.com/acme/alpha/pull/101",
    });
  const cleanupStaleSandbox = vi
    .fn<WorkerExecutionPort["cleanupStaleSandbox"]>()
    .mockResolvedValue(undefined);

  const build = () => {
    const store = createSqliteOperationsStoreAdapter({ db });
    const registry = createSqliteProjectRegistryAdapter({ db });
    const service = createDurableDispatchService({
      store,
      registry,
      worker: { inspectRecoveredWork, launchPhaseShip, cleanupStaleSandbox },
      clock: { nowIso: () => time, nowMs: () => Date.parse(time) },
      newId: () => `disp-${++idSeq}`,
      leaseDurationMs: options?.leaseDurationMs ?? 60_000,
      maxCrashRecoveryAttempts: options?.maxCrashRecoveryAttempts ?? 3,
      onRecoveredMerge: options?.onRecoveredMerge,
    });
    return { service, store, registry };
  };

  const reopen = () => {
    db.close();
    db = openDatabase({ dbPath });
    return build();
  };

  return {
    ...build(),
    reopen,
    inspectRecoveredWork,
    launchPhaseShip,
    cleanupStaleSandbox,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gwrk-dispatch-service-"));
  dbPath = join(root, "ledger.sqlite");
  db = openDatabase({ dbPath });
  time = "2026-11-18T00:00:00.000Z";
  alphaProject = createEnrolledRepo(root, "alpha", "acme/alpha", "C1");
  betaProject = createEnrolledRepo(root, "beta", "acme/beta", "C2");
  const registry = createSqliteProjectRegistryAdapter({ db });
  registry.enrollProject(alphaProject);
  registry.enrollProject(betaProject);
});

afterEach(() => {
  if (db.open) db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("DurableDispatchService", () => {
  it("TR-001 persists acceptance before acknowledgement, deduplicates active work keys, and executes once after restart", async () => {
    const harness = createHarness();
    const first = harness.service.accept({
      project: alphaProject,
      featureId: "049-durable",
      phaseId: "phase-04",
      taskIds: ["T002", "T001"],
      backend: "claude",
      recipient: {
        projectId: alphaProject.projectId,
        surface: "slack",
        workspaceId: "W1",
        channelId: "C1",
      },
    });
    const duplicate = harness.service.accept({
      project: alphaProject,
      featureId: "049-durable",
      phaseId: "phase-04",
      taskIds: ["T001", "T002"],
      backend: "claude",
    });
    const otherProject = harness.service.accept({
      project: betaProject,
      featureId: "049-durable",
      phaseId: "phase-04",
      taskIds: ["T001", "T002"],
      backend: "claude",
    });

    expect(first.deduplicated).toBe(false);
    expect(duplicate.deduplicated).toBe(true);
    expect(duplicate.operationId).toBe(first.operationId);
    expect(otherProject.deduplicated).toBe(false);
    expect(otherProject.operationId).not.toBe(first.operationId);

    // Simulate process crash after durable acceptance and before worker launch.
    const restarted = harness.reopen();
    const recovery = await restarted.service.recoverOnStartup("coord-2");
    expect(recovery).toEqual({
      requeuedCount: 0,
      completedFromPrCount: 0,
      failedCount: 0,
    });
    expect(harness.inspectRecoveredWork).not.toHaveBeenCalled();

    await restarted.service.drainReady("coord-2", 2);
    expect(harness.launchPhaseShip).toHaveBeenCalledTimes(2);
    expect(harness.launchPhaseShip).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: alphaProject.localRoot,
        trunkBranch: "main",
        branchName: first.branchName,
        featureId: "049-durable",
        phaseId: "phase-04",
        backend: "claude",
        taskIds: ["T001", "T002"],
      }),
    );

    const saved = restarted.service.getOperation(
      alphaProject.projectId,
      "049-durable",
      "phase-04",
    );
    expect(saved?.status).toBe("completed");
    expect(saved?.prNumber).toBe(101);

    // Subsequent drain does not relaunch completed work.
    await restarted.service.drainReady("coord-2", 2);
    expect(harness.launchPhaseShip).toHaveBeenCalledTimes(2);
  });

  it("TR-001 completes stale lease from an existing open or merged PR without launching a second worker", async () => {
    const onRecoveredMerge = vi.fn();
    const harness = createHarness({ onRecoveredMerge });
    const receipt = harness.service.accept({
      project: alphaProject,
      featureId: "049-durable",
      phaseId: "phase-04",
      backend: "codex",
    });

    // Simulate Worker 1 acquiring a lease, opening and merging a PR, then crashing.
    const lease = harness.store.claimDispatchLease({
      operationId: receipt.operationId,
      leaseOwner: "worker-1",
      nowIso: time,
      leaseExpiresAt: new Date(Date.parse(time) + 60_000).toISOString(),
    });
    expect(lease).not.toBeNull();
    advanceSeconds(120);

    const mergeSha = "a".repeat(40);
    harness.inspectRecoveredWork.mockResolvedValueOnce({
      workerState: "stopped",
      pullRequestLookup: "complete",
      openPullRequest: null,
      mergedPullRequest: {
        operationId: receipt.operationId,
        prNumber: 77,
        prUrl: "https://github.com/acme/alpha/pull/77",
        mergeCommitSha: mergeSha,
      },
      completedManifestRunId: null,
      sandboxDir: "/tmp/sandbox-1",
    });

    const restarted = harness.reopen();
    const summary = await restarted.service.recoverOnStartup("coord-2");
    expect(summary).toEqual({
      requeuedCount: 0,
      completedFromPrCount: 1,
      failedCount: 0,
    });
    expect(onRecoveredMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({ projectId: alphaProject.projectId }),
        prNumber: 77,
        prUrl: "https://github.com/acme/alpha/pull/77",
        mergeCommitSha: mergeSha,
      }),
    );

    await restarted.service.drainReady("coord-2", 2);
    expect(harness.launchPhaseShip).not.toHaveBeenCalled();

    const op = restarted.service.getOperation(
      alphaProject.projectId,
      "049-durable",
      "phase-04",
    );
    expect(op).toMatchObject({
      operationId: receipt.operationId,
      status: "completed",
      prNumber: 77,
      prUrl: "https://github.com/acme/alpha/pull/77",
    });
    expect(
      restarted.store.getOperationsStatus(alphaProject.projectId).queue
        .staleLeasesReconciled,
    ).toBe(1);
  });

  it.each([
    [
      "running worker",
      {
        ...stoppedNoPrEvidence,
        workerState: "running" as const,
      },
    ],
    [
      "unknown worker",
      {
        ...stoppedNoPrEvidence,
        workerState: "unknown" as const,
      },
    ],
    [
      "unavailable PR lookup",
      {
        ...stoppedNoPrEvidence,
        pullRequestLookup: "unavailable" as const,
      },
    ],
    [
      "unverified PR ownership",
      {
        ...stoppedNoPrEvidence,
        openPullRequest: {
          operationId: null,
          prNumber: 88,
          prUrl: "https://github.com/acme/alpha/pull/88",
        },
      },
    ],
  ])(
    "TR-001 refuses to relaunch stale lease with %s",
    async (_label, evidence) => {
      const harness = createHarness();
      const receipt = harness.service.accept({
        project: alphaProject,
        featureId: "049-durable",
        phaseId: "phase-04",
        backend: "claude",
      });
      harness.store.claimDispatchLease({
        operationId: receipt.operationId,
        leaseOwner: "worker-1",
        nowIso: time,
        leaseExpiresAt: new Date(Date.parse(time) + 60_000).toISOString(),
      });
      advanceSeconds(120);

      harness.inspectRecoveredWork.mockResolvedValueOnce(evidence);
      const restarted = harness.reopen();
      const summary = await restarted.service.recoverOnStartup("coord-2");
      expect(summary).toEqual({
        requeuedCount: 0,
        completedFromPrCount: 0,
        failedCount: 0,
      });

      await restarted.service.drainReady("coord-2", 2);
      expect(harness.launchPhaseShip).not.toHaveBeenCalled();

      const op = restarted.service.getOperation(
        alphaProject.projectId,
        "049-durable",
        "phase-04",
      );
      expect(op?.status).toBe("leased");
      expect(op?.leaseEpoch).toBe(1);
    },
  );

  it("TR-001 leaves stale lease pending when inspectRecoveredWork throws", async () => {
    const harness = createHarness();
    const receipt = harness.service.accept({
      project: alphaProject,
      featureId: "049-durable",
      phaseId: "phase-04",
      backend: "claude",
    });
    harness.store.claimDispatchLease({
      operationId: receipt.operationId,
      leaseOwner: "worker-1",
      nowIso: time,
      leaseExpiresAt: new Date(Date.parse(time) + 60_000).toISOString(),
    });
    advanceSeconds(120);

    harness.inspectRecoveredWork.mockRejectedValueOnce(
      new Error("GitHub API timeout"),
    );
    const restarted = harness.reopen();
    const summary = await restarted.service.recoverOnStartup("coord-2");
    expect(summary).toEqual({
      requeuedCount: 0,
      completedFromPrCount: 0,
      failedCount: 0,
    });
    await restarted.service.drainReady("coord-2", 2);
    expect(harness.launchPhaseShip).not.toHaveBeenCalled();
  });

  it("TR-001 cleans up stale sandbox and requeues confirmed stopped worker under a new leaseEpoch", async () => {
    const harness = createHarness();
    const receipt = harness.service.accept({
      project: alphaProject,
      featureId: "049-durable",
      phaseId: "phase-04",
      backend: "claude",
    });
    harness.store.claimDispatchLease({
      operationId: receipt.operationId,
      leaseOwner: "worker-1",
      nowIso: time,
      leaseExpiresAt: new Date(Date.parse(time) + 60_000).toISOString(),
    });
    advanceSeconds(120);

    harness.inspectRecoveredWork.mockResolvedValueOnce({
      ...stoppedNoPrEvidence,
      sandboxDir: "/tmp/stale-sandbox",
    });
    const restarted = harness.reopen();
    const summary = await restarted.service.recoverOnStartup("coord-2");
    expect(summary).toEqual({
      requeuedCount: 1,
      completedFromPrCount: 0,
      failedCount: 0,
    });
    expect(harness.cleanupStaleSandbox).toHaveBeenCalledWith(
      alphaProject.localRoot,
      "/tmp/stale-sandbox",
      "049-durable",
    );

    await restarted.service.drainReady("coord-2", 2);
    expect(harness.launchPhaseShip).toHaveBeenCalledTimes(1);
    const op = restarted.service.getOperation(
      alphaProject.projectId,
      "049-durable",
      "phase-04",
    );
    expect(op?.status).toBe("completed");
    expect(op?.leaseEpoch).toBeGreaterThan(1);
  });

  it("TR-001 fails exhausted stale dispatch without relaunching", async () => {
    const harness = createHarness({ maxCrashRecoveryAttempts: 1 });
    const receipt = harness.service.accept({
      project: alphaProject,
      featureId: "049-durable",
      phaseId: "phase-04",
      backend: "claude",
    });
    harness.store.claimDispatchLease({
      operationId: receipt.operationId,
      leaseOwner: "worker-1",
      nowIso: time,
      leaseExpiresAt: new Date(Date.parse(time) + 60_000).toISOString(),
    });
    advanceSeconds(120);

    const restarted = harness.reopen();
    const summary = await restarted.service.recoverOnStartup("coord-2");
    expect(summary).toEqual({
      requeuedCount: 0,
      completedFromPrCount: 0,
      failedCount: 1,
    });

    await restarted.service.drainReady("coord-2", 2);
    expect(harness.launchPhaseShip).not.toHaveBeenCalled();
    expect(
      restarted.service.getOperation(
        alphaProject.projectId,
        "049-durable",
        "phase-04",
      )?.status,
    ).toBe("failed");
  });

  it("TR-003 fences a late worker completion across competing lease epochs", async () => {
    const harness = createHarness({ leaseDurationMs: 60_000 });
    const receipt = harness.service.accept({
      project: alphaProject,
      featureId: "049-durable",
      phaseId: "phase-04",
      backend: "claude",
    });

    let resolveStaleWorker!: (value: {
      exitCode: number;
      stderr: string;
      prNumber: number;
      prUrl: string;
    }) => void;
    harness.launchPhaseShip
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStaleWorker = resolve;
          }),
      )
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: "",
        prNumber: 202,
        prUrl: "https://github.com/acme/alpha/pull/202",
      });

    const staleRun = harness.service.drainReady("coord-1", 1);
    await vi.waitFor(() =>
      expect(harness.launchPhaseShip).toHaveBeenCalledTimes(1),
    );

    // Expire Worker 1's lease and let Coordinator 2 recover and run Worker 2.
    advanceSeconds(120);
    const recovery = await harness.service.recoverOnStartup("coord-2");
    expect(recovery.requeuedCount).toBe(1);
    await harness.service.drainReady("coord-2", 1);

    expect(
      harness.service.getOperation(
        alphaProject.projectId,
        "049-durable",
        "phase-04",
      ),
    ).toMatchObject({
      operationId: receipt.operationId,
      status: "completed",
      prNumber: 202,
      prUrl: "https://github.com/acme/alpha/pull/202",
    });

    // Stale Worker 1 wakes up and tries to report failure or another PR.
    resolveStaleWorker({
      exitCode: 1,
      stderr: "stale worker failed",
      prNumber: 101,
      prUrl: "https://github.com/acme/alpha/pull/101",
    });
    await staleRun;

    // Successor's completed state is preserved.
    expect(
      harness.service.getOperation(
        alphaProject.projectId,
        "049-durable",
        "phase-04",
      ),
    ).toMatchObject({
      operationId: receipt.operationId,
      status: "completed",
      prNumber: 202,
      prUrl: "https://github.com/acme/alpha/pull/202",
    });
  });

  it("enforces maxConcurrent while draining multiple accepted dispatches", async () => {
    const harness = createHarness();
    for (const phaseId of ["phase-01", "phase-02", "phase-03"]) {
      harness.service.accept({
        project: alphaProject,
        featureId: "049-durable",
        phaseId,
        backend: "claude",
      });
    }

    let inFlight = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];
    harness.launchPhaseShip.mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          resolvers.push(() => {
            inFlight--;
            resolve({ exitCode: 0, stderr: "" });
          });
        }),
    );

    const draining = harness.service.drainReady("coord-1", 2);
    await vi.waitFor(() => expect(resolvers.length).toBe(2));
    expect(peak).toBe(2);

    resolvers.shift()?.();
    await vi.waitFor(() =>
      expect(harness.launchPhaseShip).toHaveBeenCalledTimes(3),
    );
    expect(peak).toBe(2);

    while (resolvers.length) resolvers.shift()?.();
    await draining;
    expect(inFlight).toBe(0);
  });

  it("TR-001 does not strand a stale dispatch under a new live lease when sandbox cleanup fails transiently", async () => {
    const harness = createHarness({
      leaseDurationMs: 60_000,
      maxCrashRecoveryAttempts: 2,
    });
    const receipt = harness.service.accept({
      project: alphaProject,
      featureId: "049-durable",
      phaseId: "phase-04",
      backend: "claude",
    });
    harness.store.claimDispatchLease({
      operationId: receipt.operationId,
      leaseOwner: "worker-1",
      nowIso: time,
      leaseExpiresAt: new Date(Date.parse(time) + 60_000).toISOString(),
    });
    advanceSeconds(120);

    harness.inspectRecoveredWork.mockResolvedValue({
      ...stoppedNoPrEvidence,
      sandboxDir: "/tmp/busy-sandbox",
    });
    harness.cleanupStaleSandbox
      .mockRejectedValueOnce(new Error("EBUSY: sandbox locked"))
      .mockResolvedValueOnce(undefined);

    const firstAttempt = await harness.service.recoverOnStartup("coord-2");
    expect(firstAttempt).toEqual({
      requeuedCount: 0,
      completedFromPrCount: 0,
      failedCount: 0,
    });

    // Immediate retry (without waiting for a 60s lease expiry) must recover and requeue.
    const opAfterFailure = harness.service.getOperation(
      alphaProject.projectId,
      "049-durable",
      "phase-04",
    );
    expect(opAfterFailure?.leaseEpoch).toBe(1);
    expect(opAfterFailure?.attemptCount).toBe(1);

    const retryAttempt = await harness.service.recoverOnStartup("coord-2");
    expect(retryAttempt).toEqual({
      requeuedCount: 1,
      completedFromPrCount: 0,
      failedCount: 0,
    });
  });

  it("TR-003 concurrent recoverOnStartup does not hijack an already-requeued operation or fail it prematurely", async () => {
    const harness = createHarness({
      leaseDurationMs: 60_000,
      maxCrashRecoveryAttempts: 2,
    });
    const receipt = harness.service.accept({
      project: alphaProject,
      featureId: "049-durable",
      phaseId: "phase-04",
      backend: "claude",
    });
    harness.store.claimDispatchLease({
      operationId: receipt.operationId,
      leaseOwner: "worker-1",
      nowIso: time,
      leaseExpiresAt: new Date(Date.parse(time) + 60_000).toISOString(),
    });
    advanceSeconds(120);

    let releaseCoordA!: (evidence: WorkerRecoveryEvidence) => void;
    harness.inspectRecoveredWork
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseCoordA = resolve;
          }),
      )
      .mockResolvedValue(stoppedNoPrEvidence);

    const coordARecovery = harness.service.recoverOnStartup("coord-a");
    await vi.waitFor(() =>
      expect(harness.inspectRecoveredWork).toHaveBeenCalledTimes(1),
    );

    // Coord B recovers and requeues the expired operation to "accepted".
    const coordBResult = await harness.service.recoverOnStartup("coord-b");
    expect(coordBResult).toEqual({
      requeuedCount: 1,
      completedFromPrCount: 0,
      failedCount: 0,
    });

    // Coord A's stale inspection finishes after Coord B already requeued the operation.
    releaseCoordA(stoppedNoPrEvidence);
    const coordAResult = await coordARecovery;
    expect(coordAResult.failedCount).toBe(0);

    const op = harness.service.getOperation(
      alphaProject.projectId,
      "049-durable",
      "phase-04",
    );
    expect(op?.status).toBe("accepted");
  });
});
