import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import { DispatchOrchestrator } from "./dispatch-orchestrator.js";
import { SandboxManager } from "./sandbox.js";

vi.mock("./sandbox.js", () => {
  return {
    SandboxManager: vi.fn().mockImplementation(() => ({
      createSandbox: vi.fn(),
      destroySandbox: vi.fn(),
    })),
  };
});

describe("DispatchOrchestrator", () => {
  let orchestrator: DispatchOrchestrator;
  let mockSandboxManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSandboxManager = new SandboxManager();
    orchestrator = new DispatchOrchestrator(mockSandboxManager, { maxClones: 2 });
  });

  it("FR-001, FR-004: should limit concurrent task execution based on capacity", async () => {
    const tasks = [
      { id: "T1", backend: "gemini", prompt: "p1" },
      { id: "T2", backend: "gemini", prompt: "p2" },
      { id: "T3", backend: "gemini", prompt: "p3" },
      { id: "T4", backend: "gemini", prompt: "p4" },
      { id: "T5", backend: "gemini", prompt: "p5" },
    ];

    // Mock createSandbox to take some time
    mockSandboxManager.createSandbox.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve("workdir"), 50)));

    const dispatchPromise = orchestrator.dispatchTasks(tasks);

    // After a short time, only 2 sandboxes should be active
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(orchestrator.getActiveCount()).toBe(2);
    expect(orchestrator.getQueuedCount()).toBe(3);

    await dispatchPromise;
    expect(orchestrator.getCompletedCount()).toBe(5);
  });

  it("FR-004 Error States: should throw 'Agent capacity queue timeout' after timeout", async () => {
    // Submit tasks that take a long time to keep capacity busy
    orchestrator = new DispatchOrchestrator(mockSandboxManager, { maxClones: 1, queueTimeout: 10 });
    
    mockSandboxManager.createSandbox.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve("workdir"), 100)));

    // Task 1 will be running
    const t1 = orchestrator.dispatchTasks([{ id: "T1", backend: "gemini", prompt: "p1" }]);

    // Task 2 will be queued and timeout
    await expect(orchestrator.dispatchTasks([{ id: "T2", backend: "gemini", prompt: "p2" }]))
      .rejects.toThrow("Agent capacity queue timeout");

    await t1;
  });

  it("FR-005: should apply exponential backoff with jitter on 429 errors", async () => {
    const task = { id: "T1", backend: "gemini", prompt: "p1" };
    
    // First two attempts fail with 429, third succeeds
    let attempts = 0;
    const timestamps: number[] = [];
    mockSandboxManager.createSandbox.mockImplementation(() => {
      attempts++;
      timestamps.push(Date.now());
      if (attempts <= 2) throw new Error("429 Too Many Requests");
      return Promise.resolve("workdir");
    });

    await orchestrator.dispatchTasks([task]);
    
    expect(attempts).toBe(3);
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(10); // Check for some delay
    expect(orchestrator.getCompletedCount()).toBe(1);
  });

  it("US-005: should route tasks to the correct AgentBackend", async () => {
    const tasks = [
      { id: "T1", backend: "gemini", prompt: "p1" },
      { id: "T2", backend: "claude", prompt: "p2" },
    ];

    await orchestrator.dispatchTasks(tasks);

    expect(mockSandboxManager.createSandbox).toHaveBeenCalledWith(expect.objectContaining({ backend: "gemini" }));
    expect(mockSandboxManager.createSandbox).toHaveBeenCalledWith(expect.objectContaining({ backend: "claude" }));
  });

  it("FR-003: should execute WorkflowRuntime strictly within the workDir", async () => {
    const task = { id: "T1", backend: "gemini", prompt: "p1" };
    mockSandboxManager.createSandbox.mockResolvedValue("/runs/sandboxes/T1");
    
    // This is a unit test, so we verify orchestrator passes the workDir to the ship loop
    await orchestrator.dispatchTasks([task]);
    
    // Expect that some inner loop or agent backend was called with the workDir
    // Since we're in a unit test, we'll verify the orchestrator's state or interaction
    expect(orchestrator.getLastWorkDir("T1")).toBe("/runs/sandboxes/T1");
  });
});
