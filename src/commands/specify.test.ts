import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { specifyCommand } from "./specify.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import { loadConfig } from "../utils/config.js";
import { writeManifest } from "../utils/manifest.js";

vi.mock("../plugins/workflow-runtime.js", () => ({
  WorkflowRuntime: vi.fn().mockImplementation(() => ({
    executeWorkflow: vi.fn().mockResolvedValue({
      summary: "Success",
      intents: [],
      summaries: [],
    }),
  })),
}));

vi.mock("../utils/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    agents: { define: "gemini", implement: "claude" },
  }),
}));

vi.mock("../utils/manifest.js", () => ({
  writeManifest: vi.fn(),
  generateRunId: vi.fn().mockReturnValue("mock-run-id"),
}));

vi.mock("../utils/git.js", () => ({
  getCurrentCommit: vi.fn().mockReturnValue("mock-commit"),
  getCurrentBranch: vi.fn().mockReturnValue("mock-branch"),
  getDiffStats: vi.fn().mockReturnValue({ filesChanged: 0, linesAdded: 0, linesDeleted: 0 }),
}));

describe("specifyCommand (Phase 9/12)", () => {
  let tempDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "specify-test-"));
    // Create specs directory so resolveFeature/fs.existsSync doesn't fail early
    fs.mkdirSync(path.join(tempDir, "specs"), { recursive: true });
    
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    program = new Command();
    program.addCommand(specifyCommand);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("US-019/FR-019: SHOULD write execution manifest after success (RED)", async () => {
    await program.parseAsync(["node", "test", "spec", "a calculator"]);

    const featureDir = path.join(tempDir, "specs", "a-calculator");
    expect(writeManifest).toHaveBeenCalledWith(
      featureDir,
      expect.objectContaining({
        command: "define spec",
        feature: "a-calculator",
      })
    );
  });

  it("US-026/FR-028: SHOULD pass quiet: true to WorkflowRuntime (Phase 12) (RED)", async () => {
    await program.parseAsync(["node", "test", "spec", "a calculator"]);

    const runtimeInstance = vi.mocked(WorkflowRuntime).mock.results[0].value;
    expect(runtimeInstance.executeWorkflow).toHaveBeenCalledWith(
      "gwrk-specify",
      expect.anything(),
      expect.objectContaining({
        quiet: true,
      }),
    );
  });
});
