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

vi.mock("../utils/git.js", () => ({
  getCurrentCommit: vi.fn().mockReturnValue("abc123"),
  getCurrentBranch: vi.fn().mockReturnValue("develop"),
  getDiffStats: vi.fn().mockReturnValue({ filesChanged: 1, linesAdded: 10, linesDeleted: 0 }),
}));

vi.mock("../utils/manifest.js", () => ({
  generateRunId: vi.fn().mockReturnValue("test-run-id"),
  writeManifest: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue(""),
}));

describe("testsGenerateCommand: Output Contract Fix (Phase 11/12)", () => {
  let tempDir: string;
  let featureDir: string;
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tests-gen-contract-test-"));
    featureDir = path.join(tempDir, "specs", "test-feature");
    fs.mkdirSync(featureDir, { recursive: true });
    
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Spec");
    fs.writeFileSync(path.join(featureDir, "plan.md"), "# Plan");

    program = new Command();
    program.addCommand(testsGenerateCommand);

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

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

  // NOTE: --force test MUST run first because Commander's testsGenerateCommand is a
  // module-level singleton that stores parsed option state. Once parsed without --force,
  // the command cannot be re-parsed with --force in the same process.

  it("US-026/FR-029: SHOULD succeed even if agent returns prose if artifacts exist (Phase 12)", async () => {
    // Simulate: agent produces test files (native execution) and returns success
    mockExecuteWorkflow.mockImplementation(async () => {
      const srcDir = path.join(tempDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "phase12.test.ts"), "// Phase 12 test");
      return { summary: "Synthetic Success", intents: [], summaries: [] };
    });

    process.exitCode = 0;
    await program.parseAsync(["node", "test", "tests", "test-feature", "--force"]);

    expect(mockExecuteWorkflow).toHaveBeenCalled();
    expect(fs.existsSync(path.join(tempDir, "src", "phase12.test.ts"))).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  it("should succeed when agent produces test files in src/ instead of gap-matrix.md (FR-027)", async () => {
    mockExecuteWorkflow.mockImplementation(async () => {
      const srcDir = path.join(tempDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "new-feature.test.ts"), "it('works', () => {})");
      return { summary: "Success", intents: [], summaries: [] };
    });

    process.exitCode = 0;
    // --force: Commander singleton retains option state from prior parseAsync calls
    await program.parseAsync(["node", "test", "tests", "test-feature", "--force"]);

    expect(mockExecuteWorkflow).toHaveBeenCalled();
    expect(fs.existsSync(path.join(tempDir, "src", "new-feature.test.ts"))).toBe(true);
  });

  it("should refuse to re-run if test files already exist for the feature (US-022)", async () => {
    const srcDir = path.join(tempDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "test-feature.test.ts"), "it('exists', () => {})");
    
    process.exitCode = 0;

    try {
      await program.parseAsync(["node", "test", "tests", "test-feature"]);
    } catch {
      // Expected
    }

    expect(process.exitCode).toBe(1);
    expect(mockExecuteWorkflow).not.toHaveBeenCalled();
  });
});