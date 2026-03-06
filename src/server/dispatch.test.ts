import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DispatchQueue } from "./dispatch.js";
import { SystemMonitor } from "./monitor.js";
import { SandboxManager } from "./sandbox.js";
import { GitManager } from "./git-manager.js";
import type { GwrkConfig } from "../utils/config.js";
import fs from "node:fs";

import os from "node:os";
import path from "node:path";

vi.mock("./monitor.js");
vi.mock("./sandbox.js");
vi.mock("./git-manager.js");
vi.mock("./persistence.js");
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
    agents: { define: "gemini", implement: "codex-cloud" },
    server: { port: 18790, host: "localhost" },
    parallelism: {
      local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
      cloud: { maxConcurrent: 10 }
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-dispatch-test-"));
    mockMonitor = new SystemMonitor() as any;
    mockSandbox = new SandboxManager() as any;
    mockGit = new GitManager(tempDir) as any;
    queue = new DispatchQueue(mockConfig, mockMonitor, mockSandbox, mockGit, tempDir);
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
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(queue.getActiveCount()).toBe(1);
    expect(queue.getQueueDepth()).toBe(0);
    expect(mockSandbox.createSandbox).toHaveBeenCalled();
  });

  it("should not process next if throttled", async () => {
    mockMonitor.isThrottled.mockReturnValue(true);
    
    queue.enqueue({ featureId: "feat-1", phaseId: "phase-1" });
    
    await new Promise(resolve => setTimeout(resolve, 0));
    
    expect(queue.getActiveCount()).toBe(0);
    expect(queue.getQueueDepth()).toBe(1);
  });
});
