import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GwrkConfig } from "../utils/config.js";
import { DispatchOrchestrator } from "./dispatch-orchestrator.js";
import { DispatchQueue } from "./dispatch.js";
import { GitManager } from "./git-manager.js";
import { SystemMonitor } from "./monitor.js";
import { SandboxManager } from "./sandbox.js";

import os from "node:os";
import path from "node:path";

vi.mock("./monitor.js");
vi.mock("./sandbox.js");
vi.mock("./git-manager.js");
vi.mock("./persistence.js");
vi.mock("./slack-notify.js");
vi.mock("./dispatch-orchestrator.js");
vi.mock("./context.js", () => ({
  compileContext: vi.fn().mockReturnValue("mock context"),
}));
vi.mock("../db/runs.js", () => ({
  startRun: vi.fn().mockReturnValue(123),
  finishRun: vi.fn(),
}));

describe("DispatchQueue", () => {
  let queue: DispatchQueue;
  let mockMonitor: vi.Mocked<SystemMonitor>;
  let mockSandbox: vi.Mocked<SandboxManager>;
  let mockGit: vi.Mocked<GitManager>;
  let mockOrchestrator: vi.Mocked<DispatchOrchestrator>;
  let tempDir: string;
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-dispatch-test-"));
    mockMonitor = new SystemMonitor() as vi.Mocked<SystemMonitor>;
    mockSandbox = new SandboxManager(tempDir) as vi.Mocked<SandboxManager>;
    mockGit = new GitManager(tempDir) as vi.Mocked<GitManager>;
    mockOrchestrator =
      new DispatchOrchestrator() as vi.Mocked<DispatchOrchestrator>;

    mockOrchestrator.dispatchPhase.mockResolvedValue([]);

    queue = new DispatchQueue(
      mockConfig,
      mockMonitor,
      mockSandbox,
      mockGit,
      mockOrchestrator,
      tempDir,
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should enqueue a dispatch request", () => {
    mockMonitor.isThrottled.mockReturnValue(true);
    const record = queue.enqueue({
      featureId: "feat-1",
      phaseId: "phase-1",
      taskId: "T1",
    });
    expect(record.status).toBe("queued");
    expect(queue.getQueueDepth()).toBe(1);
  });

  it("should process next if not throttled", async () => {
    mockMonitor.isThrottled.mockReturnValue(false);
    mockOrchestrator.dispatchPhase.mockResolvedValue([
      {
        id: "T1",
        status: "completed",
        sandboxDir: "workdir-1",
        backend: "gemini",
      },
    ]);

    queue.enqueue({ featureId: "feat-1", phaseId: "phase-1", taskId: "T1" });

    // Wait for it to move to active
    await vi.waitFor(() => {
      if (queue.getCompletedCount() !== 1) throw new Error("Not completed yet");
    });

    expect(queue.getQueueDepth()).toBe(0);
    expect(mockOrchestrator.dispatchPhase).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [expect.objectContaining({ id: "T1" })],
      }),
    );
  });

  it("should not process next if throttled", async () => {
    mockMonitor.isThrottled.mockReturnValue(true);

    queue.enqueue({ featureId: "feat-1", phaseId: "phase-1", taskId: "T1" });

    // Wait a bit to ensure it doesn't process
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(queue.getActiveCount()).toBe(0);
    expect(queue.getQueueDepth()).toBe(1);
  });

  it("should handle successful completion", async () => {
    mockMonitor.isThrottled.mockReturnValue(false);
    mockOrchestrator.dispatchPhase.mockResolvedValue([
      {
        id: "T1",
        status: "completed",
        sandboxDir: "workdir-1",
        backend: "gemini",
      },
    ]);

    const record = queue.enqueue({
      featureId: "feat-1",
      phaseId: "phase-1",
      taskId: "T1",
    });

    // Wait for it to complete
    await vi.waitFor(() => {
      if (record.status !== "completed") throw new Error("Not completed yet");
    });

    expect(record.status).toBe("completed");
    expect(queue.getActiveCount()).toBe(0);
    expect(mockGit.mergePhaseBack).toHaveBeenCalledWith("feat-1", "phase-1");
  });

  it("should retry if exit code is non-zero and attempts < 3", async () => {
    mockMonitor.isThrottled.mockReturnValue(false);
    mockSandbox.createSandbox.mockResolvedValue("workdir-1");

    // Mock a failed dispatch result so runDispatch auto-triggers handleCompletion with exit 1
    mockOrchestrator.dispatchPhase.mockResolvedValueOnce([
      {
        id: "T1",
        status: "failed",
        sandboxDir: "workdir-1",
        backend: "gemini",
        exitCode: 1,
      },
    ]);

    // Throttle after first attempt so retry stays queued
    const originalIsThrottled = mockMonitor.isThrottled.getMockImplementation();
    let attemptCount = 0;
    mockMonitor.isThrottled.mockImplementation(() => {
      attemptCount++;
      // Allow first processNext (from enqueue), throttle after handleCompletion
      return attemptCount > 1;
    });

    const record = queue.enqueue({
      featureId: "feat-1",
      phaseId: "phase-1",
      taskId: "T1",
    });

    // Wait for the automatic retry to be queued
    await vi.waitFor(() => {
      if (record.status !== "retrying") throw new Error("Not retrying yet");
    });

    expect(record.status).toBe("retrying");
    expect(record.attempts.length).toBe(1);
  });

  it("should escalate if attempts >= 3", async () => {
    mockMonitor.isThrottled.mockReturnValue(false);
    mockOrchestrator.dispatchPhase.mockResolvedValue([
      {
        id: "T1",
        status: "failed",
        sandboxDir: "workdir-1",
        backend: "codex-cloud",
        exitCode: 1,
      },
    ]);

    // Config implement: gemini (fallback order will move through it)
    const record = queue.enqueue({
      featureId: "feat-1",
      phaseId: "phase-1",
      taskId: "T1",
      backend: "codex-cloud",
    });

    // Attempt 1 (Automatically triggered by enqueue -> processNext -> runDispatch -> orchestrator -> handleCompletion)
    await vi.waitFor(() => {
      if (record.attempts.length < 1) throw new Error("Attempt 1 not recorded");
    });

    // Attempt 2
    await vi.waitFor(() => {
      if (record.attempts.length < 2) throw new Error("Attempt 2 not recorded");
    });

    // Attempt 3
    await vi.waitFor(() => {
      if (record.attempts.length < 3) throw new Error("Attempt 3 not recorded");
    });

    // Final failure
    await vi.waitFor(() => {
      if (record.status !== "failed") throw new Error("Not failed yet");
    });

    expect(record.status).toBe("failed");
    expect(queue.getCompletedCount()).toBe(0);
    expect(queue.getFailedCount()).toBe(1);
  });

  it("should return correct queue status", () => {
    mockMonitor.isThrottled.mockReturnValue(true);
    queue.enqueue({ featureId: "feat-1", phaseId: "phase-1", taskId: "T1" });

    const status = queue.getQueue();
    expect(status.throttled).toBe(true);
    expect(status.paused).toBe(false);
    expect(status.queued.length).toBe(1);
  });

  it("should get dispatch by feature and phase", () => {
    mockMonitor.isThrottled.mockReturnValue(true);
    const record = queue.enqueue({
      featureId: "feat-1",
      phaseId: "phase-1",
      taskId: "T1",
    });
    const found = queue.getDispatch("feat-1", "phase-1", "T1");
    expect(found).toBe(record);

    const notFound = queue.getDispatch("feat-2", "phase-1", "T1");
    expect(notFound).toBeNull();
  });
});
