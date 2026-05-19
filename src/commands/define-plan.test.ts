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

import { planCommand } from "./define-plan.js";

describe("define-plan (Phase 9/12)", () => {
  let tempDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "define-plan-test-"));
    const specsDir = path.join(tempDir, "specs");
    const specDir = path.join(specsDir, "test-feature");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, "spec.md"), "# Spec");

    // Create a mock .gwrkrc.json
    fs.writeFileSync(path.join(tempDir, ".gwrkrc.json"), JSON.stringify({
      project: { name: "test-project" },
      agents: { define: "gemini", implement: "claude" }
    }));

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    program = new Command();
    program.addCommand(planCommand);
    
    mockExecuteWorkflow.mockClear();
    mockWriteManifest.mockClear();
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
    await program.parseAsync(["node", "test", "plan", "test-feature"]);

    const featureDir = path.join(tempDir, "specs", "test-feature");
    expect(mockWriteManifest).toHaveBeenCalledWith(
      featureDir,
      expect.objectContaining({
        command: "define plan",
        feature: "test-feature",
      })
    );
  });

  it("US-026/FR-028: SHOULD pass quiet: true to WorkflowRuntime (Phase 12) (RED)", async () => {
    await program.parseAsync(["node", "test", "plan", "test-feature"]);

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      "gwrk-plan",
      expect.anything(),
      expect.objectContaining({
        quiet: true,
      }),
    );
  });
});
