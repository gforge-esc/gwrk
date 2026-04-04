import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { specifyCommand } from "./specify.js";
import { Command } from "commander";

const { mockExecuteWorkflow } = vi.hoisted(() => ({
  mockExecuteWorkflow: vi.fn().mockResolvedValue({
    summary: "Success",
    intents: [],
    summaries: [],
  }),
}));

vi.mock("../plugins/workflow-runtime.js", () => {
  return {
    WorkflowRuntime: class {
      executeWorkflow = mockExecuteWorkflow;
    }
  };
});

describe("specifyCommand", () => {
  let tempDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-specify-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    // Prevent readStdin() from blocking in test environment
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    // Create .gwrkrc.json
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: "test-project" },
        agents: { define: "gemini", implement: "codex-cloud" },
        server: {
          port: 18790,
          host: "localhost",
        },
        parallelism: {
          local: {
            maxCpu: 80,
            maxMem: 80,
            minDiskGb: 10,
            maxClones: 2,
          },
          cloud: {
            maxConcurrent: 10,
          },
        },
      }),
    );

    program = new Command();
    program.addCommand(specifyCommand);

    mockExecuteWorkflow.mockClear();
    mockExecuteWorkflow.mockResolvedValue({
      summary: "Success",
      intents: [],
      summaries: [],
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should dispatch workflow in rework mode when spec exists", async () => {
    // Create existing spec for rework mode
    const specDir = path.join(tempDir, "specs", "014-plugin-system");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, "spec.md"), "# Existing spec");

    await program.parseAsync(
      ["node", "test", "spec", "014-plugin-system", "Add WorkflowRuntime rework"],
    );

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      "gwrk-specify",
      expect.stringContaining("REWORK"),
      expect.objectContaining({
        agent: "gemini",
        projectRoot: tempDir,
      }),
    );
  });

  it("should dispatch workflow in new mode with prompt", async () => {
    await program.parseAsync(
      ["node", "test", "spec", "018-new-feature", "A brand new feature description"],
    );

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      "gwrk-specify",
      expect.stringContaining("Create a NEW spec"),
      expect.objectContaining({
        agent: "gemini",
        projectRoot: tempDir,
      }),
    );
  });

  it("should fail fast if new spec has no prompt", async () => {
    process.exitCode = 0;
    try {
      await program.parseAsync(["node", "test", "spec", "018-new-feature"]);
    } catch {
      // Expected
    }

    expect(process.exitCode).toBe(1);
  });

  it("should exit with non-zero if workflow fails", async () => {
    // Create existing spec for rework mode
    const specDir = path.join(tempDir, "specs", "014-plugin-system");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, "spec.md"), "# Existing spec");

    mockExecuteWorkflow.mockRejectedValueOnce(new Error("Workflow failed"));

    process.exitCode = 0;
    await program.parseAsync(["node", "test", "spec", "014-plugin-system"]);

    expect(process.exitCode).toBe(1);
  });
});
