// src/commands/implement.test.ts
// RED tests — Phase 1: Implement command
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executePhase } from "./implement.js"; // RED — module does not exist yet
import type { GwrkConfig } from "../utils/config.js";

// Mock all dependencies
vi.mock("../utils/state.js", () => ({
  loadTaskState: vi.fn(),
  nextTask: vi.fn(),
  markTaskComplete: vi.fn(),
  saveTaskState: vi.fn(),
}));

vi.mock("../utils/exec.js", () => ({
  runGate: vi.fn(),
}));

vi.mock("../utils/agent.js", () => ({
  dispatchAgent: vi.fn(),
}));

vi.mock("../utils/branch.js", () => ({
  ensureBranch: vi.fn().mockResolvedValue("feat/test-feature"),
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { loadTaskState, nextTask, markTaskComplete } from "../utils/state.js";
import { runGate } from "../utils/exec.js";
import { dispatchAgent } from "../utils/agent.js";
import { ensureBranch } from "../utils/branch.js";
import { execFileSync } from "node:child_process";

const mockLoadTaskState = vi.mocked(loadTaskState);
const mockNextTask = vi.mocked(nextTask);
const mockMarkTaskComplete = vi.mocked(markTaskComplete);
const mockRunGate = vi.mocked(runGate);
const mockDispatchAgent = vi.mocked(dispatchAgent);
const mockEnsureBranch = vi.mocked(ensureBranch);
const mockExec = vi.mocked(execFileSync);

const testConfig: GwrkConfig = {
  project: { name: "test-project" },
  agents: { define: "gemini", implement: "gemini" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FR-001: gwrk implement — task loop execution", () => {
  it("US-001 #1: iterates all tasks in phase and completes them", async () => {
    // Setup: 3 tasks in phase-01
    const mockState = {
      feature: "004-wud-loop",
      phases: [{
        id: "phase-01",
        name: "Phase 1",
        tasks: [
          { id: "T001", title: "Task 1", description: "Desc 1", status: "open" as const },
          { id: "T002", title: "Task 2", description: "Desc 2", status: "open" as const },
          { id: "T003", title: "Task 3", description: "Desc 3", status: "open" as const },
        ],
      }],
    };

    mockLoadTaskState.mockReturnValue(mockState);
    // nextTask returns tasks sequentially, then null
    mockNextTask
      .mockReturnValueOnce(mockState.phases[0].tasks[0])
      .mockReturnValueOnce(mockState.phases[0].tasks[1])
      .mockReturnValueOnce(mockState.phases[0].tasks[2])
      .mockReturnValueOnce(null);
    // Pre-flight gates FAIL (expected — not yet implemented)
    mockRunGate.mockReturnValue({ exitCode: 1, stdout: "", stderr: "" });
    // Agent dispatch succeeds
    mockDispatchAgent.mockResolvedValue({ exitCode: 0, stdout: "done", stderr: "" });
    // Mark complete returns updated state
    mockMarkTaskComplete.mockReturnValue(mockState);

    const result = await executePhase({
      featureDir: "specs/004-wud-loop",
      phaseNumber: 1,
      config: testConfig,
    });

    expect(result.tasksCompleted).toBe(3);
    expect(result.totalTasks).toBe(3);
    expect(mockDispatchAgent).toHaveBeenCalledTimes(3);
    expect(mockMarkTaskComplete).toHaveBeenCalledTimes(3);
  });

  it("rejects: tasks.json not found", async () => {
    // FR-001 error state — missing tasks.json
    mockLoadTaskState.mockImplementation(() => {
      throw new Error("tasks.json not found for feature");
    });

    await expect(
      executePhase({
        featureDir: "specs/nonexistent",
        phaseNumber: 1,
        config: testConfig,
      })
    ).rejects.toThrow("tasks.json not found");
  });

  it("rejects: phase not found in tasks.json", async () => {
    // FR-001 error state — missing phase
    mockLoadTaskState.mockReturnValue({
      feature: "004-wud-loop",
      phases: [{ id: "phase-01", name: "Phase 1", tasks: [] }],
    });

    await expect(
      executePhase({
        featureDir: "specs/004-wud-loop",
        phaseNumber: 99,
        config: testConfig,
      })
    ).rejects.toThrow(/[Pp]hase.*not found/);
  });
});

describe("FR-002: Branch management integration", () => {
  it("US-007 #1: calls ensureBranch before task execution", async () => {
    mockLoadTaskState.mockReturnValue({
      feature: "004-wud-loop",
      phases: [{ id: "phase-01", name: "Phase 1", tasks: [] }],
    });
    mockNextTask.mockReturnValue(null);

    await executePhase({
      featureDir: "specs/004-wud-loop",
      phaseNumber: 1,
      config: testConfig,
    });

    expect(mockEnsureBranch).toHaveBeenCalledWith("004-wud-loop");
  });
});

describe("FR-003: Pre-flight gate enforcement", () => {
  it("US-002 #1: skips task when pre-flight gate already passes (exit 0)", async () => {
    const mockState = {
      feature: "004-wud-loop",
      phases: [{
        id: "phase-01",
        name: "Phase 1",
        tasks: [
          { id: "T001", title: "Already done", description: "Gate already passes", status: "open" as const },
        ],
      }],
    };

    mockLoadTaskState.mockReturnValue(mockState);
    mockNextTask
      .mockReturnValueOnce(mockState.phases[0].tasks[0])
      .mockReturnValueOnce(null);
    // Pre-flight gate PASSES (exit 0) — should skip
    mockRunGate.mockReturnValue({ exitCode: 0, stdout: "PASS", stderr: "" });

    const result = await executePhase({
      featureDir: "specs/004-wud-loop",
      phaseNumber: 1,
      config: testConfig,
    });

    expect(result.tasksSkipped).toBe(1);
    expect(result.tasksCompleted).toBe(0);
    // Agent should NOT be dispatched for skipped tasks
    expect(mockDispatchAgent).not.toHaveBeenCalled();
  });

  it("US-002 #2: proceeds when pre-flight gate fails (exit 1) — expected", async () => {
    const mockState = {
      feature: "004-wud-loop",
      phases: [{
        id: "phase-01",
        name: "Phase 1",
        tasks: [
          { id: "T001", title: "Todo", description: "Needs work", status: "open" as const },
        ],
      }],
    };

    mockLoadTaskState.mockReturnValue(mockState);
    mockNextTask
      .mockReturnValueOnce(mockState.phases[0].tasks[0])
      .mockReturnValueOnce(null);
    // Pre-flight FAILS (expected — task needs implementation)
    mockRunGate.mockReturnValueOnce({ exitCode: 1, stdout: "", stderr: "FAIL" });
    // Post-flight PASSES (task implemented)
    mockRunGate.mockReturnValueOnce({ exitCode: 0, stdout: "PASS", stderr: "" });
    mockDispatchAgent.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mockMarkTaskComplete.mockReturnValue(mockState);

    const result = await executePhase({
      featureDir: "specs/004-wud-loop",
      phaseNumber: 1,
      config: testConfig,
    });

    expect(result.tasksCompleted).toBe(1);
    expect(mockDispatchAgent).toHaveBeenCalledTimes(1);
  });
});

describe("FR-009: Agent dispatch configuration", () => {
  it("US-008: dispatches agent with backend from config", async () => {
    const mockState = {
      feature: "004-wud-loop",
      phases: [{
        id: "phase-01",
        name: "Phase 1",
        tasks: [
          { id: "T001", title: "Task", description: "Desc", status: "open" as const },
        ],
      }],
    };

    mockLoadTaskState.mockReturnValue(mockState);
    mockNextTask
      .mockReturnValueOnce(mockState.phases[0].tasks[0])
      .mockReturnValueOnce(null);
    mockRunGate
      .mockReturnValueOnce({ exitCode: 1, stdout: "", stderr: "" }) // pre-flight FAIL
      .mockReturnValueOnce({ exitCode: 0, stdout: "", stderr: "" }); // post-flight PASS
    mockDispatchAgent.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mockMarkTaskComplete.mockReturnValue(mockState);

    await executePhase({
      featureDir: "specs/004-wud-loop",
      phaseNumber: 1,
      config: testConfig,
    });

    expect(mockDispatchAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: "gemini", // from config.agents.implement
      })
    );
  });
});
