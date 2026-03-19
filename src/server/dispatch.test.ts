import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GwrkConfig } from "../utils/config.js";
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
  let tempDir: string;
  const mockConfig: GwrkConfig = {
    project: { name: "test" },
    agents: { define: "gemini", implement: "codex-cloud" },
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
    mockSandbox = new SandboxManager() as vi.Mocked<SandboxManager>;
    mockGit = new GitManager(tempDir) as vi.Mocked<GitManager>;
    queue = new DispatchQueue(
      mockConfig,
      mockMonitor,
      mockSandbox,
      mockGit,
      tempDir,
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should enqueue a dispatch request", () => {
    mockMonitor.isThrottled.mockReturnValue(true);
    const record = queue.enqueue({ featureId: "feat-1", phaseId: "phase-1" });
    expect(record.status).toBe("queued");
    expect(queue.getQueueDepth()).toBe(1);
  });

  it("should process next if not throttled", async () => {
    mockMonitor.isThrottled.mockReturnValue(false);
    mockSandbox.createSandbox.mockResolvedValue("container-1");

    queue.enqueue({ featureId: "feat-1", phaseId: "phase-1" });

    // Wait for it to move to active
    await vi.waitFor(() => {
      if (queue.getActiveCount() !== 1) throw new Error("Not active yet");
    });

    expect(queue.getQueueDepth()).toBe(0);
    expect(mockSandbox.createSandbox).toHaveBeenCalled();
  });

  it("should not process next if throttled", async () => {
    mockMonitor.isThrottled.mockReturnValue(true);

    queue.enqueue({ featureId: "feat-1", phaseId: "phase-1" });

    // Wait a bit to ensure it doesn't process
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(queue.getActiveCount()).toBe(0);
    expect(queue.getQueueDepth()).toBe(1);
  });

  it("should handle successful completion", async () => {
    mockMonitor.isThrottled.mockReturnValue(false);
    mockSandbox.createSandbox.mockResolvedValue("container-1");

    const record = queue.enqueue({ featureId: "feat-1", phaseId: "phase-1" });

    // Wait for it to move to active
    await vi.waitFor(() => {
      if (queue.getActiveCount() !== 1) throw new Error("Not active yet");
    });

    await queue.handleCompletion(record.id, 0, "");

    expect(record.status).toBe("completed");
    expect(queue.getActiveCount()).toBe(0);
    expect(mockGit.mergePhaseBack).toHaveBeenCalledWith("feat-1", "phase-1");
    expect(mockSandbox.destroySandbox).toHaveBeenCalledWith("container-1");
  });

  it("should retry if exit code is non-zero and attempts < 3", async () => {
    mockMonitor.isThrottled.mockReturnValue(false);
    mockSandbox.createSandbox.mockResolvedValue("container-1");

    const record = queue.enqueue({ featureId: "feat-1", phaseId: "phase-1" });

    // Wait for it to move to active
    await vi.waitFor(() => {
      if (queue.getActiveCount() !== 1) throw new Error("Not active yet");
    });

    // Throttle so it stays in queue after handleCompletion
    mockMonitor.isThrottled.mockReturnValue(true);
    await queue.handleCompletion(record.id, 1, "error");

    expect(record.status).toBe("retrying");
    expect(queue.getQueueDepth()).toBe(1);
    expect(record.attempts.length).toBe(1);
  });

  it("should escalate if attempts >= 3", async () => {
    mockMonitor.isThrottled.mockReturnValue(false);
    mockSandbox.createSandbox.mockResolvedValue("container-1");

    // Config implement: codex-cloud (last in fallback order)
    const record = queue.enqueue({ featureId: "feat-1", phaseId: "phase-1" });

    // Attempt 1
    await vi.waitFor(() => {
      if (queue.getActiveCount() !== 1) throw new Error("Not active yet");
    });
    await queue.handleCompletion(record.id, 1, "error");

    // Attempt 2
    await vi.waitFor(() => {
      if (queue.getActiveCount() !== 1) throw new Error("Not active yet");
    });
    await queue.handleCompletion(record.id, 1, "error");

    // Attempt 3
    await vi.waitFor(() => {
      if (queue.getActiveCount() !== 1) throw new Error("Not active yet");
    });
    // Final failure should not be throttled to see 'failed' status immediately
    await queue.handleCompletion(record.id, 1, "error");

    expect(record.status).toBe("failed");
    expect(queue.getCompletedCount()).toBe(0);
    expect(queue.getFailedCount()).toBe(1);
  });

  it("should process multiple tasks within a phase concurrently", async () => {
    mockMonitor.isThrottled.mockReturnValue(false);
    mockSandbox.createSandbox.mockResolvedValue("workdir-1");

    // In 005, a phase dispatch request should be able to contain tasks
    queue.enqueue({ 
      featureId: "feat-1", 
      phaseId: "phase-1",
      tasks: [
        { id: "T1", prompt: "Task 1" },
        { id: "T2", prompt: "Task 2" }
      ]
    });

    // Wait for both tasks to move to active sandboxes
    await vi.waitFor(() => {
      // In 005, we check for active sandboxes, not just active phases
      if (queue.getDispatch("feat-1", "phase-1")?.activeSandboxes?.length !== 2) {
        throw new Error("Tasks not active yet");
      }
    });

    expect(mockSandbox.createSandbox).toHaveBeenCalledTimes(2);
  });

  it("should return correct queue status", () => {
    mockMonitor.isThrottled.mockReturnValue(true);
    queue.enqueue({ featureId: "feat-1", phaseId: "phase-1" });

    const status = queue.getQueue();
    expect(status.throttled).toBe(true);
    expect(status.paused).toBe(false);
    expect(status.queued.length).toBe(1);
  });

  it("should get dispatch by feature and phase", () => {
    mockMonitor.isThrottled.mockReturnValue(true);
    const record = queue.enqueue({ featureId: "feat-1", phaseId: "phase-1" });
    const found = queue.getDispatch("feat-1", "phase-1");
    expect(found).toBe(record);

    const notFound = queue.getDispatch("feat-2", "phase-1");
    expect(notFound).toBeNull();
  });
});
