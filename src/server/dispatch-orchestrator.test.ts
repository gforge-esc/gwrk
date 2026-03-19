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

  it("FR-005: should apply exponential backoff on 429 errors", async () => {
    const task = { id: "T1", backend: "gemini", prompt: "p1" };
    
    // First attempt fails with 429, second succeeds
    let attempts = 0;
    mockSandboxManager.createSandbox.mockImplementation(() => {
      attempts++;
      if (attempts === 1) throw new Error("429 Too Many Requests");
      return Promise.resolve("workdir");
    });

    await orchestrator.dispatchTasks([task]);
    
    expect(attempts).toBe(2);
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
});
