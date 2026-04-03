import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { testsGenerateCommand } from "./tests-generate.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DefineOrchestrator } from "../engine/define-orchestrator.js";
import { loadConfig } from "../utils/config.js";

vi.mock("../engine/define-orchestrator.js", () => ({
  DefineOrchestrator: vi.fn(),
}));

vi.mock("../utils/config.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../db/runs.js", () => ({
  startRun: vi.fn().mockReturnValue(123),
  finishRun: vi.fn(),
}));

describe("testsGenerateCommand", () => {
  let tempDir: string;
  let featureDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(loadConfig).mockReturnValue({
      agents: {
        define: "mock-agent",
        implement: "gemini",
      },
    } as any);

    vi.mocked(DefineOrchestrator).mockReturnValue({
      executeDefineTests: vi.fn().mockResolvedValue({
        summary: "Success",
        intents: [],
        summaries: [],
        logPath: "mock.log",
      }),
    } as any);

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tests-gen-test-"));
    featureDir = path.join(tempDir, "specs", "test-feature");
    fs.mkdirSync(featureDir, { recursive: true });
    
    // Create required files (spec + plan only — tasks.json is NOT required)
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Spec");
    fs.writeFileSync(path.join(featureDir, "plan.md"), "# Plan");

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should dispatch the define-tests workflow", async () => {
    await testsGenerateCommand.parseAsync(["test-feature"], { from: "user" });

    const instance = vi.mocked(DefineOrchestrator).mock.results[0].value;
    
    expect(instance.executeDefineTests).toHaveBeenCalledWith(
      "test-feature",
      undefined,
      expect.objectContaining({
        agent: "mock-agent",
      }),
    );
  });

  it("should pass phase context when --phase is provided", async () => {
    await testsGenerateCommand.parseAsync(["test-feature", "--phase", "1"], { from: "user" });

    const instance = vi.mocked(DefineOrchestrator).mock.results[0].value;

    expect(instance.executeDefineTests).toHaveBeenCalledWith(
      "test-feature",
      "p01",
      expect.anything(),
    );
  });

  it("should fail if spec.md is missing", async () => {
    fs.unlinkSync(path.join(featureDir, "spec.md"));
    process.exitCode = 0;

    await testsGenerateCommand.parseAsync(["test-feature"], { from: "user" });

    expect(process.exitCode).toBe(1);
    expect(DefineOrchestrator).not.toHaveBeenCalled();
  });

  it("should refuse to re-run when gap-matrix.md exists without --force", async () => {
    fs.writeFileSync(path.join(featureDir, "gap-matrix.md"), "| AC | Test File |\n");
    process.exitCode = 0;

    await testsGenerateCommand.parseAsync(["test-feature"], { from: "user" });

    expect(process.exitCode).toBe(1);
    expect(DefineOrchestrator).not.toHaveBeenCalled();
  });

  it("should allow re-run with --force when gap-matrix.md exists", async () => {
    fs.writeFileSync(path.join(featureDir, "gap-matrix.md"), "| AC | Test File |\n");
    
    vi.mocked(DefineOrchestrator).mockReturnValueOnce({
      executeDefineTests: vi.fn().mockImplementation(async () => {
        fs.writeFileSync(path.join(featureDir, "gap-matrix.md"), "| AC | Test File | Updated |\n");
        return { summary: "Success", intents: [], summaries: [], logPath: "mock.log" };
      }),
    } as any);

    await testsGenerateCommand.parseAsync(["test-feature", "--force"], { from: "user" });

    expect(DefineOrchestrator).toHaveBeenCalled();
  });
});
