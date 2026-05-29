import { describe, it, expect, vi, beforeEach } from "vitest";
import { DefineOrchestrator } from "./define-orchestrator.js";
import { DefineStage } from "./define-types.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import * as fs from "node:fs";
import * as state from "../utils/state.js";

vi.mock("node:fs");
vi.mock("../plugins/workflow-runtime.js");
vi.mock("../utils/state.js");

describe("DefineOrchestrator", () => {
  const config = {
    featureId: "014-plugin-system",
    backend: "gemini",
    cwd: "/mock/cwd",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(state.loadTaskState).mockReturnValue({
      featureId: "014-plugin-system",
      createdAt: new Date().toISOString(),
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          tasks: [
            { id: "T001", title: "Task 1", description: "Desc 1", status: "open", gateScript: "gates/T001-gate.sh" }
          ]
        }
      ]
    });
  });

  it("should initialize with SPECIFY stage if no spec exists", () => {
    vi.mocked(fs.existsSync).mockImplementation((p: string) => {
      if (typeof p === "string" && p.endsWith("spec.md")) return false;
      return true;
    });

    const orchestrator = new DefineOrchestrator(config);
    // Note: initializeState is private, so we check the initial stage via run or by making it public/checked via runLoop
    expect((orchestrator as any).state.stage).toBe(DefineStage.SPECIFY);
  });

  it("should initialize with PLAN stage if spec exists but no plan exists", () => {
    vi.mocked(fs.existsSync).mockImplementation((p: string) => {
      if (typeof p === "string" && p.endsWith("spec.md")) return true;
      if (typeof p === "string" && p.endsWith("plan.md")) return false;
      return true;
    });

    const orchestrator = new DefineOrchestrator(config);
    expect((orchestrator as any).state.stage).toBe(DefineStage.PLAN);
  });

  it("should initialize with PLAN_TO_TASKS stage if spec and plan exist but no tasks exist", () => {
    vi.mocked(fs.existsSync).mockImplementation((p: string) => {
      if (typeof p === "string" && p.endsWith("spec.md")) return true;
      if (typeof p === "string" && p.endsWith("plan.md")) return true;
      if (typeof p === "string" && p.endsWith("tasks.json")) return false;
      return true;
    });

    const orchestrator = new DefineOrchestrator(config);
    expect((orchestrator as any).state.stage).toBe(DefineStage.PLAN_TO_TASKS);
  });

  it("should complete full lifecycle successfully", async () => {
    const mockRuntime = new WorkflowRuntime() as any;
    mockRuntime.executeWorkflow.mockResolvedValue({
      summary: "Success",
      intents: [],
      summaries: []
    });

    const orchestrator = new DefineOrchestrator(config, undefined, mockRuntime);
    
    // Start from SPECIFY for the full loop
    (orchestrator as any).state.stage = DefineStage.SPECIFY;

    const exitCode = await orchestrator.run();

    expect(exitCode).toBe(0);
    expect((orchestrator as any).state.stage).toBe(DefineStage.DONE);
    
    // Check that all workflows were called
    expect(mockRuntime.executeWorkflow).toHaveBeenCalledWith("gwrk-specify", expect.any(String), expect.any(Object));
    expect(mockRuntime.executeWorkflow).toHaveBeenCalledWith("gwrk-plan", expect.any(String), expect.any(Object));
    expect(mockRuntime.executeWorkflow).toHaveBeenCalledWith("gwrk-plan-to-tasks", expect.any(String), expect.any(Object));
    expect(mockRuntime.executeWorkflow).toHaveBeenCalledWith("gwrk-analyze", expect.any(String), expect.any(Object));
    expect(mockRuntime.executeWorkflow).toHaveBeenCalledWith("gwrk-define-tests", expect.any(String), expect.any(Object));
  });

  it("should transition through SPECIFY, PLAN, PLAN_TO_TASKS sequentially", async () => {
     const mockRuntime = new WorkflowRuntime() as any;
    mockRuntime.executeWorkflow.mockResolvedValue({
      summary: "Success",
      intents: [],
      summaries: []
    });

    const orchestrator = new DefineOrchestrator(config, undefined, mockRuntime);
    (orchestrator as any).state.stage = DefineStage.SPECIFY;

    // Use a spy to track state transitions if possible, or just check the calls
    await orchestrator.run();

    const calls = mockRuntime.executeWorkflow.mock.calls;
    expect(calls[0][0]).toBe("gwrk-specify");
    expect(calls[1][0]).toBe("gwrk-plan");
    expect(calls[2][0]).toBe("gwrk-plan-to-tasks");
    expect(calls[3][0]).toBe("gwrk-analyze");
  });
});
