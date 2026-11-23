/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Mock,
  type Mocked,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { resolveProjectId } from "../adapters/git/project-id.js";
import {
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";
import { openDatabase } from "../db/index.js";
import { finishRun } from "../db/runs.js";
import { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import type { NotificationPort } from "../ports/notification-port.js";
import type {
  GitHubHarvestPort,
  WorkerExecutionPort,
} from "../ports/operations-port.js";
import type { GwrkConfig } from "../utils/config.js";
import { DispatchQueue } from "./dispatch.js";
import { SystemMonitor } from "./monitor.js";
import { persistDispatch } from "./persistence.js";
import { SandboxManager } from "./sandbox.js";
import { notifySlack } from "./slack-notify.js";

vi.mock("./monitor.js");
vi.mock("./sandbox.js");
vi.mock("./persistence.js");
vi.mock("./slack-notify.js");
// The daemon now drives the SAME unified ShipOrchestrator the CLI uses; mock it
// (factory form, so the real engine module and its dependency chain never load)
// to assert wiring — worktree → engine → PR → teardown — without running a real
// ship (agents, git, PRs).
vi.mock("../engine/ship-orchestrator.js", () => ({
  ShipOrchestrator: vi.fn(),
}));
vi.mock("../db/runs.js", () => ({
  startRun: vi.fn().mockReturnValue(123),
  finishRun: vi.fn(),
}));

describe("DispatchQueue (unified ship engine)", () => {
  let queue: DispatchQueue;
  let mockMonitor: Mocked<SystemMonitor>;
  let mockSandbox: Mocked<SandboxManager>;
  let mockRun: Mock;
  let mockGetResult: Mock;
  const projectRoot = "/proj";

  const mockConfig: GwrkConfig = {
    project: { name: "test" },
    agents: { define: "gemini", implement: "gemini" },
    server: {
      port: 18790,
      host: "localhost",
      heartbeatIntervalMs: 1000,
      networkCheckIntervalMs: 1000,
    },
    parallelism: {
      local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
      cloud: { maxConcurrent: 10 },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMonitor = new SystemMonitor() as Mocked<SystemMonitor>;
    mockSandbox = new SandboxManager(projectRoot) as Mocked<SandboxManager>;
    mockSandbox.createSandbox.mockResolvedValue("/work/dir");
    mockSandbox.destroySandbox.mockResolvedValue(undefined);

    mockRun = vi.fn().mockResolvedValue(0);
    mockGetResult = vi.fn().mockReturnValue({
      stage: "DONE",
      prNumber: 42,
      prUrl: "https://example.com/pr/42",
    });
    (ShipOrchestrator as unknown as Mock).mockImplementation(() => ({
      run: mockRun,
      getResult: mockGetResult,
    }));

    queue = new DispatchQueue(
      mockConfig,
      mockMonitor,
      mockSandbox,
      projectRoot,
    );
  });

  it("enqueues a feature-phase on a per-phase ship branch", () => {
    mockMonitor.isThrottled.mockReturnValue(true); // keep it queued
    const record = queue.enqueue({
      featureId: "feat-1",
      phaseId: "phase-01",
      taskId: "T1",
    });
    expect(record.status).toBe("queued");
    // Per-phase branch so concurrent phases never collide and harvest can parse it.
    expect(record.branchName).toBe("feat/feat-1-phase-01");
    expect(queue.getQueueDepth()).toBe(1);
  });

  it("drives the unified ShipOrchestrator in an isolated worktree and PRs to develop on success", async () => {
    mockMonitor.isThrottled.mockReturnValue(false);
    const record = queue.enqueue({ featureId: "feat-1", phaseId: "phase-01" });

    await vi.waitFor(() => {
      if (record.status !== "completed") throw new Error("not completed yet");
    });

    // Worktree created on the per-phase ship branch, based on develop.
    expect(mockSandbox.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        featureId: "feat-1",
        phaseId: "phase-01",
        taskId: "ship",
        baseBranch: "develop",
        branchName: "feat/feat-1-phase-01",
        projectRoot,
      }),
    );

    // The full lifecycle ran via the shared engine, INSIDE the worktree, with
    // crash state kept in the primary checkout.
    expect(ShipOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        featureId: "feat-1",
        phaseId: "phase-01",
        cwd: "/work/dir",
        stateRoot: projectRoot,
        branchName: "feat/feat-1-phase-01",
      }),
    );
    expect(mockRun).toHaveBeenCalledTimes(1);

    // PR metadata surfaced from the engine result (no local merge-back).
    expect(record.prNumber).toBe(42);
    expect(record.prUrl).toBe("https://example.com/pr/42");

    // Review-ready CTA fired; the engine already opened the PR.
    expect(notifySlack).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "review_ready" }),
      {
        projectRoot,
        signal: expect.any(AbortSignal),
        transportTimeoutMs: 5000,
      },
    );

    // Worktree torn down WITHOUT auto commit/push/PR — the engine owns the PR.
    expect(mockSandbox.destroySandbox).toHaveBeenCalledWith(
      "/work/dir",
      "feat-1",
      { autoCommitPush: false },
    );

    expect(queue.getCompletedCount()).toBe(1);
    expect(queue.getActiveCount()).toBe(0);
  });

  it.each([
    { exitCode: 0, status: "completed", eventType: "review_ready" },
    { exitCode: 1, status: "failed", eventType: "phase_fail" },
  ])(
    "journals a $status dispatch and releases its slot while Slack is pending",
    async ({ exitCode, status, eventType }) => {
      let startNotice!: () => void;
      let finishNotice!: () => void;
      const noticeStarted = new Promise<void>((resolve) => {
        startNotice = resolve;
      });
      const providerFinished = vi.fn();
      const noticePending = new Promise<void>((resolve) => {
        finishNotice = resolve;
      });
      vi.mocked(notifySlack).mockImplementationOnce(
        async (_message, _event, options) => {
          startNotice();
          try {
            await Promise.race([
              noticePending,
              new Promise<void>((resolve) => {
                options?.signal?.addEventListener("abort", () => resolve(), {
                  once: true,
                });
              }),
            ]);
          } finally {
            providerFinished(options?.signal?.aborted);
          }
        },
      );
      const journalTerminal = vi.fn();
      mockRun.mockImplementationOnce(async () => {
        vi.mocked(persistDispatch).mockImplementationOnce(journalTerminal);
        return exitCode;
      });
      mockMonitor.isThrottled.mockReturnValue(false);
      vi.useFakeTimers();
      const record = queue.enqueue({
        featureId: "feat-1",
        phaseId: "phase-01",
      });
      try {
        await noticeStarted;
        expect.soft(journalTerminal).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            id: record.id,
            status,
            workDir: undefined,
          }),
          projectRoot,
        );
        expect
          .soft(finishRun)
          .toHaveBeenCalledExactlyOnceWith(
            123,
            expect.objectContaining({ exit_code: exitCode }),
            undefined,
          );
        expect
          .soft(notifySlack)
          .toHaveBeenCalledExactlyOnceWith(
            expect.anything(),
            expect.objectContaining({ type: eventType }),
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
          );
        expect.soft(mockSandbox.destroySandbox).toHaveBeenCalledOnce();
        expect.soft(queue.getActiveCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(5_001);
        expect.soft(providerFinished).not.toHaveBeenCalled();
        await queue.close();
        expect(providerFinished).toHaveBeenCalledExactlyOnceWith(true);
      } finally {
        finishNotice();
        await queue.close();
        vi.useRealTimers();
      }
    },
  );

  it("marks the dispatch failed and still tears down the worktree when the engine exits non-zero", async () => {
    mockMonitor.isThrottled.mockReturnValue(false);
    mockRun.mockResolvedValue(1);

    const record = queue.enqueue({ featureId: "feat-1", phaseId: "phase-01" });

    await vi.waitFor(() => {
      if (record.status !== "failed") throw new Error("not failed yet");
    });

    expect(queue.getFailedCount()).toBe(1);
    expect(notifySlack).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "phase_fail" }),
      {
        projectRoot,
        signal: expect.any(AbortSignal),
        transportTimeoutMs: 5000,
      },
    );
    expect(mockSandbox.destroySandbox).toHaveBeenCalledWith(
      "/work/dir",
      "feat-1",
      { autoCommitPush: false },
    );
  });

  it("tears down the worktree when the engine throws", async () => {
    mockMonitor.isThrottled.mockReturnValue(false);
    mockRun.mockRejectedValue(new Error("boom"));

    const record = queue.enqueue({ featureId: "feat-1", phaseId: "phase-01" });

    await vi.waitFor(() => {
      if (record.status !== "failed") throw new Error("not failed yet");
    });

    expect(mockSandbox.destroySandbox).toHaveBeenCalledWith(
      "/work/dir",
      "feat-1",
      { autoCommitPush: false },
    );
  });

  it("bounds concurrent ships by parallelism.local.maxClones", () => {
    mockMonitor.isThrottled.mockReturnValue(false);
    // Never-resolving run() keeps ships active so the gate is observable.
    mockRun.mockReturnValue(new Promise<number>(() => {}));

    queue.enqueue({ featureId: "f1", phaseId: "phase-01" });
    queue.enqueue({ featureId: "f2", phaseId: "phase-01" });
    queue.enqueue({ featureId: "f3", phaseId: "phase-01" });

    // maxClones = 2: two ships active, the third waits in the queue.
    expect(queue.getActiveCount()).toBe(2);
    expect(queue.getQueueDepth()).toBe(1);
  });

  it("does not process while throttled", async () => {
    mockMonitor.isThrottled.mockReturnValue(true);

    queue.enqueue({ featureId: "feat-1", phaseId: "phase-01" });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(queue.getActiveCount()).toBe(0);
    expect(queue.getQueueDepth()).toBe(1);
    expect(mockSandbox.createSandbox).not.toHaveBeenCalled();
  });

  it("rejects new and duplicate dispatches as soon as close starts", async () => {
    let finishShip!: (exitCode: number) => void;
    mockRun.mockReturnValue(
      new Promise<number>((resolve) => {
        finishShip = resolve;
      }),
    );
    const active = { featureId: "feat-1", phaseId: "phase-01" };
    const next = { featureId: "feat-2", phaseId: "phase-01" };
    queue.enqueue(active);
    await vi.waitFor(() => expect(mockRun).toHaveBeenCalledOnce());

    const closing = queue.close();
    try {
      const writes = vi.mocked(persistDispatch).mock.calls.length;
      expect(() => queue.enqueue(active)).toThrow("Dispatch queue is closed");
      expect(() => queue.enqueue(next)).toThrow("Dispatch queue is closed");
      expect(queue.getQueueDepth()).toBe(0);
      expect(persistDispatch).toHaveBeenCalledTimes(writes);
    } finally {
      finishShip(0);
      await closing;
    }

    const writes = vi.mocked(persistDispatch).mock.calls.length;
    expect(() => queue.enqueue(next)).toThrow("Dispatch queue is closed");
    expect(queue.getQueueDepth()).toBe(0);
    expect(persistDispatch).toHaveBeenCalledTimes(writes);
  });

  it("returns queue status", () => {
    mockMonitor.isThrottled.mockReturnValue(true);
    queue.enqueue({ featureId: "feat-1", phaseId: "phase-01", taskId: "T1" });

    const status = queue.getQueue();
    expect(status.throttled).toBe(true);
    expect(status.paused).toBe(false);
    expect(status.queued.length).toBe(1);
  });

  it("finds a dispatch by feature and phase", () => {
    mockMonitor.isThrottled.mockReturnValue(true);
    const record = queue.enqueue({
      featureId: "feat-1",
      phaseId: "phase-01",
      taskId: "T1",
    });
    expect(queue.getDispatch("feat-1", "phase-01", "T1")).toBe(record);
    expect(queue.getDispatch("feat-2", "phase-01", "T1")).toBeNull();
  });
});

