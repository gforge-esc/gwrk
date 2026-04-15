import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShipOrchestrator } from "./ship-orchestrator";
import { ShipStage } from "./ship-types";
import * as fs from "node:fs";
import * as git from "../utils/git";
import * as agent from "../utils/agent";
import * as gateRunner from "../utils/gate-runner";
import * as state from "../utils/state";
import * as reviewPlugin from "../plugins/review-plugin";
import { WorkflowRuntime } from "../plugins/workflow-runtime";

vi.mock("node:fs");
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn().mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh pr list")) return "";
      if (typeof cmd === "string" && cmd.includes("gh pr create")) return "https://github.com/mock/pull/42";
      if (typeof cmd === "string" && cmd.includes("gh pr checks")) return "";
      return "";
    }),
  };
});
vi.mock("../utils/git");
vi.mock("../utils/agent");
vi.mock("../utils/gate-runner");
vi.mock("../utils/state");
vi.mock("../plugins/review-plugin");
vi.mock("../plugins/workflow-runtime");
vi.mock("../utils/manifest", () => ({
  assembleDigest: vi.fn().mockReturnValue(["mock digest"]),
}));

describe("ShipOrchestrator", () => {
  const config = {
    featureId: "004-ship-loop",
    phaseId: "phase-01",
    backend: "gemini",
    maxIterations: 3,
    ciTimeout: 30,
    cwd: "/mock/cwd",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(git.isDirty).mockResolvedValue(false);
    vi.mocked(reviewPlugin.resolveReviewPlugin).mockResolvedValue({
      name: "review-cli",
      version: "1.0.0",
      description: "Mock Review Plugin",
      projectType: "cli",
      codeReviewWorkflow: "review-code-cli",
      uatReviewWorkflow: "review-uat-cli",
      steps: {
        code: [],
        uat: []
      }
    });
    vi.mocked(WorkflowRuntime.prototype.executeWorkflow).mockResolvedValue({
      summary: "Review passed",
      verdict: "GO",
      reopenedTasks: [],
    } as any);
    vi.mocked(state.loadTaskState).mockReturnValue({
      featureId: "004-ship-loop",
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

  it("should initialize with BRANCH_SETUP stage", () => {
    const orchestrator = new ShipOrchestrator(config);
    expect((orchestrator as any).state.stage).toBe(ShipStage.BRANCH_SETUP);
  });

  it("should complete full lifecycle successfully", async () => {
    let callCount = 0;
    vi.mocked(state.loadTaskState).mockImplementation(() => {
      callCount++;
      return {
        featureId: "004-ship-loop",
        createdAt: new Date().toISOString(),
        phases: [{ 
          id: "phase-01", 
          title: "Phase 1", 
          tasks: [{ id: "T001", title: "Task 1", description: "Desc 1", status: callCount >= 2 ? "completed" : "open", gateScript: "gates/T001-gate.sh" }] 
        }]
      };
    });

    vi.mocked(agent.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: "Success",
      stderr: "",
      durationS: 10
    });
    vi.mocked(gateRunner.runGate).mockResolvedValue({
      passed: false,
      exitCode: 1,
      output: "Fail"
    });

    const orchestrator = new ShipOrchestrator(config);
    const exitCode = await orchestrator.run();

    expect(exitCode).toBe(0);
    expect((orchestrator as any).state.stage).toBe(ShipStage.DONE);
    expect(git.createBranch).toHaveBeenCalledWith(config.cwd, "feat/004-ship-loop", "develop");
    expect(agent.dispatchToAgent).toHaveBeenCalledTimes(1); // IMPLEMENT
    expect(WorkflowRuntime.prototype.executeWorkflow).toHaveBeenCalledTimes(2); // CODE_REVIEW, UAT_REVIEW
  });

  it("should fail-fast if working tree is dirty", async () => {
    vi.mocked(git.isDirty).mockResolvedValue(true);

    const orchestrator = new ShipOrchestrator(config);
    const exitCode = await orchestrator.run();

    expect(exitCode).toBe(1);
    expect((orchestrator as any).state.stage).toBe(ShipStage.BRANCH_SETUP);
    expect(git.createBranch).not.toHaveBeenCalled();
  });

  it("should skip implementation if pre-flight gate passes", async () => {
    vi.mocked(gateRunner.runGate).mockResolvedValue({
      passed: true,
      exitCode: 0,
      output: "Pass"
    });
    vi.mocked(agent.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: "Success",
      stderr: "",
      durationS: 10
    });

    const orchestrator = new ShipOrchestrator(config);
    const exitCode = await orchestrator.run();

    expect(exitCode).toBe(0);
    // IMPLEMENT stage should have called runGate but NOT dispatchToAgent for implementation
    expect(gateRunner.runGate).toHaveBeenCalled();
    // 2 calls for reviews, none for implementation
    expect(agent.dispatchToAgent).toHaveBeenCalledTimes(0); 
    expect(WorkflowRuntime.prototype.executeWorkflow).toHaveBeenCalledTimes(2);
  });

  it("should loop back to IMPLEMENT on NO-GO review", async () => {
    // Return open initially (NO-GO for first review), then completed later (GO)
    let callCount = 0;
    vi.mocked(state.loadTaskState).mockImplementation(() => {
      callCount++;
      return {
        featureId: "004-ship-loop",
        createdAt: new Date().toISOString(),
        phases: [{ 
          id: "phase-01", 
          title: "Phase 1", 
          // 4th+ call is when we retry the review! Before that it's open.
          tasks: [{ id: "T001", title: "Task 1", description: "Desc 1", status: callCount >= 4 ? "completed" : "open", gateScript: "gates/T001-gate.sh" }] 
        }]
      };
    });

    vi.mocked(agent.dispatchToAgent)
      .mockResolvedValue({ exitCode: 0, stdout: "Success", stderr: "", durationS: 10 });

    vi.mocked(gateRunner.runGate).mockResolvedValue({
      passed: false,
      exitCode: 1,
      output: "Fail"
    });

    const orchestrator = new ShipOrchestrator(config);
    const exitCode = await orchestrator.run();

    expect(exitCode).toBe(0);
    expect((orchestrator as any).state.iteration).toBe(2);
    expect(agent.dispatchToAgent).toHaveBeenCalledTimes(1); // 1 IMPLEMENT pass, 2nd is skipped as tasks are completed
    expect(WorkflowRuntime.prototype.executeWorkflow).toHaveBeenCalledTimes(3); // 1 NO-GO, 2 GO reviews
  });

  it("should trip circuit breaker after MAX_ITERATIONS", async () => {
    // Always open = always NO-GO
    vi.mocked(state.loadTaskState).mockReturnValue({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      phases: [{ id: "phase-01", title: "Phase 1", tasks: [{ id: "T001", title: "Task 1", description: "Desc 1", status: "open", gateScript: "gates/T001-gate.sh" }] }]
    });

    vi.mocked(agent.dispatchToAgent)
      .mockResolvedValue({ exitCode: 0, stdout: "Success", stderr: "", durationS: 10 });

    vi.mocked(gateRunner.runGate).mockResolvedValue({
      passed: false,
      exitCode: 1,
      output: "Fail"
    });

    const smallConfig = { ...config, maxIterations: 1 };
    const orchestrator = new ShipOrchestrator(smallConfig);
    const exitCode = await orchestrator.run();

    expect(exitCode).toBe(1);
    expect((orchestrator as any).state.stage).toBe(ShipStage.CIRCUIT_BREAK);
  });

  it("should emit plan:ship:complete when stage becomes DONE", async () => {
    // Mock successful run
    vi.mocked(gateRunner.runGate).mockResolvedValue({
      passed: true,
      exitCode: 0,
      output: "Pass",
    });
    vi.mocked(agent.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: "Success",
      stderr: "",
      durationS: 10,
    });
    vi.mocked(state.loadTaskState).mockReturnValue({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          sp_estimate: 5,
          tasks: [
            {
              id: "T001",
              title: "Task 1",
              description: "Desc 1",
              status: "completed",
              gateScript: "gates/T001-gate.sh",
              sp: 5,
            },
          ],
        },
      ],
    });

    const orchestrator = new ShipOrchestrator(config);
    const spy = vi.fn();
    orchestrator.on("plan:ship:complete", spy);

    await orchestrator.run();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        featureId: config.featureId,
        phaseId: config.phaseId,
        sp_actual: 5,
      }),
    );
  });
});
