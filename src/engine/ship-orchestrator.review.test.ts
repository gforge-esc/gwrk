import { describe, expect, it, vi, beforeEach } from "vitest";
import { ShipOrchestrator } from "./ship-orchestrator.js";
import { ShipStage } from "./ship-types.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import * as reviewPlugin from "../plugins/review-plugin.js";
import * as stateUtils from "../utils/state.js";
import fs from "node:fs";

vi.mock("../plugins/workflow-runtime.js");
vi.mock("../plugins/review-plugin.js");
vi.mock("../utils/state.js");
vi.mock("../utils/gate-runner.js");
vi.mock("node:fs");
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
    exec: vi.fn(),
    execFile: vi.fn(),
  };
});

describe("ShipOrchestrator Review Plugin Integration", () => {
  const mockConfig = {
    cwd: "/root",
    featureId: "F1",
    phaseId: "phase-1",
    backend: "gemini",
    maxIterations: 3,
  };

  const mockPlugin = {
    name: "review-cli",
    version: "1.0.0",
    description: "CLI Review",
    projectType: "cli",
    codeReviewWorkflow: "review-code-cli",
    uatReviewWorkflow: "review-uat-cli",
    steps: {
      code: [{ id: "lint", title: "Linting", description: "Check lint" }],
      uat: [{ id: "e2e", title: "E2E", description: "Run E2E" }],
    },
  };

  const mockTaskState = {
    phases: [
      {
        id: "phase-1",
        tasks: [{ id: "T1", title: "Task 1", status: "completed" }],
        doneWhen: ["Story 1"],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reviewPlugin.resolveReviewPlugin).mockResolvedValue(mockPlugin as any);
    vi.mocked(stateUtils.loadTaskState).mockReturnValue(mockTaskState as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it("TR-015: stageCodeReview resolves plugin and dispatches via WorkflowRuntime", async () => {
    const orchestrator = new ShipOrchestrator(mockConfig as any);
    
    // @ts-ignore - accessing private method for testing
    const result = await orchestrator.stageCodeReview();

    expect(reviewPlugin.resolveReviewPlugin).toHaveBeenCalledWith("/root");
    
    const runtimeInstance = vi.mocked(WorkflowRuntime).mock.instances[0];
    expect(runtimeInstance.executeWorkflow).toHaveBeenCalledWith(
      "review-code-cli",
      expect.stringContaining("Review Steps:\n- Linting: Check lint"),
      expect.objectContaining({ agent: "gemini" })
    );
    
    expect(reviewPlugin.validatePhaseScope).toHaveBeenCalled();
  });

  it("TR-015: stageUatReview resolves plugin and dispatches via WorkflowRuntime", async () => {
    const orchestrator = new ShipOrchestrator(mockConfig as any);
    
    // @ts-ignore - accessing private method for testing
    const result = await orchestrator.stageUatReview();

    expect(reviewPlugin.resolveReviewPlugin).toHaveBeenCalledWith("/root");
    
    const runtimeInstance = vi.mocked(WorkflowRuntime).mock.instances[0];
    expect(runtimeInstance.executeWorkflow).toHaveBeenCalledWith(
      "review-uat-cli",
      expect.stringContaining("Review Steps:\n- E2E: Run E2E"),
      expect.objectContaining({ agent: "gemini" })
    );
    
    expect(reviewPlugin.validatePhaseScope).toHaveBeenCalled();
  });
});
