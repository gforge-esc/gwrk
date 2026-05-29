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

import { specifyCommand } from "./specify.js";

describe("specifyCommand (Phase 6 E2E)", () => {
  let tempDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "specify-test-"));
    // Create specs directory and the feature directory so resolveFeature succeeds
    const featureDir = path.join(tempDir, "specs", "a-calculator");
    fs.mkdirSync(featureDir, { recursive: true });
    
    // Set up mock workflow in project-local plugins
    const workflowDir = path.join(tempDir, ".gwrk", "plugins", "workflows", "gwrk-specify");
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workflowDir, "manifest.yaml"), `
name: gwrk-specify
type: workflow
outputSchema:
  type: object
  required: [summary, intents]
  properties:
    summary: { type: string }
    intents: { type: array }
`);
    fs.writeFileSync(path.join(workflowDir, "PROMPT.md"), "Specify workflow prompt");

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

    vi.mocked(agent.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        summary: "Spec generated successfully",
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

  it("should successfully execute specify workflow E2E", async () => {
    await program.parseAsync(["node", "test", "spec", "a-calculator", "Create a new feature"]);

    // Verify dispatchToAgent was called with correct workflow
    expect(agent.dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({
      workflow: "gwrk-specify"
    }));

    const featureDir = path.join(tempDir, "specs", "a-calculator");
    expect(mockWriteManifest).toHaveBeenCalledWith(
      featureDir,
      expect.objectContaining({
        command: "define spec",
        feature: "a-calculator",
      })
    );
  });

  it("should pass quiet: true to WorkflowRuntime", async () => {
    await program.parseAsync(["node", "test", "spec", "a-calculator", "Create a new feature"]);

    expect(agent.dispatchToAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        quiet: true,
      }),
    );
  });

  describe("--refs handling", () => {
    it("should prepend refs content in dispatch prompt", async () => {
      const refsFile = path.join(tempDir, "refs.md");
      fs.writeFileSync(refsFile, "Reference content");

      await program.parseAsync([
        "node", "test", "spec", "a-calculator", "Create a new feature",
        "--refs", refsFile,
      ]);

      const dispatchCall = vi.mocked(agent.dispatchToAgent).mock.calls[0][0];
      const prompt = dispatchCall.prompt as string;

      expect(prompt).toContain("<reference_document");
      expect(prompt).toContain("Reference content");
      expect(prompt).toContain("CRITICAL REMINDER:");
    });
  });
});
