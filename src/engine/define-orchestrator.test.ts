import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DefineOrchestrator } from "./define-orchestrator.js";
import { DefineStage } from "./define-types.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as state from "../utils/state.js";
import * as agent from "../utils/agent.js";

// Mock only the lowest level boundaries
vi.mock("../utils/agent.js", async () => {
  const actual = await vi.importActual<any>("../utils/agent.js");
  return {
    ...actual,
    dispatchToAgent: vi.fn(),
  };
});

// We still mock loadTaskState for DEFINE_TESTS stage to avoid complex DB setup
vi.mock("../utils/state.js", () => ({
  loadTaskState: vi.fn(),
}));

describe("DefineOrchestrator (Integration)", () => {
  let tempDir: string;
  const config = {
    featureId: "014-plugin-system",
    backend: "gemini",
    cwd: "", // Will be set in beforeEach
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "define-orch-test-"));
    config.cwd = tempDir;

    // Set up mock workflows in builtins-like structure
    const workflowsDir = path.join(tempDir, ".gwrk", "plugins", "workflows");
    const workflows = ["gwrk-specify", "gwrk-plan", "gwrk-plan-to-tasks", "gwrk-analyze", "gwrk-define-tests"];
    
    for (const w of workflows) {
      const dir = path.join(workflowsDir, w);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "manifest.yaml"), `name: ${w}\ntype: workflow\noutputSchema:\n  type: object\n  required: [summary, intents]\n  properties:\n    summary:\n      type: string\n    intents:\n      type: array`);
      fs.writeFileSync(path.join(dir, "PROMPT.md"), `Prompt for ${w}`);
    }

    vi.mocked(agent.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        summary: "Mocked Success",
        intents: []
      }),
      stderr: "",
      durationS: 1,
      logPath: "mock.log"
    });

    vi.mocked(state.loadTaskState).mockReturnValue({
      featureId: "014-plugin-system",
      createdAt: new Date().toISOString(),
      phases: []
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should initialize with SPECIFY stage if no spec exists", () => {
    const orchestrator = new DefineOrchestrator(config);
    expect((orchestrator as any).state.stage).toBe(DefineStage.SPECIFY);
  });

  it("should initialize with PLAN stage if spec exists", () => {
    const featureDir = path.join(tempDir, "specs", config.featureId);
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, "spec.md"), "Spec content that is long enough to not be a stub and doesn't contain placeholders. ".repeat(3));

    const orchestrator = new DefineOrchestrator(config);
    expect((orchestrator as any).state.stage).toBe(DefineStage.PLAN);
  });

  it("should transition through full lifecycle and persist state", async () => {
    const orchestrator = new DefineOrchestrator(config);
    
    // Track calls to dispatchToAgent to verify transitions
    await orchestrator.runLoop();

    expect(agent.dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({ workflow: "gwrk-specify" }));
    expect(agent.dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({ workflow: "gwrk-plan" }));
    expect(agent.dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({ workflow: "gwrk-define-tests" }));
    expect(agent.dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({ workflow: "gwrk-plan-to-tasks" }));
    expect(agent.dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({ workflow: "gwrk-analyze" }));
    
    expect((orchestrator as any).state.stage).toBe(DefineStage.DONE);
  });

  it("should resume from persisted state file", async () => {
    const statePath = path.join(tempDir, ".runs", `${config.featureId}_define.state`);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({
      stage: DefineStage.PLAN_TO_TASKS,
      featureId: config.featureId,
      startedAt: new Date().toISOString(),
      runId: "resumed-run",
      backend: config.backend
    }));

    const orchestrator = new DefineOrchestrator(config);
    expect((orchestrator as any).state.stage).toBe(DefineStage.PLAN_TO_TASKS);

    await orchestrator.runLoop();
    
    // Should NOT have called specify, plan, or define-tests
    expect(agent.dispatchToAgent).not.toHaveBeenCalledWith(expect.objectContaining({ workflow: "gwrk-specify" }));
    expect(agent.dispatchToAgent).not.toHaveBeenCalledWith(expect.objectContaining({ workflow: "gwrk-plan" }));
    expect(agent.dispatchToAgent).not.toHaveBeenCalledWith(expect.objectContaining({ workflow: "gwrk-define-tests" }));
    
    // SHOULD have called plan-to-tasks and analyze
    expect(agent.dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({ workflow: "gwrk-plan-to-tasks" }));
    expect(agent.dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({ workflow: "gwrk-analyze" }));
  });

  it("should fail and stop if a stage fails", async () => {
    vi.mocked(agent.dispatchToAgent).mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "Agent Error",
      durationS: 1
    });

    const orchestrator = new DefineOrchestrator(config);
    const exitCode = await orchestrator.runLoop();

    expect(exitCode).toBe(1);
    expect((orchestrator as any).state.stage).toBe(DefineStage.SPECIFY); // Stayed at failed stage
    
    // Verify state was persisted
    const statePath = path.join(tempDir, ".runs", `${config.featureId}_define.state`);
    expect(fs.existsSync(statePath)).toBe(true);
    const savedState = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    expect(savedState.stage).toBe(DefineStage.SPECIFY);
  });
});
