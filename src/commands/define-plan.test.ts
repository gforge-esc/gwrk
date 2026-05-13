import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planCommand } from "./define-plan.js";
import { Command } from "commander";

const { mockExecuteWorkflow } = vi.hoisted(() => ({
  mockExecuteWorkflow: vi.fn(),
}));

vi.mock("../plugins/workflow-runtime.js", () => ({
  WorkflowRuntime: class {
    executeWorkflow = mockExecuteWorkflow;
  },
}));

vi.mock("../utils/output.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/output.js")>();
  return {
    ...actual,
    readStdin: vi.fn(() => Promise.resolve("")),
  };
});

describe("planCommand", () => {
  let tempDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-plan-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

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
    program.addCommand(planCommand);

    mockExecuteWorkflow.mockReset();
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

  it("should fail if spec.md does not exist", async () => {
    // Create specs/feature-x/ dir so resolveFeature succeeds, but omit spec.md
    const featureDir = path.join(tempDir, "specs/feature-x");
    fs.mkdirSync(featureDir, { recursive: true });

    process.exitCode = 0;
    try {
      await program.parseAsync(["node", "test", "plan", "feature-x"]);
    } catch {
      // Expected
    }
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("spec.md not found"),
    );
  });

  it("should dispatch workflow if spec.md exists", async () => {
    const featureDir = path.join(tempDir, "specs/feature-x");
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Spec");

    process.exitCode = 0;
    await program.parseAsync(["node", "test", "plan", "feature-x"]);

    expect(process.exitCode).toBe(0);
    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      "gwrk-plan",
      expect.stringContaining("Plan implementation for feature feature-x"),
      expect.objectContaining({
        agent: "gemini",
        projectRoot: tempDir,
      }),
    );
  });

  it("US-026/FR-028: SHOULD pass quiet: true to WorkflowRuntime (Phase 12)", async () => {
    const featureDir = path.join(tempDir, "specs/feature-x");
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Spec");

    await program.parseAsync(["node", "test", "plan", "feature-x"]);

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      "gwrk-plan",
      expect.anything(),
      expect.objectContaining({
        quiet: true,
      }),
    );
  });

  it("should fail if spec.md is marked as a Stub", async () => {
    const featureDir = path.join(tempDir, "specs/feature-x");
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(
      path.join(featureDir, "spec.md"),
      "# Spec\n> **Status:** Stub\n",
    );

    process.exitCode = 0;
    try {
      await program.parseAsync(["node", "test", "plan", "feature-x"]);
    } catch {
      // Expected
    }
    
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("is marked as a Stub"),
    );
  });
});
