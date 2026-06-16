/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { testsGenerateCommand } from "./tests-generate.js";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const { mockExecuteWorkflow, mockLoadConfig, mockWriteManifest, mockGetDiffStats } = vi.hoisted(() => ({
  mockExecuteWorkflow: vi.fn(),
  mockLoadConfig: vi.fn().mockReturnValue({
    agents: {
      define: "mock-agent",
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

vi.mock("../db/runs.js", () => ({
  startRun: vi.fn().mockReturnValue(123),
  finishRun: vi.fn(),
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

vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue(""),
}));

// Mock format.js to avoid messy output
vi.mock("../utils/format.js", () => ({
  banner: vi.fn(),
  blocked: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
}));

describe("testsGenerateCommand", () => {
  let tempDir: string;
  let featureDir: string;
  let program: Command;

  beforeEach(() => {
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
    
    mockLoadConfig.mockClear().mockReturnValue({
      agents: {
        define: "mock-agent",
      },
    });
    
    mockWriteManifest.mockReset();
    mockGetDiffStats.mockReturnValue({ filesChanged: 0, linesAdded: 0, linesDeleted: 0 });
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

  it("US-019/FR-019: SHOULD write execution manifest after success", async () => {
    mockExecuteWorkflow.mockImplementation(async () => {
      fs.writeFileSync(path.join(featureDir, "gap-matrix.md"), "| AC | Test File |\n");
      return { summary: "Success", intents: [], summaries: [] };
    });

    await program.parseAsync(["node", "test", "tests", "test-feature"]);

    expect(mockWriteManifest).toHaveBeenCalledWith(
      featureDir,
      expect.objectContaining({
        command: "define tests",
        feature: "test-feature",
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
});
