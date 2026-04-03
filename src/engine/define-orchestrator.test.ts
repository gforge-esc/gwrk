import { describe, it, expect, vi, beforeEach } from "vitest";
import { DefineOrchestrator } from "./define-orchestrator.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import fs from "node:fs";

vi.mock("../plugins/workflow-runtime.js");
vi.mock("node:fs");

describe("DefineOrchestrator (FR-L25-003, FR-L25-004, US-013, TR-010)", () => {
  let orchestrator: DefineOrchestrator;
  let mockRuntime: vi.Mocked<WorkflowRuntime>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntime = new WorkflowRuntime() as vi.Mocked<WorkflowRuntime>;
    orchestrator = new DefineOrchestrator(mockRuntime);
  });

  describe("executeSpecify", () => {
    it("SHOULD call executeWorkflow with gwrk-specify", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockRuntime.executeWorkflow.mockResolvedValue({
        summary: "Done",
        intents: [],
        summaries: [],
      });

      await orchestrator.executeSpecify("test-feature", "New feature");

      expect(mockRuntime.executeWorkflow).toHaveBeenCalledWith(
        "gwrk-specify",
        expect.stringContaining("Create a NEW spec for feature test-feature"),
        expect.anything(),
      );
    });

    it("SHOULD handle rework if spec exists", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockRuntime.executeWorkflow.mockResolvedValue({
        summary: "Done",
        intents: [],
        summaries: [],
      });

      await orchestrator.executeSpecify("test-feature", "Rework it");

      expect(mockRuntime.executeWorkflow).toHaveBeenCalledWith(
        "gwrk-specify",
        expect.stringContaining("REWORK existing spec for feature test-feature"),
        expect.anything(),
      );
    });
  });

  describe("executePlan", () => {
    it("SHOULD call executeWorkflow with gwrk-plan", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockRuntime.executeWorkflow.mockResolvedValue({
        summary: "Done",
        intents: [],
        summaries: [],
      });

      await orchestrator.executePlan("test-feature");

      expect(mockRuntime.executeWorkflow).toHaveBeenCalledWith(
        "gwrk-plan",
        expect.stringContaining(
          "Create an implementation plan for feature test-feature",
        ),
        expect.anything(),
      );
    });

    it("SHOULD fail if spec is missing", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(orchestrator.executePlan("test-feature")).rejects.toThrow(
        "spec.md not found",
      );
    });
  });

  describe("executeTasks", () => {
    it("SHOULD call executeWorkflow with gwrk-author-gates", async () => {
      mockRuntime.executeWorkflow.mockResolvedValue({
        summary: "Done",
        intents: [],
        summaries: [],
      });

      await orchestrator.executeTasks("test-feature", "brief-path");

      expect(mockRuntime.executeWorkflow).toHaveBeenCalledWith(
        "gwrk-author-gates",
        "brief-path",
        expect.anything(),
      );
    });
  });

  describe("runLoop (FR-L25-004, US-013, TR-010)", () => {
    it("TR-010: SHOULD transition through SPEC, PLAN, and TASKS sequentially", async () => {
      // Mock FS to indicate a fresh project, but allow stages to proceed
      let specExists = false;
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (typeof p !== "string") return false;
        if (p.endsWith("spec.md")) return specExists;
        return false;
      });

      mockRuntime.executeWorkflow.mockImplementation(async (name) => {
        if (name === "gwrk-specify") specExists = true;
        return {
          summary: "Done",
          intents: [],
          summaries: [],
        };
      });

      await orchestrator.runLoop("test-feature", "New feature description");

      // Verify sequence
      const calls = mockRuntime.executeWorkflow.mock.calls;
      expect(calls[0][0]).toBe("gwrk-specify");
      expect(calls[1][0]).toBe("gwrk-plan");
      expect(calls[2][0]).toBe("gwrk-author-gates");
    });

    it("SHOULD skip completed stages", async () => {
      // Mock FS to indicate spec and plan exist, but tasks don't
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path !== "string") return false;
        if (path.endsWith("spec.md")) return true;
        if (path.endsWith("plan.md")) return true;
        if (path.endsWith("tasks.json")) return false;
        return false;
      });

      mockRuntime.executeWorkflow.mockResolvedValue({
        summary: "Done",
        intents: [],
        summaries: [],
      });

      await orchestrator.runLoop("test-feature");

      // Should only run TASKS
      expect(mockRuntime.executeWorkflow).toHaveBeenCalledTimes(1);
      expect(mockRuntime.executeWorkflow).toHaveBeenCalledWith(
        "gwrk-author-gates",
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