describe("DispatchQueue (durable SQLite backing, recovery & outbox notifications)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function setupDurableEnv(opts?: { withSlack?: boolean }) {
    const tempRoot = mkdtempSync(join(tmpdir(), "gwrk-durable-queue-"));
    tempDirs.push(tempRoot);
    const repoRoot = join(tempRoot, "repo");
    mkdirSync(repoRoot, { recursive: true });
    execFileSync("git", ["init", "--quiet", "--initial-branch=develop"], {
      cwd: repoRoot,
      stdio: "ignore",
      timeout: 5_000,
    });
    const realRoot = realpathSync(repoRoot);
    const db = openDatabase({ dbPath: join(tempRoot, "gwrk.db") });
    const projectId = resolveProjectId(realRoot);
    const registry = createSqliteProjectRegistryAdapter({ db });
    const store = createSqliteOperationsStoreAdapter({ db });

    registry.enrollProject({
      projectId,
      slug: "durable-proj",
      name: "Durable Project",
      repoSlug: null,
      trunkBranch: "develop",
      localRoot: realRoot,
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local"] },
      slack: opts?.withSlack
        ? {
            workspaceId: "T_DURABLE",
            channelId: "C_DURABLE",
            sharedChannel: false,
          }
        : null,
      legacyProjectIds: [],
      createdAt: "2026-11-23T12:00:00.000Z",
      updatedAt: "2026-11-23T12:00:00.000Z",
    });
    if (opts?.withSlack) {
      registry.bindFeatureThread({
        projectId,
        featureId: "049-durable",
        workspaceId: "T_DURABLE",
        channelId: "C_DURABLE",
        rootTs: "1731320000.000777",
        updatedAt: "2026-11-23T12:00:00.000Z",
      });
    }

    const config: GwrkConfig = {
      project: { name: "durable-proj" },
      agents: { define: "gemini", implement: "agy" },
      server: {
        port: 18790,
        host: "127.0.0.1",
        heartbeatIntervalMs: 1000,
        networkCheckIntervalMs: 1000,
      },
      parallelism: {
        local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
        cloud: { maxConcurrent: 10 },
      },
    };
    const monitor = new SystemMonitor() as Mocked<SystemMonitor>;
    monitor.isThrottled.mockReturnValue(false);
    const sandbox = new SandboxManager(realRoot) as Mocked<SandboxManager>;
    sandbox.createSandbox.mockResolvedValue("/work/durable");
    sandbox.destroySandbox.mockResolvedValue(undefined);

    return {
      tempRoot,
      realRoot,
      db,
      projectId,
      registry,
      store,
      config,
      monitor,
      sandbox,
    };
  }

  it("TR-001 replays accepted operations across restart and delivers completion only via durable outbox", async () => {
    vi.clearAllMocks();
    const { realRoot, db, projectId, store, config, monitor, sandbox } =
      setupDurableEnv({ withSlack: true });
    try {
      // Queue #1 accepts while paused (simulating crash between acceptance and launch)
      const queue1 = new DispatchQueue(config, monitor, sandbox, realRoot, {
        db,
        projectId,
      });
      queue1.pause();
      const receipt = queue1.accept(
        {
          projectId,
          featureId: "049-durable",
          phaseId: "phase-01",
        },
        { defaultRecipientSurface: "http" },
      );
      expect(receipt).not.toBeNull();
      expect(receipt?.deduplicated).toBe(false);
      expect(receipt?.recipient).toEqual({ projectId, surface: "http" });
      await queue1.close();

      // Queue #2 starts fresh on same SQLite DB with synthetic worker & notifier
      const launchPhaseShip = vi.fn().mockResolvedValue({
        exitCode: 0,
        stderr: "",
        workDir: "/work/durable",
        prNumber: 91,
        prUrl: "https://github.com/org/durable/pull/91",
      });
      const worker: WorkerExecutionPort = {
        inspectRecoveredWork: vi.fn(),
        launchPhaseShip,
        cleanupStaleSandbox: vi.fn(),
      };
      const notify = vi.fn().mockResolvedValue({
        delivered: true,
        channelId: "C_DURABLE",
        messageTs: "1731320099.000123",
        threadTs: "1731320000.000777",
      });
      const notifier: NotificationPort = { notify };

      const queue2 = new DispatchQueue(
        config,
        monitor,
        sandbox,
        realRoot,
        { db, projectId },
        undefined,
        undefined,
        { worker, notifier, heartbeatIntervalMs: null },
      );

      await queue2.recoverOnStartup();
      await vi.waitFor(() => {
        const op = store.getDispatchOperation({
          projectId,
          featureId: "049-durable",
          phaseId: "phase-01",
        });
        expect(op?.status).toBe("completed");
      });
      await queue2.close();

      expect(launchPhaseShip).toHaveBeenCalledOnce();
      const completed = store.getDispatchOperation({
        projectId,
        featureId: "049-durable",
        phaseId: "phase-01",
      });
      expect(completed?.prNumber).toBe(91);
      // Original HTTP recipient preserved on operation
      expect(completed?.recipient).toEqual({ projectId, surface: "http" });
      // Derived Slack destination delivered solely via outbox (no legacy notifySlack!)
      expect(notify).toHaveBeenCalledOnce();
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          featureId: "049-durable",
          phaseId: "phase-01",
          channel: "C_DURABLE",
          threadTs: "1731320000.000777",
          clientMetadataKey: expect.any(String),
        }),
      );
      expect(notifySlack).not.toHaveBeenCalled();
      expect(persistDispatch).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("TR-001 reconciles stale running leases via WorkerExecutionPort before launching work", async () => {
    vi.clearAllMocks();
    const { realRoot, db, projectId, store, config, monitor, sandbox } =
      setupDurableEnv();
    try {
      // Seed three stale expired running operations in SQLite
      const acceptAndExpire = (featureId: string) => {
        const r = store.acceptDispatch({
          projectId,
          featureId,
          phaseId: "phase-01",
          backend: "agy",
          trunkBranch: "develop",
          recipient: { projectId, surface: "http" },
          newOperationId: `op-${featureId}`,
          nowIso: "2026-11-23T10:00:00.000Z",
        });
        store.claimDispatchLease({
          operationId: r.operationId,
          leaseOwner: "crashed-daemon",
          nowIso: "2026-11-23T10:00:01.000Z",
          leaseExpiresAt: "2026-11-23T10:05:00.000Z",
        });
        return r.operationId;
      };

      const opWithPr = acceptAndExpire("049-has-pr");
      const opStillRunning = acceptAndExpire("049-still-running");
      const opStopped = acceptAndExpire("049-stopped-sandbox");

      const inspectRecoveredWork = vi.fn(
        async ({ operationId }: { operationId: string }) => {
          if (operationId === opWithPr) {
            return {
              workerState: "stopped" as const,
              pullRequestLookup: "complete" as const,
              openPullRequest: {
                operationId,
                prNumber: 404,
                prUrl: "https://github.com/org/durable/pull/404",
              },
              mergedPullRequest: null,
              completedManifestRunId: null,
              sandboxDir: null,
            };
          }
          if (operationId === opStillRunning) {
            return {
              workerState: "running" as const,
              pullRequestLookup: "complete" as const,
              openPullRequest: null,
              mergedPullRequest: null,
              completedManifestRunId: null,
              sandboxDir: "/work/still-alive",
            };
          }
          return {
            workerState: "stopped" as const,
            pullRequestLookup: "complete" as const,
            openPullRequest: null,
            mergedPullRequest: null,
            completedManifestRunId: null,
            sandboxDir: "/work/stale-sandbox",
          };
        },
      );
      const cleanupStaleSandbox = vi.fn().mockResolvedValue(undefined);
      const launchPhaseShip = vi.fn().mockResolvedValue({
        exitCode: 0,
        stderr: "",
        prNumber: 505,
        prUrl: "https://github.com/org/durable/pull/505",
      });

      const queue = new DispatchQueue(
        config,
        monitor,
        sandbox,
        realRoot,
        { db, projectId },
        undefined,
        undefined,
        {
          worker: {
            inspectRecoveredWork,
            launchPhaseShip,
            cleanupStaleSandbox,
          },
          clock: {
            nowIso: () => "2026-11-23T12:00:00.000Z",
            nowMs: () => Date.parse("2026-11-23T12:00:00.000Z"),
          },
          heartbeatIntervalMs: null,
        },
      );

      const summary = await queue.recoverOnStartup();
      expect(summary).toEqual({
        requeuedCount: 1,
        completedFromPrCount: 1,
        failedCount: 0,
      });

      await vi.waitFor(() => {
        expect(
          store.getDispatchOperation({
            projectId,
            featureId: "049-stopped-sandbox",
            phaseId: "phase-01",
          })?.status,
        ).toBe("completed");
      });
      await queue.close();

      expect(inspectRecoveredWork).toHaveBeenCalledTimes(3);
      expect(cleanupStaleSandbox).toHaveBeenCalledExactlyOnceWith(
        realRoot,
        "/work/stale-sandbox",
        "049-stopped-sandbox",
      );
      // Only the confirmed-stopped operation launched a worker
      expect(launchPhaseShip).toHaveBeenCalledOnce();
      expect(launchPhaseShip).toHaveBeenCalledWith(
        expect.objectContaining({ featureId: "049-stopped-sandbox" }),
      );
      // PR-completed operation finished without relaunch
      const prOp = store.getDispatchOperation({
        projectId,
        featureId: "049-has-pr",
        phaseId: "phase-01",
      });
      expect(prOp?.status).toBe("completed");
      expect(prOp?.prNumber).toBe(404);
      // Live worker was NOT relaunched and kept its leased status
      const liveOp = store.getDispatchOperation({
        projectId,
        featureId: "049-still-running",
        phaseId: "phase-01",
      });
      expect(liveOp?.status).toBe("leased");
    } finally {
      db.close();
    }
  });

  it("TR-001 default WorkerExecutionPort rejects fork merged PRs and recovers stopped GitHub-enrolled leases", async () => {
    vi.clearAllMocks();
    const tempRoot = mkdtempSync(
      join(tmpdir(), "gwrk-durable-default-worker-"),
    );
    tempDirs.push(tempRoot);
    const repoRoot = join(tempRoot, "repo");
    mkdirSync(repoRoot, { recursive: true });
    execFileSync("git", ["init", "--quiet", "--initial-branch=develop"], {
      cwd: repoRoot,
      stdio: "ignore",
      timeout: 5_000,
    });
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://github.com/org/alpha.git"],
      { cwd: repoRoot, stdio: "ignore", timeout: 5_000 },
    );
    const realRoot = realpathSync(repoRoot);
    const db = openDatabase({ dbPath: join(tempRoot, "gwrk.db") });
    try {
      const projectId = resolveProjectId(realRoot);
      const registry = createSqliteProjectRegistryAdapter({ db });
      const store = createSqliteOperationsStoreAdapter({ db });
      registry.enrollProject({
        projectId,
        slug: "alpha",
        name: "Alpha",
        repoSlug: "org/alpha",
        trunkBranch: "develop",
        localRoot: realRoot,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local"] },
        slack: null,
        legacyProjectIds: [],
        createdAt: "2026-11-23T10:00:00.000Z",
        updatedAt: "2026-11-23T10:00:00.000Z",
      });

      const seedExpiredLease = (featureId: string, operationId: string) => {
        const receipt = store.acceptDispatch({
          projectId,
          featureId,
          phaseId: "phase-01",
          backend: "agy",
          trunkBranch: "develop",
          recipient: { projectId, surface: "http" },
          newOperationId: operationId,
          nowIso: "2026-11-23T10:00:00.000Z",
        });
        store.claimDispatchLease({
          operationId: receipt.operationId,
          leaseOwner: "crashed-daemon",
          nowIso: "2026-11-23T10:00:01.000Z",
          leaseExpiresAt: "2026-11-23T10:05:00.000Z",
        });
        return receipt;
      };

      const forkReceipt = seedExpiredLease("049-fork-head", "op-fork-head");
      seedExpiredLease("049-no-pr", "op-no-pr");

      const github: GitHubHarvestPort = {
        verifyWebhookSignature: () => true,
        listTerminalPullRequests: vi.fn().mockResolvedValue([
          {
            repoSlug: "org/alpha",
            headRepoSlug: "evil-fork/alpha",
            prNumber: 777,
            prUrl: "https://github.com/org/alpha/pull/777",
            state: "MERGED",
            merged: true,
            baseBranch: "develop",
            headBranch: forkReceipt.branchName,
            headSha: "a".repeat(40),
            mergeCommitSha: "b".repeat(40),
            mergedAt: "2026-11-23T10:02:00.000Z",
            closedAt: "2026-11-23T10:02:00.000Z",
          },
        ]),
        getPullRequest: vi.fn().mockResolvedValue(null),
      };

      const config: GwrkConfig = {
        project: { name: "alpha" },
        agents: { define: "gemini", implement: "agy" },
        server: {
          port: 18790,
          host: "127.0.0.1",
          heartbeatIntervalMs: 1000,
          networkCheckIntervalMs: 1000,
        },
        parallelism: {
          local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
          cloud: { maxConcurrent: 10 },
        },
      };
      const monitor = new SystemMonitor() as Mocked<SystemMonitor>;
      monitor.isThrottled.mockReturnValue(false);
      const sandbox = new SandboxManager(realRoot) as Mocked<SandboxManager>;

      const queue = new DispatchQueue(
        config,
        monitor,
        sandbox,
        realRoot,
        { db, projectId },
        undefined,
        undefined,
        {
          github,
          clock: {
            nowIso: () => "2026-11-23T12:00:00.000Z",
            nowMs: () => Date.parse("2026-11-23T12:00:00.000Z"),
          },
          heartbeatIntervalMs: null,
        },
      );
      queue.pause();

      const summary = await queue.recoverOnStartup();
      await queue.close();

      // Foreign fork head must NEVER complete the operation
      const forkOp = store.getDispatchOperation({
        projectId,
        featureId: "049-fork-head",
        phaseId: "phase-01",
      });
      expect(forkOp?.status).not.toBe("completed");
      expect(summary.completedFromPrCount).toBe(0);

      // Stopped worker with no PR on GitHub must be requeued rather than wedged forever
      const noPrOp = store.getDispatchOperation({
        projectId,
        featureId: "049-no-pr",
        phaseId: "phase-01",
      });
      expect(noPrOp?.status).toBe("accepted");
    } finally {
      db.close();
    }
  });

  it("TR-003 clears activeDurableOps when a stale worker is fenced on completion", async () => {
    vi.clearAllMocks();
    const { realRoot, db, projectId, store, config, monitor, sandbox } =
      setupDurableEnv();
    try {
      let nowMs = Date.parse("2026-11-23T12:00:00.000Z");
      const clock = {
        nowIso: () => new Date(nowMs).toISOString(),
        nowMs: () => nowMs,
      };
      let releaseWorker!: () => void;
      const workerStarted = new Promise<void>((resolve) => {
        releaseWorker = resolve;
      });
      let finishWorker!: (result: { exitCode: number; stderr: string }) => void;
      const worker: WorkerExecutionPort = {
        inspectRecoveredWork: vi.fn(),
        launchPhaseShip: vi.fn(
          () =>
            new Promise<{ exitCode: number; stderr: string }>((resolve) => {
              releaseWorker();
              finishWorker = resolve;
            }),
        ),
        cleanupStaleSandbox: vi.fn(),
      };

      const queue = new DispatchQueue(
        config,
        monitor,
        sandbox,
        realRoot,
        { db, projectId },
        undefined,
        undefined,
        {
          worker,
          clock,
          leaseDurationMs: 1_000,
          heartbeatIntervalMs: null,
        },
      );

      const receipt = queue.accept({
        projectId,
        featureId: "049-fenced",
        phaseId: "phase-01",
      });
      expect(receipt).not.toBeNull();
      await workerStarted;
      expect(queue.getActiveCount()).toBe(1);

      // Advance past lease expiry and let a successor daemon claim the lease
      nowMs += 5_000;
      const takeover = store.claimDispatchLease({
        operationId: receipt!.operationId,
        leaseOwner: "successor-daemon",
        nowIso: clock.nowIso(),
        leaseExpiresAt: new Date(nowMs + 60_000).toISOString(),
      });
      expect(takeover).not.toBeNull();

      // Original stale worker finishes and receives LEASE_FENCED
      finishWorker({ exitCode: 0, stderr: "" });
      await queue.close();

      expect(queue.getActiveCount()).toBe(0);
      expect(queue.getQueue().active).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("TR-001 default WorkerExecutionPort attributes same-repo open PRs and ignores fork open PRs when persistedPullRequest is absent", async () => {
    vi.clearAllMocks();
    const tempRoot = mkdtempSync(
      join(tmpdir(), "gwrk-durable-open-pr-worker-"),
    );
    tempDirs.push(tempRoot);
    const repoRoot = join(tempRoot, "repo");
    mkdirSync(repoRoot, { recursive: true });
    execFileSync("git", ["init", "--quiet", "--initial-branch=develop"], {
      cwd: repoRoot,
      stdio: "ignore",
      timeout: 5_000,
    });
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://github.com/org/alpha.git"],
      { cwd: repoRoot, stdio: "ignore", timeout: 5_000 },
    );
    const realRoot = realpathSync(repoRoot);
    const db = openDatabase({ dbPath: join(tempRoot, "gwrk.db") });
    try {
      const projectId = resolveProjectId(realRoot);
      const registry = createSqliteProjectRegistryAdapter({ db });
      const store = createSqliteOperationsStoreAdapter({ db });
      registry.enrollProject({
        projectId,
        slug: "alpha",
        name: "Alpha",
        repoSlug: "org/alpha",
        trunkBranch: "develop",
        localRoot: realRoot,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local"] },
        slack: null,
        legacyProjectIds: [],
        createdAt: "2026-11-23T10:00:00.000Z",
        updatedAt: "2026-11-23T10:00:00.000Z",
      });

      const seedExpiredLease = (featureId: string, operationId: string) => {
        const receipt = store.acceptDispatch({
          projectId,
          featureId,
          phaseId: "phase-01",
          backend: "agy",
          trunkBranch: "develop",
          recipient: { projectId, surface: "http" },
          newOperationId: operationId,
          nowIso: "2026-11-23T10:00:00.000Z",
        });
        store.claimDispatchLease({
          operationId: receipt.operationId,
          leaseOwner: "crashed-daemon",
          nowIso: "2026-11-23T10:00:01.000Z",
          leaseExpiresAt: "2026-11-23T10:05:00.000Z",
        });
        return receipt;
      };

      const ownOpenReceipt = seedExpiredLease("049-own-open", "op-own-open");
      const forkOpenReceipt = seedExpiredLease("049-fork-open", "op-fork-open");

      const listOpenPullRequests = vi.fn(
        async ({ headBranch }: { headBranch?: string }) => {
          if (headBranch === ownOpenReceipt.branchName) {
            return [
              {
                repoSlug: "org/alpha",
                headRepoSlug: "Org/Alpha",
                prNumber: 801,
                prUrl: "https://github.com/org/alpha/pull/801",
                state: "OPEN" as const,
                merged: false,
                baseBranch: "develop",
                headBranch: ownOpenReceipt.branchName,
                headSha: "c".repeat(40),
                mergeCommitSha: null,
                mergedAt: null,
                closedAt: null,
              },
            ];
          }
          if (headBranch === forkOpenReceipt.branchName) {
            return [
              {
                repoSlug: "org/alpha",
                headRepoSlug: "evil-fork/alpha",
                prNumber: 802,
                prUrl: "https://github.com/org/alpha/pull/802",
                state: "OPEN" as const,
                merged: false,
                baseBranch: "develop",
                headBranch: forkOpenReceipt.branchName,
                headSha: "d".repeat(40),
                mergeCommitSha: null,
                mergedAt: null,
                closedAt: null,
              },
            ];
          }
          return [];
        },
      );

      const github: GitHubHarvestPort = {
        verifyWebhookSignature: () => true,
        listTerminalPullRequests: vi.fn().mockResolvedValue([]),
        listOpenPullRequests,
        getPullRequest: vi.fn().mockResolvedValue(null),
      };

      const config: GwrkConfig = {
        project: { name: "alpha" },
        agents: { define: "gemini", implement: "agy" },
        server: {
          port: 18790,
          host: "127.0.0.1",
          heartbeatIntervalMs: 1000,
          networkCheckIntervalMs: 1000,
        },
        parallelism: {
          local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
          cloud: { maxConcurrent: 10 },
        },
      };
      const monitor = new SystemMonitor() as Mocked<SystemMonitor>;
      monitor.isThrottled.mockReturnValue(false);
      const sandbox = new SandboxManager(realRoot) as Mocked<SandboxManager>;

      const queue = new DispatchQueue(
        config,
        monitor,
        sandbox,
        realRoot,
        { db, projectId },
        undefined,
        undefined,
        {
          github,
          clock: {
            nowIso: () => "2026-11-23T12:00:00.000Z",
            nowMs: () => Date.parse("2026-11-23T12:00:00.000Z"),
          },
          heartbeatIntervalMs: null,
        },
      );
      queue.pause();

      const summary = await queue.recoverOnStartup();
      await queue.close();

      expect(listOpenPullRequests).toHaveBeenCalledWith({
        cwd: realRoot,
        repoSlug: "org/alpha",
        baseBranch: "develop",
        headBranch: ownOpenReceipt.branchName,
      });
      const ownOp = store.getDispatchOperation({
        projectId,
        featureId: "049-own-open",
        phaseId: "phase-01",
      });
      expect(ownOp?.status).toBe("completed");
      expect(ownOp?.prNumber).toBe(801);
      expect(summary.completedFromPrCount).toBe(1);

      const forkOp = store.getDispatchOperation({
        projectId,
        featureId: "049-fork-open",
        phaseId: "phase-01",
      });
      expect(forkOp?.status).toBe("accepted");
      expect(forkOp?.prNumber).toBeNull();
      expect(summary.requeuedCount).toBe(1);
    } finally {
      db.close();
    }
  });
});
