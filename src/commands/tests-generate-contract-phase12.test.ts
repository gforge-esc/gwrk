import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { testsGenerateCommand } from "./tests-generate.js";

const { mockExecuteWorkflow } = vi.hoisted(() => ({
  mockExecuteWorkflow: vi.fn().mockResolvedValue({ summary: "Success", intents: [], summaries: [] }),
}));

vi.mock("../plugins/workflow-runtime.js", () => ({
  WorkflowRuntime: class {
    executeWorkflow = mockExecuteWorkflow;
  },
}));

vi.mock("../utils/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    agents: { define: "mock-agent" },
  }),
}));

vi.mock("../db/runs.js", () => ({
  startRun: vi.fn().mockReturnValue(123),
  finishRun: vi.fn(),
}));

describe('Tests Generate Command (Phase 12)', () => {
  let tempDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tests-gen-p12-"));
    const featureDir = path.join(tempDir, "specs", "test-feature");
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Spec");
    fs.writeFileSync(path.join(featureDir, "plan.md"), "# Plan");

    program = new Command();
    program.addCommand(testsGenerateCommand);

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    
    // Mock git check to avoid "not a git repository"
    vi.mock("../utils/git.js", () => ({
      getCurrentCommit: vi.fn().mockReturnValue("abc123"),
      getCurrentBranch: vi.fn().mockReturnValue("develop"),
      getDiffStats: vi.fn().mockReturnValue({ filesChanged: 0, linesAdded: 0, linesDeleted: 0 }),
    }));

    // Mock execSync to avoid git status failures
    vi.mock("node:child_process", () => ({
      execSync: vi.fn().mockReturnValue(""),
    }));

    mockExecuteWorkflow.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('FR-028: Quiet mode parity', () => {
    it('MUST pass quiet: true to executeWorkflow for define subcommands', async () => {
      // Mock artifact production so it doesn't fail after workflow
      mockExecuteWorkflow.mockImplementationOnce(async () => {
        const srcDir = path.join(tempDir, "src");
        if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir);
        fs.writeFileSync(path.join(srcDir, "test.test.ts"), "it('works')");
        return { summary: "Success", intents: [], summaries: [] };
      });

      await program.parseAsync(["node", "test", "tests", "test-feature", "--force"]);

      expect(mockExecuteWorkflow).toHaveBeenCalledWith(
        "gwrk-define-tests",
        expect.anything(),
        expect.objectContaining({
          quiet: true
        })
      );
    });
  });
});
