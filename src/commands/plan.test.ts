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

import { planCommand } from "./define-plan.js";

describe("planCommand (Phase 6 E2E)", () => {
  let tempDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-test-"));
    const specsDir = path.join(tempDir, "specs");
    const specDir = path.join(specsDir, "test-feature");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, "spec.md"), "# Spec\n\nFull spec content.");

    // Set up mock workflow in project-local plugins
    const workflowDir = path.join(tempDir, ".gwrk", "plugins", "workflows", "gwrk-plan");
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workflowDir, "manifest.yaml"), `
name: gwrk-plan
type: workflow
outputSchema:
  type: object
  required: [summary, intents]
  properties:
    summary: { type: string }
    intents: { type: array }
`);
    fs.writeFileSync(path.join(workflowDir, "PROMPT.md"), "Plan workflow prompt");

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
    
    mockLoadConfig.mockClear().mockReturnValue({
      agents: {
        define: "gemini",
        implement: "claude",
      },
    });

    vi.mocked(agent.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        summary: "Plan generated successfully",
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

  it("should successfully execute plan workflow E2E", async () => {
    await program.parseAsync(["node", "test", "plan", "test-feature"]);

    // Verify dispatchToAgent was called with correct workflow
    expect(agent.dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({
      workflow: "gwrk-plan"
    }));

    const featureDir = path.join(tempDir, "specs", "test-feature");
    expect(mockWriteManifest).toHaveBeenCalledWith(
      featureDir,
      expect.objectContaining({
        command: "define plan",
        feature: "test-feature",
      })
    );
  });

  it("should pass quiet: true to WorkflowRuntime", async () => {
    await program.parseAsync(["node", "test", "plan", "test-feature"]);

    expect(agent.dispatchToAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        quiet: true,
      }),
    );
  });
});
