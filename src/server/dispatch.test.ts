/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  type Mock,
  type Mocked,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { startRun } from "../db/runs.js";
import type {
  DeliveryRecipient,
  EnrolledProject,
  SlackFeatureThread,
} from "../domain/project-registry.js";
import { resolveSlackDeliveryRoute } from "../domain/slack-delivery.js";
import { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
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
      expect.objectContaining({
        projectId: expect.any(String),
        featureId: "feat-1",
      }),
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
      expect.objectContaining({
        projectId: expect.any(String),
        featureId: "feat-1",
      }),
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

  it("TR-017: queues, runs, persists, and filters identical (featureId, phaseId) independently across two enrolled projects", async () => {
    const alphaProject: EnrolledProject = {
      projectId: "proj-alpha",
      slug: "alpha",
      name: "Alpha",
      repoSlug: "org/alpha",
      trunkBranch: "main",
      localRoot: "/repos/alpha",
      mirrorPath: "/mirrors/alpha",
      runnerPolicy: { allowedKinds: ["local", "hosted"] },
      slack: {
        workspaceId: "W-ALPHA",
        channelId: "C-ALPHA",
        opsChannelId: "C-ALPHA-OPS",
        sharedChannel: false,
      },
      legacyProjectIds: [],
      createdAt: "2026-11-18T00:00:00.000Z",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };
    const betaProject: EnrolledProject = {
      projectId: "proj-beta",
      slug: "beta",
      name: "Beta",
      repoSlug: "org/beta",
      trunkBranch: "release",
      localRoot: "/repos/beta",
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local"] },
      slack: {
        workspaceId: "W-BETA",
        channelId: "C-BETA",
        opsChannelId: "C-BETA-OPS",
        sharedChannel: false,
      },
      legacyProjectIds: [],
      createdAt: "2026-11-18T00:00:00.000Z",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };
    const projects = [alphaProject, betaProject];
    const registry: ProjectRegistryPort = {
      enrollProject: (p) => p,
      getProject: (id) =>
        projects.find((p) => p.projectId === id || p.slug === id) ?? null,
      findByRepoSlug: (slug) =>
        projects.find((p) => p.repoSlug === slug) ?? null,
      findByLocalRoot: (root) =>
        projects.find((p) => p.localRoot === root) ?? null,
      listBySlackChannel: () => [],
      listProjects: () => projects,
      setRoleBinding: () => {},
      listRoleBindings: () => [],
      getFeatureThread: () => null,
      bindFeatureThread: (t) => t,
      getActionReceipt: () => null,
      claimActionReceipt: () => true,
      completeActionReceipt: () => true,
      close: () => {},
    };

    const alphaRecipient: DeliveryRecipient = {
      projectId: "proj-alpha",
      surface: "slack",
      workspaceId: "W-ALPHA",
      channelId: "C-ALPHA",
      threadTs: "1700000001.000100",
      actorUserId: "U-ALPHA",
    };
    const betaRecipient: DeliveryRecipient = {
      projectId: "proj-beta",
      surface: "slack",
      workspaceId: "W-BETA",
      channelId: "C-BETA",
      threadTs: "1700000002.000200",
      actorUserId: "U-BETA",
    };

    let resolveAlphaRun!: (code: number) => void;
    let resolveBetaRun!: (code: number) => void;
    const alphaRunPromise = new Promise<number>((resolve) => {
      resolveAlphaRun = resolve;
    });
    const betaRunPromise = new Promise<number>((resolve) => {
      resolveBetaRun = resolve;
    });

    mockSandbox.createSandbox
      .mockResolvedValueOnce("/mirrors/alpha/.runs/sandboxes/alpha-wt")
      .mockResolvedValueOnce("/repos/beta/.runs/sandboxes/beta-wt");

    let runCallIndex = 0;
    (ShipOrchestrator as unknown as Mock).mockImplementation(() => {
      const idx = runCallIndex++;
      return {
        run: vi
          .fn()
          .mockReturnValue(idx === 0 ? alphaRunPromise : betaRunPromise),
        getResult: mockGetResult,
      };
    });

    mockMonitor.isThrottled.mockReturnValue(false);
    const scopedQueue = new DispatchQueue(
      mockConfig,
      mockMonitor,
      mockSandbox,
      projectRoot,
      registry,
    );

    const alphaRecord = scopedQueue.enqueue({
      projectId: "proj-alpha",
      featureId: "048-shared",
      phaseId: "phase-01",
      recipient: alphaRecipient,
    });
    // Re-enqueuing same (projectId, featureId, phaseId) deduplicates
    const alphaDup = scopedQueue.enqueue({
      projectId: "proj-alpha",
      featureId: "048-shared",
      phaseId: "phase-01",
      recipient: alphaRecipient,
    });
    expect(alphaDup).toBe(alphaRecord);

    // Same (featureId, phaseId) for Beta enqueues and executes concurrently
    const betaRecord = scopedQueue.enqueue({
      projectId: "proj-beta",
      featureId: "048-shared",
      phaseId: "phase-01",
      recipient: betaRecipient,
    });

    expect(betaRecord.id).not.toBe(alphaRecord.id);
    expect(alphaRecord.projectId).toBe("proj-alpha");
    expect(alphaRecord.projectRoot).toBe("/mirrors/alpha");
    expect(alphaRecord.trunkBranch).toBe("main");
    expect(alphaRecord.recipient).toEqual(alphaRecipient);

    expect(betaRecord.projectId).toBe("proj-beta");
    expect(betaRecord.projectRoot).toBe("/repos/beta");
    expect(betaRecord.trunkBranch).toBe("release");
    expect(betaRecord.recipient).toEqual(betaRecipient);

    // Project-scoped queries while both are active
    expect(scopedQueue.getActiveCount()).toBe(2);
    expect(scopedQueue.getActiveCount("proj-alpha")).toBe(1);
    expect(scopedQueue.getActiveCount("proj-beta")).toBe(1);
    expect(scopedQueue.getQueue("proj-alpha").active).toEqual([alphaRecord]);
    expect(scopedQueue.getQueue("proj-beta").active).toEqual([betaRecord]);
    expect(
      scopedQueue.getDispatch(
        "048-shared",
        "phase-01",
        undefined,
        "proj-alpha",
      ),
    ).toBe(alphaRecord);
    expect(
      scopedQueue.getDispatch("048-shared", "phase-01", undefined, "proj-beta"),
    ).toBe(betaRecord);

    // Enqueue a third item for Alpha (queued due to maxClones = 2)
    const alphaQueued = scopedQueue.enqueue({
      projectId: "proj-alpha",
      featureId: "048-shared",
      phaseId: "phase-02",
      recipient: alphaRecipient,
    });
    expect(scopedQueue.getQueueDepth("proj-alpha")).toBe(1);
    expect(scopedQueue.getQueueDepth("proj-beta")).toBe(0);
    expect(scopedQueue.getQueue("proj-alpha").queued).toEqual([alphaQueued]);
    expect(scopedQueue.getQueue("proj-beta").queued).toEqual([]);

    // Finish Alpha with 0 (completed) and Beta with 1 (failed)
    mockMonitor.isThrottled.mockReturnValue(true); // keep alphaQueued in queue
    resolveAlphaRun(0);
    resolveBetaRun(1);

    await vi.waitFor(() => {
      if (
        alphaRecord.status !== "completed" ||
        betaRecord.status !== "failed"
      ) {
        throw new Error("waiting for both dispatches to settle");
      }
    });

    expect(scopedQueue.getCompletedCount("proj-alpha")).toBe(1);
    expect(scopedQueue.getCompletedCount("proj-beta")).toBe(0);
    expect(scopedQueue.getFailedCount("proj-alpha")).toBe(0);
    expect(scopedQueue.getFailedCount("proj-beta")).toBe(1);

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        feature_id: "048-shared",
        phase_id: "phase-01",
        project_id: "proj-alpha",
      }),
    );
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        feature_id: "048-shared",
        phase_id: "phase-01",
        project_id: "proj-beta",
      }),
    );

    expect(mockSandbox.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: "/mirrors/alpha",
        baseBranch: "main",
      }),
    );
    expect(mockSandbox.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: "/repos/beta",
        baseBranch: "release",
      }),
    );

    expect(ShipOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/mirrors/alpha/.runs/sandboxes/alpha-wt",
        stateRoot: "/mirrors/alpha",
      }),
    );
    expect(ShipOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repos/beta/.runs/sandboxes/beta-wt",
        stateRoot: "/repos/beta",
      }),
    );

    expect(persistDispatch).toHaveBeenCalledWith(alphaRecord, "/mirrors/alpha");
    expect(persistDispatch).toHaveBeenCalledWith(betaRecord, "/repos/beta");

    expect(notifySlack).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "review_ready",
        projectId: "proj-alpha",
        recipient: alphaRecipient,
      }),
      expect.objectContaining({
        projectId: "proj-alpha",
        recipient: alphaRecipient,
        featureId: "048-shared",
        registry,
      }),
    );
    expect(notifySlack).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "phase_fail",
        projectId: "proj-beta",
        recipient: betaRecipient,
      }),
      expect.objectContaining({
        projectId: "proj-beta",
        recipient: betaRecipient,
        featureId: "048-shared",
        registry,
      }),
    );
  });

  it("TR-017 regression: rejects unenrolled projectId and conflicting recipient.projectId, and canonicalizes slug recipient.projectId", () => {
    const alphaProject: EnrolledProject = {
      projectId: "proj-alpha",
      slug: "alpha",
      name: "Alpha",
      repoSlug: "org/alpha",
      trunkBranch: "main",
      localRoot: "/repos/alpha",
      mirrorPath: "/mirrors/alpha",
      runnerPolicy: { allowedKinds: ["local", "hosted"] },
      slack: {
        workspaceId: "W-ALPHA",
        channelId: "C-ALPHA",
        sharedChannel: false,
      },
      legacyProjectIds: [],
      createdAt: "2026-11-18T00:00:00.000Z",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };
    const registry: ProjectRegistryPort = {
      enrollProject: (p) => p,
      getProject: (id) =>
        id === "proj-alpha" || id === "alpha" ? alphaProject : null,
      findByRepoSlug: () => null,
      findByLocalRoot: () => null,
      listBySlackChannel: () => [],
      listProjects: () => [alphaProject],
      setRoleBinding: () => {},
      listRoleBindings: () => [],
      getFeatureThread: () => null,
      bindFeatureThread: (t) => t,
      getActionReceipt: () => null,
      claimActionReceipt: () => true,
      completeActionReceipt: () => true,
      close: () => {},
    };

    mockMonitor.isThrottled.mockReturnValue(true);
    const scopedQueue = new DispatchQueue(
      mockConfig,
      mockMonitor,
      mockSandbox,
      projectRoot,
      registry,
    );

    // Unenrolled projectId must fail closed instead of falling back to daemon projectRoot
    expect(() =>
      scopedQueue.enqueue({
        projectId: "proj-unknown",
        featureId: "048-shared",
        phaseId: "phase-01",
      }),
    ).toThrow();

    // Conflicting request.projectId and recipient.projectId must fail closed
    expect(() =>
      scopedQueue.enqueue({
        projectId: "proj-alpha",
        featureId: "048-shared",
        phaseId: "phase-01",
        recipient: {
          projectId: "proj-beta",
          surface: "slack",
          workspaceId: "W-BETA",
          channelId: "C-BETA",
        },
      }),
    ).toThrow();

    // Slug selector with matching slug recipient.projectId must canonicalize recipient.projectId
    const slugRecord = scopedQueue.enqueue({
      projectId: "alpha",
      featureId: "048-shared",
      phaseId: "phase-01",
      recipient: {
        projectId: "alpha",
        surface: "slack",
        workspaceId: "W-ALPHA",
        channelId: "C-ALPHA",
      },
    });
    expect(slugRecord.projectId).toBe("proj-alpha");
    expect(slugRecord.recipient?.projectId).toBe("proj-alpha");
  });

  it("TR-017 regression: rejects cross-channel and cross-workspace Slack recipients on enqueue", () => {
    const alphaProject: EnrolledProject = {
      projectId: "proj-alpha",
      slug: "alpha",
      name: "Alpha",
      repoSlug: "org/alpha",
      trunkBranch: "main",
      localRoot: "/repos/alpha",
      mirrorPath: "/mirrors/alpha",
      runnerPolicy: { allowedKinds: ["local", "hosted"] },
      slack: {
        workspaceId: "W-ALPHA",
        channelId: "C-ALPHA",
        opsChannelId: "C-ALPHA-OPS",
        sharedChannel: false,
      },
      legacyProjectIds: [],
      createdAt: "2026-11-18T00:00:00.000Z",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };
    const registry: ProjectRegistryPort = {
      enrollProject: (p) => p,
      getProject: (id) =>
        id === "proj-alpha" || id === "alpha" ? alphaProject : null,
      findByRepoSlug: () => null,
      findByLocalRoot: () => null,
      listBySlackChannel: () => [],
      listProjects: () => [alphaProject],
      setRoleBinding: () => {},
      listRoleBindings: () => [],
      getFeatureThread: () => null,
      bindFeatureThread: (t) => t,
      getActionReceipt: () => null,
      claimActionReceipt: () => true,
      completeActionReceipt: () => true,
      close: () => {},
    };

    mockMonitor.isThrottled.mockReturnValue(true);
    const scopedQueue = new DispatchQueue(
      mockConfig,
      mockMonitor,
      mockSandbox,
      projectRoot,
      registry,
    );

    expect(() =>
      scopedQueue.enqueue({
        projectId: "proj-alpha",
        featureId: "048-shared",
        phaseId: "phase-01",
        recipient: {
          projectId: "proj-alpha",
          surface: "slack",
          workspaceId: "W-ALPHA",
          channelId: "C-BETA",
        },
      }),
    ).toThrow();
    expect(() =>
      scopedQueue.enqueue({
        projectId: "proj-alpha",
        featureId: "048-shared",
        phaseId: "phase-01",
        recipient: {
          projectId: "proj-alpha",
          surface: "slack",
          workspaceId: "W-OTHER",
          channelId: "C-ALPHA",
        },
      }),
    ).toThrow();
  });

  it("TR-017 regression: translates non-Slack recipients for Slack completion notices and stamps card routing", async () => {
    const alphaProject: EnrolledProject = {
      projectId: "proj-alpha",
      slug: "alpha",
      name: "Alpha",
      repoSlug: "org/alpha",
      trunkBranch: "main",
      localRoot: "/repos/alpha",
      mirrorPath: "/mirrors/alpha",
      runnerPolicy: { allowedKinds: ["local", "hosted"] },
      slack: {
        workspaceId: "W-ALPHA",
        channelId: "C-ALPHA",
        opsChannelId: "C-ALPHA-OPS",
        sharedChannel: false,
      },
      legacyProjectIds: [],
      createdAt: "2026-11-18T00:00:00.000Z",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };
    const alphaThread: SlackFeatureThread = {
      projectId: "proj-alpha",
      featureId: "048-shared",
      workspaceId: "W-ALPHA",
      channelId: "C-ALPHA",
      rootTs: "1700000100.000200",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };
    const registry: ProjectRegistryPort = {
      enrollProject: (p) => p,
      getProject: (id) =>
        id === "proj-alpha" || id === "alpha" ? alphaProject : null,
      findByRepoSlug: () => null,
      findByLocalRoot: () => null,
      listBySlackChannel: () => [],
      listProjects: () => [alphaProject],
      setRoleBinding: () => {},
      listRoleBindings: () => [],
      getFeatureThread: (projectId, featureId) =>
        projectId === "proj-alpha" && featureId === "048-shared"
          ? alphaThread
          : null,
      bindFeatureThread: (t) => t,
      getActionReceipt: () => null,
      claimActionReceipt: () => true,
      completeActionReceipt: () => true,
      close: () => {},
    };

    mockMonitor.isThrottled.mockReturnValue(false);
    const scopedQueue = new DispatchQueue(
      mockConfig,
      mockMonitor,
      mockSandbox,
      projectRoot,
      registry,
    );

    // Non-Slack recipient (as returned by evaluateHttpProjectAccess) must still deliver to Slack
    const httpRecipient: DeliveryRecipient = {
      projectId: "proj-alpha",
      surface: "http",
    };
    const record = scopedQueue.enqueue({
      projectId: "proj-alpha",
      featureId: "048-shared",
      phaseId: "phase-01",
      recipient: httpRecipient,
    });

    await vi.waitFor(() => {
      if (record.status !== "completed") throw new Error("not completed yet");
    });

    expect(record.recipient).toEqual(httpRecipient);
    expect(notifySlack).toHaveBeenCalledTimes(1);
    const [message, event, options] = vi.mocked(notifySlack).mock.calls[0];
    const resolved = resolveSlackDeliveryRoute({
      projectId: options?.projectId,
      eventProjectId: event?.projectId,
      recipient: options?.recipient,
      eventRecipient: event?.recipient,
      channelId: message.channel,
      threadTs: message.thread_ts,
      opsOnly: options?.opsOnly,
      eventOpsOnly: event?.opsOnly,
      project: alphaProject,
      storedThread: alphaThread,
      requireChannel: true,
    });
    expect(resolved).toEqual({
      ok: true,
      route: expect.objectContaining({
        projectId: "proj-alpha",
        expectedWorkspaceId: "W-ALPHA",
        channelId: "C-ALPHA",
        threadTs: "1700000100.000200",
        opsOnly: false,
      }),
    });

    const actionsBlock = message.blocks.find(
      (
        b,
      ): b is {
        type: "actions";
        elements: Array<{ action_id: string; value?: string }>;
      } => b.type === "actions",
    );
    const mergeButton = actionsBlock?.elements.find(
      (el) => el.action_id === "merge_pr",
    );
    expect(JSON.parse(mergeButton?.value ?? "{}")).toMatchObject({
      projectId: "proj-alpha",
      projectSlug: "alpha",
      rootTs: "1700000100.000200",
      featureId: "048-shared",
      phaseId: "phase-01",
    });
  });

  it("TR-017 regression: preserves local_cli recipient on phase_fail, derives Slack destination, and stamps retry card routing", async () => {
    const alphaProject: EnrolledProject = {
      projectId: "proj-alpha",
      slug: "alpha",
      name: "Alpha",
      repoSlug: "org/alpha",
      trunkBranch: "main",
      localRoot: "/repos/alpha",
      mirrorPath: "/mirrors/alpha",
      runnerPolicy: { allowedKinds: ["local", "hosted"] },
      slack: {
        workspaceId: "W-ALPHA",
        channelId: "C-ALPHA",
        opsChannelId: "C-ALPHA-OPS",
        sharedChannel: false,
      },
      legacyProjectIds: [],
      createdAt: "2026-11-18T00:00:00.000Z",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };
    const alphaThread: SlackFeatureThread = {
      projectId: "proj-alpha",
      featureId: "048-shared",
      workspaceId: "W-ALPHA",
      channelId: "C-ALPHA",
      rootTs: "1700000100.000200",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };
    const registry: ProjectRegistryPort = {
      enrollProject: (p) => p,
      getProject: (id) =>
        id === "proj-alpha" || id === "alpha" ? alphaProject : null,
      findByRepoSlug: () => null,
      findByLocalRoot: () => null,
      listBySlackChannel: () => [],
      listProjects: () => [alphaProject],
      setRoleBinding: () => {},
      listRoleBindings: () => [],
      getFeatureThread: (projectId, featureId) =>
        projectId === "proj-alpha" && featureId === "048-shared"
          ? alphaThread
          : null,
      bindFeatureThread: (t) => t,
      getActionReceipt: () => null,
      claimActionReceipt: () => true,
      completeActionReceipt: () => true,
      close: () => {},
    };

    mockMonitor.isThrottled.mockReturnValue(false);
    mockRun.mockResolvedValueOnce(1);
    const scopedQueue = new DispatchQueue(
      mockConfig,
      mockMonitor,
      mockSandbox,
      projectRoot,
      registry,
    );

    const localRecipient: DeliveryRecipient = {
      projectId: "proj-alpha",
      surface: "local_cli",
    };
    const record = scopedQueue.enqueue({
      projectId: "proj-alpha",
      featureId: "048-shared",
      phaseId: "phase-02",
      recipient: localRecipient,
    });

    await vi.waitFor(() => {
      if (record.status !== "failed") throw new Error("not failed yet");
    });

    expect(record.recipient).toEqual(localRecipient);
    expect(notifySlack).toHaveBeenCalledTimes(1);
    const [message, event, options] = vi.mocked(notifySlack).mock.calls[0];
    expect(event?.type).toBe("phase_fail");
    const resolved = resolveSlackDeliveryRoute({
      projectId: options?.projectId,
      eventProjectId: event?.projectId,
      recipient: options?.recipient,
      eventRecipient: event?.recipient,
      channelId: message.channel,
      threadTs: message.thread_ts,
      opsOnly: options?.opsOnly,
      eventOpsOnly: event?.opsOnly,
      project: alphaProject,
      storedThread: alphaThread,
      requireChannel: true,
    });
    expect(resolved).toEqual({
      ok: true,
      route: expect.objectContaining({
        projectId: "proj-alpha",
        expectedWorkspaceId: "W-ALPHA",
        channelId: "C-ALPHA",
        threadTs: "1700000100.000200",
        opsOnly: false,
      }),
    });

    const actionsBlock = message.blocks.find(
      (
        b,
      ): b is {
        type: "actions";
        elements: Array<{ action_id: string; value?: string }>;
      } => b.type === "actions",
    );
    const retryButton = actionsBlock?.elements.find(
      (el) => el.action_id === "retry_phase",
    );
    expect(JSON.parse(retryButton?.value ?? "{}")).toMatchObject({
      projectId: "proj-alpha",
      projectSlug: "alpha",
      rootTs: "1700000100.000200",
      featureId: "048-shared",
      phaseId: "phase-02",
    });
  });

  it("TR-017 regression: rejects wrong bound threadTs and unverified shared-channel threadTs on enqueue", () => {
    const sharedAlpha: EnrolledProject = {
      projectId: "proj-alpha",
      slug: "alpha",
      name: "Alpha",
      repoSlug: "org/alpha",
      trunkBranch: "main",
      localRoot: "/repos/alpha",
      mirrorPath: "/mirrors/alpha",
      runnerPolicy: { allowedKinds: ["local", "hosted"] },
      slack: {
        workspaceId: "W-SHARED",
        channelId: "C-SHARED",
        opsChannelId: "C-ALPHA-OPS",
        sharedChannel: true,
      },
      legacyProjectIds: [],
      createdAt: "2026-11-18T00:00:00.000Z",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };
    const alphaThread: SlackFeatureThread = {
      projectId: "proj-alpha",
      featureId: "048-shared",
      workspaceId: "W-SHARED",
      channelId: "C-SHARED",
      rootTs: "1700000100.000200",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };
    const registry: ProjectRegistryPort = {
      enrollProject: (p) => p,
      getProject: (id) =>
        id === "proj-alpha" || id === "alpha" ? sharedAlpha : null,
      findByRepoSlug: () => null,
      findByLocalRoot: () => null,
      listBySlackChannel: () => [sharedAlpha],
      listProjects: () => [sharedAlpha],
      setRoleBinding: () => {},
      listRoleBindings: () => [],
      getFeatureThread: (projectId, featureId) =>
        projectId === "proj-alpha" && featureId === "048-shared"
          ? alphaThread
          : null,
      bindFeatureThread: (t) => t,
      getActionReceipt: () => null,
      claimActionReceipt: () => true,
      completeActionReceipt: () => true,
      close: () => {},
    };

    mockMonitor.isThrottled.mockReturnValue(true);
    const scopedQueue = new DispatchQueue(
      mockConfig,
      mockMonitor,
      mockSandbox,
      projectRoot,
      registry,
    );

    // Wrong threadTs against a bound feature root must reject
    expect(() =>
      scopedQueue.enqueue({
        projectId: "proj-alpha",
        featureId: "048-shared",
        phaseId: "phase-01",
        recipient: {
          projectId: "proj-alpha",
          surface: "slack",
          workspaceId: "W-SHARED",
          channelId: "C-SHARED",
          threadTs: "1700000999.000999",
        },
      }),
    ).toThrow();

    // Unverified threadTs for an unbound feature in a shared channel must reject
    expect(() =>
      scopedQueue.enqueue({
        projectId: "proj-alpha",
        featureId: "050-unbound",
        phaseId: "phase-01",
        recipient: {
          projectId: "proj-alpha",
          surface: "slack",
          workspaceId: "W-SHARED",
          channelId: "C-SHARED",
          threadTs: "1700000888.000888",
        },
      }),
    ).toThrow();
  });
});
