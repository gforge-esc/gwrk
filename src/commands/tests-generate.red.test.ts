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

describe("testsGenerateCommand Hardening (Phase 12 RED)", () => {
  let tempDir: string;
  let featureDir: string;
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tests-gen-red-"));
    featureDir = path.join(tempDir, "specs", "test-feature");
    fs.mkdirSync(featureDir, { recursive: true });
    
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Spec");
    fs.writeFileSync(path.join(featureDir, "plan.md"), "# Plan");

    program = new Command();
    program.addCommand(testsGenerateCommand);

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("FR-028: SHOULD pass quiet: true to WorkflowRuntime", async () => {
    mockExecuteWorkflow.mockResolvedValue({
      summary: "Success",
      intents: [],
      summaries: [],
    });

    // Mock successful output (gap-matrix.md exists)
    fs.writeFileSync(path.join(featureDir, "gap-matrix.md"), "| AC | Test | ... |");

    await program.parseAsync(["node", "test", "tests", "test-feature", "--force"]);

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ quiet: true })
    );
  });

  it("FR-027: SHOULD fail if agent produces NO test artifacts (gap-matrix or *.test.ts)", async () => {
    mockExecuteWorkflow.mockResolvedValue({
      summary: "I did nothing",
      intents: [],
      summaries: [],
    });

    // Ensure NO artifacts exist
    const gapMatrix = path.join(featureDir, "gap-matrix.md");
    if (fs.existsSync(gapMatrix)) fs.unlinkSync(gapMatrix);

    process.exitCode = 0;
    try {
      await program.parseAsync(["node", "test", "tests", "test-feature", "--force"]);
    } catch {
      // Expected
    }

    expect(process.exitCode).toBe(2);
  });
});
