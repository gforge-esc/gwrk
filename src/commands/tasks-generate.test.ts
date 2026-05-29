import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { tasksGenerateCommand } from "./tasks-generate.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Command } from "commander";

const { mockExecuteWorkflow, mockWriteManifest } = vi.hoisted(() => ({
  mockExecuteWorkflow: vi.fn(),
  mockWriteManifest: vi.fn(),
}));

vi.mock("../plugins/workflow-runtime.js", () => ({
  WorkflowRuntime: class {
    executeWorkflow = mockExecuteWorkflow;
  },
}));

vi.mock("../utils/manifest.js", () => ({
  writeManifest: mockWriteManifest,
  generateRunId: vi.fn().mockReturnValue("mock-run-id"),
}));

vi.mock("../utils/git.js", () => ({
  getCurrentCommit: vi.fn().mockReturnValue("mock-commit"),
  getCurrentBranch: vi.fn().mockReturnValue("mock-branch"),
  getDiffStats: vi.fn().mockReturnValue({ filesChanged: 0, linesAdded: 0, linesDeleted: 0 }),
}));

// Mock format.js to avoid messy output
vi.mock("../utils/format.js", () => ({
  banner: vi.fn(),
  blocked: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
}));

describe("tasks-generate (Phase 6 Rewire)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tasks-generate-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    
    // Create necessary structure
    const specDir = path.join(tempDir, "specs", "test-feature");
    fs.mkdirSync(path.join(specDir, ".gwrk"), { recursive: true });
    fs.mkdirSync(path.join(specDir, "gates"), { recursive: true });
    fs.mkdirSync(path.join(specDir, "contracts"), { recursive: true });
    
    // Create a mock config
    fs.writeFileSync(path.join(tempDir, ".gwrkrc.json"), JSON.stringify({ project: { name: "test-feature" }, agents: { define: "gemini", implement: "gemini" } }));

    // Create a plan.md
    fs.writeFileSync(path.join(specDir, "plan.md"), `# Plan: test-feature`);
    
    // Create gap-matrix.md to satisfy the guard
    fs.writeFileSync(path.join(specDir, "gap-matrix.md"), "| AC | Test File |\n|----|-----------|\n");

    mockExecuteWorkflow.mockReset();
    mockExecuteWorkflow.mockResolvedValue({
      summary: "Success",
      intents: [],
      summaries: [],
    });
    mockWriteManifest.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should write execution manifest after success", async () => {
    const program = new Command();
    program.addCommand(tasksGenerateCommand);
    await program.parseAsync(["node", "test", "tasks", "test-feature"]);
    
    const featureDir = path.join(tempDir, "specs", "test-feature");
    expect(mockWriteManifest).toHaveBeenCalledWith(
      featureDir,
      expect.objectContaining({
        command: "define tasks",
        feature: "test-feature",
      })
    );
  });

  it("should use gwrk-plan-to-tasks workflow and pass quiet: true", async () => {
    const program = new Command();
    program.addCommand(tasksGenerateCommand);
    
    await program.parseAsync(["node", "test", "tasks", "test-feature", "--force", "--reconcile"]);

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      "gwrk-plan-to-tasks",
      expect.stringContaining("--force"),
      expect.objectContaining({
        quiet: true,
      }),
    );
    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      "gwrk-plan-to-tasks",
      expect.stringContaining("--reconcile"),
      expect.anything()
    );
  });
});
