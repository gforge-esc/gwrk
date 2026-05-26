import { describe, expect, it, vi, beforeEach } from "vitest";
import { ShipOrchestrator } from "./ship-orchestrator.js";
import * as reviewPlugin from "../plugins/review-plugin.js";
import * as stateUtils from "../utils/state.js";
import fs from "node:fs";

vi.mock("../plugins/review-plugin.js");
vi.mock("../utils/state.js");
vi.mock("../utils/gate-runner.js");
vi.mock("node:fs");
// Mock the dynamic import of PluginLoader used in executeReviewWorkflow
vi.mock("../plugins/loader.js", () => ({
  PluginLoader: vi.fn().mockImplementation(() => ({
    resolvePlugin: vi.fn().mockResolvedValue({
      path: "/mock/plugins/review-code-cli",
      manifest: { name: "review-code-cli" },
    }),
  })),
}));
vi.mock("../utils/agent.js", () => ({
  dispatchToAgent: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
}));
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
    // fs.existsSync returns true for PROMPT.md check
    vi.mocked(fs.existsSync).mockReturnValue(true);
    // fs.readFileSync returns mock PROMPT.md content
    vi.mocked(fs.readFileSync).mockReturnValue("# Mock Review Prompt\n\nFull production prompt content here.");
  });

  it("TR-015: stageCodeReview resolves plugin and dispatches via PluginLoader + raw dispatch", async () => {
    const orchestrator = new ShipOrchestrator(mockConfig as any);

    // @ts-ignore - accessing private method for testing
    const result = await orchestrator.stageCodeReview();

    // 1. Must resolve the review plugin to get workflow name
    expect(reviewPlugin.resolveReviewPlugin).toHaveBeenCalledWith("/root");

    // 2. Must attempt to load PROMPT.md from the resolved plugin path
    expect(fs.existsSync).toHaveBeenCalled();
    expect(fs.readFileSync).toHaveBeenCalled();

    // 3. Must validate phase scope after dispatch
    expect(reviewPlugin.validatePhaseScope).toHaveBeenCalled();
  });

  it("TR-015: stageUatReview resolves plugin and dispatches via PluginLoader + raw dispatch", async () => {
    const orchestrator = new ShipOrchestrator(mockConfig as any);

    // @ts-ignore - accessing private method for testing
    const result = await orchestrator.stageUatReview();

    // 1. Must resolve the review plugin to get workflow name
    expect(reviewPlugin.resolveReviewPlugin).toHaveBeenCalledWith("/root");

    // 2. Must attempt to load PROMPT.md from the resolved plugin path
    expect(fs.existsSync).toHaveBeenCalled();
    expect(fs.readFileSync).toHaveBeenCalled();

    // 3. Must validate phase scope after dispatch
    expect(reviewPlugin.validatePhaseScope).toHaveBeenCalled();
  });
});
