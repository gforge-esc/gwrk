/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as agent from "../utils/agent.js";

const { mockLoadConfig, mockWriteManifest } = vi.hoisted(() => ({
  mockLoadConfig: vi.fn().mockReturnValue({
    agents: {
      define: "gemini",
      implement: "claude",
    },
  }),
  mockWriteManifest: vi.fn(),
}));

vi.mock("../utils/agent.js", async () => {
  const actual = await vi.importActual<any>("../utils/agent.js");
  return {
    ...actual,
    dispatchToAgent: vi.fn(),
  };
});

vi.mock("../utils/config.js", () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock("../utils/manifest.js", () => ({
  writeManifest: mockWriteManifest,
  generateRunId: vi.fn().mockReturnValue("mock-run-id"),
}));

vi.mock("../utils/git.js", () => ({
  getCurrentCommit: vi.fn(() => "mock-commit"),
  getCurrentBranch: vi.fn(() => "mock-branch"),
  getDiffStats: vi.fn(() => ({ filesChanged: 0, linesAdded: 0, linesDeleted: 0 })),
}));

vi.mock("../utils/output.js", () => ({
  readStdin: vi.fn(async () => ""),
  resolveFormat: vi.fn(),
  createOutput: vi.fn(),
}));

import { analyzeCommand } from "./analyze.js";

describe("analyzeCommand", () => {
  let tempDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "analyze-cmd-test-"));
    const specsDir = path.join(tempDir, "specs");
    const specDir = path.join(specsDir, "test-feature");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, "spec.md"), "# Spec\n\nFull spec content.");

    // Set up mock workflow in project-local plugins
    const workflowDir = path.join(tempDir, ".gwrk", "plugins", "workflows", "gwrk-analyze");
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workflowDir, "manifest.yaml"), `
name: gwrk-analyze
type: workflow
outputSchema:
  type: object
  required: [summary, intents]
  properties:
    summary: { type: string }
    intents: { type: array }
`);
    fs.writeFileSync(path.join(workflowDir, "PROMPT.md"), "Analyze workflow prompt");

    // Create a mock .gwrkrc.json
    fs.writeFileSync(path.join(tempDir, ".gwrkrc.json"), JSON.stringify({
      project: { name: "test-project" },
      agents: { define: "gemini", implement: "claude" }
    }));

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    program = new Command();
    program.addCommand(analyzeCommand);
    
    mockLoadConfig.mockClear().mockReturnValue({
      agents: {
        define: "gemini",
        implement: "claude",
      },
    });

    vi.mocked(agent.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        summary: "Analyze completed successfully",
        intents: []
      }),
      stderr: "",
      durationS: 1,
      logPath: "mock.log"
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should successfully execute analyze workflow", async () => {
    await program.parseAsync(["node", "test", "analyze", "test-feature"]);

    // Verify dispatchToAgent was called with correct workflow
    expect(agent.dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({
      workflow: "gwrk-analyze"
    }));
  });
});
