import { describe, expect, it, vi, beforeEach } from "vitest";
import { testsGenerateCommand } from "./tests-generate.js";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as agentModule from "../utils/agent.js";

vi.mock("../utils/agent.js", () => ({
  dispatchAgent: vi.fn(),
}));

vi.mock("../utils/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    agents: {
      define: "mock-agent",
    },
  }),
}));

vi.mock("../db/runs.js", () => ({
  startRun: vi.fn().mockReturnValue(123),
  finishRun: vi.fn(),
}));

describe("testsGenerateCommand", () => {
  let tempDir: string;
  let featureDir: string;
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tests-gen-test-"));
    featureDir = path.join(tempDir, "specs", "test-feature");
    fs.mkdirSync(path.join(featureDir, ".gwrk"), { recursive: true });
    
    // Create required files
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Spec");
    fs.writeFileSync(path.join(featureDir, "plan.md"), "# Plan");
    fs.writeFileSync(path.join(featureDir, ".gwrk", "tasks.json"), JSON.stringify({ phases: [] }));

    program = new Command();
    program.addCommand(testsGenerateCommand);

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  it("should dispatch the define-tests workflow", async () => {
    vi.mocked(agentModule.dispatchAgent).mockResolvedValue({
      exitCode: 0,
      logPath: "mock.log",
      stdout: "",
      stderr: "",
    });

    await program.parseAsync(["node", "test", "tests", "test-feature"]);

    expect(agentModule.dispatchAgent).toHaveBeenCalledWith(expect.objectContaining({
      workflowPath: ".agents/workflows/define-tests.md",
      featureDir: "specs/test-feature",
    }));
  });

  it("should pass phase context when --phase is provided", async () => {
    vi.mocked(agentModule.dispatchAgent).mockResolvedValue({
      exitCode: 0,
      logPath: "mock.log",
      stdout: "",
      stderr: "",
    });

    await program.parseAsync(["node", "test", "tests", "test-feature", "--phase", "1"]);

    expect(agentModule.dispatchAgent).toHaveBeenCalledWith(expect.objectContaining({
      contextPath: "p01",
    }));
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
    expect(agentModule.dispatchAgent).not.toHaveBeenCalled();
  });
});
