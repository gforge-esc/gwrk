import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const { mockExecuteWorkflow, mockLoadConfig, mockWriteManifest, mockGetDiffStats } = vi.hoisted(() => ({
  mockExecuteWorkflow: vi.fn().mockResolvedValue({
    summary: "Success",
    intents: [],
    summaries: [],
  }),
  mockLoadConfig: vi.fn().mockReturnValue({
    agents: {
      define: "gemini",
      implement: "claude",
    },
  }),
  mockWriteManifest: vi.fn(),
  mockGetDiffStats: vi.fn().mockReturnValue({ filesChanged: 0, linesAdded: 0, linesDeleted: 0 }),
}));

vi.mock("../plugins/workflow-runtime.js", () => ({
  WorkflowRuntime: class {
    executeWorkflow = mockExecuteWorkflow;
  },
}));

vi.mock("../utils/config.js", () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock("../utils/manifest.js", () => ({
  writeManifest: mockWriteManifest,
  generateRunId: vi.fn().mockReturnValue("mock-run-id"),
}));

vi.mock("../utils/git.js", () => ({
  getCurrentCommit: vi.fn().mockReturnValue("mock-commit"),
  getCurrentBranch: vi.fn().mockReturnValue("mock-branch"),
  getDiffStats: mockGetDiffStats,
}));

vi.mock("../utils/output.js", () => ({
  readStdin: vi.fn(async () => ""),
  resolveFormat: vi.fn(),
  createOutput: vi.fn(),
}));

import { specifyCommand } from "./specify.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import { writeManifest } from "../utils/manifest.js";

describe("specifyCommand (Phase 9/12)", () => {
  let tempDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "specify-test-"));
    // Create specs directory and the feature directory so resolveFeature succeeds
    const featureDir = path.join(tempDir, "specs", "a-calculator");
    fs.mkdirSync(featureDir, { recursive: true });
    
    // Create a mock .gwrkrc.json
    fs.writeFileSync(path.join(tempDir, ".gwrkrc.json"), JSON.stringify({
      project: { name: "test-project" },
      agents: { define: "gemini", implement: "claude" }
    }));

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    program = new Command();
    program.addCommand(specifyCommand);

    mockLoadConfig.mockClear().mockReturnValue({
      agents: {
        define: "gemini",
        implement: "claude",
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("US-019/FR-019: SHOULD write execution manifest after success (RED)", async () => {
    await program.parseAsync(["node", "test", "spec", "a-calculator", "Create a new feature"]);

    const featureDir = path.join(tempDir, "specs", "a-calculator");
    expect(mockWriteManifest).toHaveBeenCalledWith(
      featureDir,
      expect.objectContaining({
        command: "define spec",
        feature: "a-calculator",
      })
    );
  });

  it("US-026/FR-028: SHOULD pass quiet: true to WorkflowRuntime (Phase 12) (RED)", async () => {
    await program.parseAsync(["node", "test", "spec", "a-calculator", "Create a new feature"]);

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      "gwrk-specify",
      expect.anything(),
      expect.objectContaining({
        quiet: true,
      }),
    );
  });

  describe("--refs handling", () => {
    it("SHOULD prepend refs content with XML tags before the prompt", async () => {
      const refsDir = path.join(tempDir, "specs", "a-calculator", "refs");
      fs.mkdirSync(refsDir, { recursive: true });
      const refsFile = path.join(refsDir, "requirements.md");
      fs.writeFileSync(refsFile, "# Requirements\n\nScreen: Survey Home\nRole: Domain Architect");

      await program.parseAsync([
        "node", "test", "spec", "a-calculator", "Create a new feature",
        "--refs", refsFile,
      ]);

      const prompt = mockExecuteWorkflow.mock.calls[0][1] as string;

      // Refs should appear BEFORE the task description (Anthropic position 3)
      expect(prompt).toMatch(/^<reference_document/);
      expect(prompt).toContain("Screen: Survey Home");
      expect(prompt).toContain("Role: Domain Architect");
      expect(prompt).toContain("</reference_document>");

      // Task description should come AFTER refs
      const refsEnd = prompt.indexOf("</reference_document>");
      const taskStart = prompt.indexOf("Create a NEW spec");
      expect(taskStart).toBeGreaterThan(refsEnd);

      // Critical reminder should appear at the END (Anthropic position 11)
      expect(prompt).toContain("CRITICAL REMINDER:");
      const reminderPos = prompt.indexOf("CRITICAL REMINDER:");
      expect(reminderPos).toBeGreaterThan(taskStart);
    });

    it("SHOULD include authority attribute and source path in XML tag", async () => {
      const refsFile = path.join(tempDir, "refs.md");
      fs.writeFileSync(refsFile, "ref content");

      await program.parseAsync([
        "node", "test", "spec", "a-calculator", "Create a new feature",
        "--refs", refsFile,
      ]);

      const prompt = mockExecuteWorkflow.mock.calls[0][1] as string;
      expect(prompt).toContain(`source="${refsFile}"`);
      expect(prompt).toContain('authority="primary"');
    });

    it("SHOULD fail with corrective message when refs file does not exist", async () => {
      mockExecuteWorkflow.mockClear();
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await program.parseAsync([
        "node", "test", "spec", "a-calculator", "Create a new feature",
        "--refs", "/nonexistent/path/refs.md",
      ]);

      // The CommandError should short-circuit before dispatching to agent
      expect(mockExecuteWorkflow).not.toHaveBeenCalled();

      // withSignal writes error to stderr
      const stderrOutput = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
      expect(stderrOutput).toContain("Reference file not found");

      stderrSpy.mockRestore();
    });

    it("SHOULD NOT include reference_document tags when no --refs provided", async () => {
      await program.parseAsync(["node", "test", "spec", "a-calculator", "Create a new feature"]);

      const prompt = mockExecuteWorkflow.mock.calls[0][1] as string;
      expect(prompt).not.toContain("<reference_document");
      expect(prompt).not.toContain("CRITICAL REMINDER:");
    });
  });
});
