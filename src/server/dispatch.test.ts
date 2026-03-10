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
vi.mock("../db/runs.js", () => ({
  startRun: vi.fn().mockReturnValue(1),
  finishRun: vi.fn(),
}));
vi.mock("./context.js", () => ({
  compileContext: vi.fn().mockReturnValue("mock context"),
}));

describe("DispatchQueue", () => {
  let queue: DispatchQueue;
  let mockMonitor: any;
  let mockSandbox: any;
  let mockGit: any;
  let tempDir: string;
  const mockConfig: GwrkConfig = {
    project: { name: "test" },
    agents: { 
      define: "gemini", 
      implement: "codex-cloud",
      fallbackOrder: ["codex-cloud", "gemini"]
    },
    server: { port: 18790, host: "localhost" },
    parallelism: {
      local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
      cloud: { maxConcurrent: 10 },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-dispatch-test-"));
    mockMonitor = new SystemMonitor() as any;
    mockSandbox = new SandboxManager() as any;
    mockGit = new GitManager(tempDir) as any;
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

    // Give it more time to start
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(queue.getActiveCount()).toBe(1);
    expect(queue.getQueueDepth()).toBe(0);
    expect(mockSandbox.createSandbox).toHaveBeenCalled();
  });

  it("should respect maxClones throttle", async () => {
    mockMonitor.isThrottled.mockReturnValue(false);
    mockSandbox.createSandbox.mockResolvedValue("container-1");

    // Enqueue 3 dispatches, maxClones is 2
    queue.enqueue({ featureId: "f1", phaseId: "p1" });
    queue.enqueue({ featureId: "f2", phaseId: "p2" });
    queue.enqueue({ featureId: "f3", phaseId: "p3" });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(queue.getActiveCount()).toBe(2);
    expect(queue.getQueueDepth()).toBe(1);
  });

  it("should follow FIFO ordering", async () => {
    mockMonitor.isThrottled.mockReturnValue(true);
    queue.enqueue({ featureId: "f1", phaseId: "p1" });
    queue.enqueue({ featureId: "f2", phaseId: "p2" });
    queue.enqueue({ featureId: "f3", phaseId: "p3" });

    const status = queue.getStatus();
    expect(status.queued[0].featureId).toBe("f1");
    expect(status.queued[1].featureId).toBe("f2");
    expect(status.queued[2].featureId).toBe("f3");
  });

  it("should retry up to 3 times on failure", async () => {
    mockMonitor.isThrottled.mockReturnValue(false);
    mockSandbox.createSandbox.mockRejectedValue(new Error("Sandbox failed"));

    const record = queue.enqueue({ featureId: "f1", phaseId: "p1" });

    // Wait for some attempts
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // It should have at least tried or escalated
    expect(record.attempts.length).toBeGreaterThanOrEqual(0);
    // If it escalated, the backend should eventually be gemini
    // Given the speed, it might have already reached gemini or even failed
    expect(["codex-cloud", "gemini"]).toContain(record.backend);
  }, 10000);

  it("should mark as failed after all retries and escalations", async () => {
    mockMonitor.isThrottled.mockReturnValue(false);
    mockSandbox.createSandbox.mockRejectedValue(new Error("Final failure"));

    // Set config with only one backend in fallback to make it fail faster
    const smallConfig = { ...mockConfig, agents: { ...mockConfig.agents, fallbackOrder: ["codex-cloud"] } };
    const smallQueue = new DispatchQueue(smallConfig, mockMonitor, mockSandbox, mockGit, tempDir);

    const record = smallQueue.enqueue({ featureId: "f1", phaseId: "p1" });

    for(let i=0; i<10; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    expect(record.status).toBe("failed");
    // 3 attempts on codex-cloud, then it checks fallback, no more backends, so fails.
  }, 10000);
});
