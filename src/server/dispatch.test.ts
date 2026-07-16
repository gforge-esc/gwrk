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
import { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import type { GwrkConfig } from "../utils/config.js";
import { DispatchQueue } from "./dispatch.js";
import { SystemMonitor } from "./monitor.js";
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

    queue = new DispatchQueue(mockConfig, mockMonitor, mockSandbox, projectRoot);
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
});
