import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { testsGenerateCommand } from "./tests-generate.js";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const { mockExecuteWorkflow, mockLoadConfig } = vi.hoisted(() => ({
  mockExecuteWorkflow: vi.fn(),
  mockLoadConfig: vi.fn().mockReturnValue({
    agents: {
      define: "mock-agent",
    },
  }),
}));

vi.mock("../plugins/workflow-runtime.js", () => ({
  WorkflowRuntime: class {
    executeWorkflow = mockExecuteWorkflow;
  },
}));

vi.mock("../utils/config.js", () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock("../db/runs.js", () => ({
  startRun: vi.fn().mockReturnValue(123),
  finishRun: vi.fn(),
}));

describe("testsGenerateCommand", () => {
  let tempDir: string;
  let featureDir: string;
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tests-gen-test-"));
    featureDir = path.join(tempDir, "specs", "test-feature");
    fs.mkdirSync(featureDir, { recursive: true });
    
    // Create required files (spec + plan only — tasks.json is NOT required)
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Spec");
    fs.writeFileSync(path.join(featureDir, "plan.md"), "# Plan");

    program = new Command();
    program.addCommand(testsGenerateCommand);

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    mockExecuteWorkflow.mockReset();
    mockExecuteWorkflow.mockResolvedValue({
      summary: "Success",
      intents: [],
      summaries: [],
    });
    
    mockLoadConfig.mockReturnValue({
      agents: {
        define: "mock-agent",
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should dispatch the define-tests workflow", async () => {
    mockExecuteWorkflow.mockImplementation(async () => {
      // Simulate agent producing gap-matrix.md (output contract)
      fs.writeFileSync(path.join(featureDir, "gap-matrix.md"), "| AC | Test File |\n");
      return { summary: "Success", intents: [], summaries: [] };
    });

    await program.parseAsync(["node", "test", "tests", "test-feature"]);

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      "gwrk-define-tests",
      expect.stringContaining("Generate tests for feature test-feature"),
      expect.objectContaining({
        agent: "mock-agent",
        projectRoot: tempDir,
      })
    );
  });

  it("US-026/FR-028: SHOULD pass quiet: true to WorkflowRuntime (Phase 12)", async () => {
    mockExecuteWorkflow.mockImplementation(async () => {
      fs.writeFileSync(path.join(featureDir, "gap-matrix.md"), "| AC | Test File |\n");
      return { summary: "Success", intents: [], summaries: [] };
    });

    await program.parseAsync(["node", "test", "tests", "test-feature"]);

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      "gwrk-define-tests",
      expect.anything(),
      expect.objectContaining({
        quiet: true,
      }),
    );
  });

  it("should pass phase context when --phase is provided", async () => {
    mockExecuteWorkflow.mockImplementation(async () => {
      fs.writeFileSync(path.join(featureDir, "gap-matrix.md"), "| AC | Test File |\n");
      return { summary: "Success", intents: [], summaries: [] };
    });

    await program.parseAsync(["node", "test", "tests", "test-feature", "--phase", "1"]);

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      "gwrk-define-tests",
      expect.stringContaining("phase p01"),
      expect.anything()
    );
  });

  it("should fail if spec.md is missing", async () => {
    fs.unlinkSync(path.join(featureDir, "spec.md"));
    process.exitCode = 0;

    try {
      await program.parseAsync(["node", "test", "tests", "test-feature"]);
    } catch {
      // Expected
    }

    expect(process.exitCode).toBe(1);
    expect(mockExecuteWorkflow).not.toHaveBeenCalled();
  });

  it("should refuse to re-run when gap-matrix.md exists without --force", async () => {
    fs.writeFileSync(path.join(featureDir, "gap-matrix.md"), "| AC | Test File |\n");
    process.exitCode = 0;

    try {
      await program.parseAsync(["node", "test", "tests", "test-feature"]);
    } catch {
      // Expected
    }

    expect(process.exitCode).toBe(1);
    expect(mockExecuteWorkflow).not.toHaveBeenCalled();
  });

  it("should allow re-run with --force when gap-matrix.md exists", async () => {
    fs.writeFileSync(path.join(featureDir, "gap-matrix.md"), "| AC | Test File |\n");
    mockExecuteWorkflow.mockImplementation(async () => {
      fs.writeFileSync(path.join(featureDir, "gap-matrix.md"), "| AC | Test File | Updated |\n");
      return { summary: "Success", intents: [], summaries: [] };
    });

    await program.parseAsync(["node", "test", "tests", "test-feature", "--force"]);

    expect(mockExecuteWorkflow).toHaveBeenCalled();
  });
});
