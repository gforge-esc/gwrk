import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefineOrchestrator } from "../engine/define-orchestrator.js";
import { specifyCommand } from "./specify.js";

vi.mock("../engine/define-orchestrator.js");

describe("specifyCommand", () => {
  let tempDir: string;
  let executeSpecifySpy: any;

  beforeEach(() => {
    executeSpecifySpy = vi.spyOn(DefineOrchestrator.prototype, "executeSpecify").mockResolvedValue({
      summary: "Success",
      intents: [],
      summaries: [],
      logPath: "/tmp/test.log",
    });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-specify-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
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
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should dispatch agent in rework mode when spec exists", async () => {
    // Create existing spec for rework mode
    const specDir = path.join(tempDir, "specs", "014-plugin-system");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, "spec.md"), "# Existing spec");

    await specifyCommand.parseAsync(
      ["014-plugin-system", "Add WorkflowRuntime rework"],
      { from: "user" },
    );

    expect(executeSpecifySpy).toHaveBeenCalledWith(
      "014-plugin-system",
      "Add WorkflowRuntime rework",
      expect.objectContaining({
        agent: "gemini",
      }),
    );
  });

  it("should dispatch agent in new mode with prompt", async () => {
    await specifyCommand.parseAsync(
      ["018-new-feature", "A brand new feature description"],
      { from: "user" },
    );

    expect(executeSpecifySpy).toHaveBeenCalledWith(
      "018-new-feature",
      "A brand new feature description",
      expect.objectContaining({
        agent: "gemini",
      }),
    );
  });

  it("should fail fast if new spec has no prompt", async () => {
    executeSpecifySpy.mockRejectedValueOnce(new Error("No prompt provided"));
    process.exitCode = 0;
    await specifyCommand.parseAsync(["018-new-feature"], { from: "user" });

    expect(process.exitCode).toBe(1);
  });

  it("should exit with non-zero if agent fails", async () => {
    // Mock failure by having executeSpecify throw
    executeSpecifySpy.mockRejectedValueOnce({
      exitCode: 1,
      logPath: "/tmp/test-fail.log",
    });

    process.exitCode = 0;
    await specifyCommand.parseAsync(["014-plugin-system"], { from: "user" });

    expect(process.exitCode).toBe(1);
  });
});
