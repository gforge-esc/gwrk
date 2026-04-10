import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishRun, recordHistory, startRun } from "../db/runs.js";
import { loadConfig } from "../utils/config.js";
import {
  getCurrentBranch,
  getCurrentCommit,
  getDiffStats,
} from "../utils/git.js";
import { generateRunId, writeManifest } from "../utils/manifest.js";
import { DefineOrchestrator } from "../engine/define-orchestrator.js";
import { defineCommand } from "./define.js";

vi.mock("../db/runs.js", () => ({
  startRun: vi.fn(),
  finishRun: vi.fn(),
  recordHistory: vi.fn(),
}));
vi.mock("../utils/config.js");
vi.mock("../utils/manifest.js", () => ({
  writeManifest: vi.fn(),
  generateRunId: vi.fn().mockReturnValue("mock-run-id"),
}));
vi.mock("../utils/git.js", () => ({
  getCurrentCommit: vi.fn().mockReturnValue("mock-commit"),
  getCurrentBranch: vi.fn().mockReturnValue("mock-branch"),
  getDiffStats: vi
    .fn()
    .mockReturnValue({ filesChanged: 1, linesAdded: 1, linesDeleted: 1 }),
}));
vi.mock("../engine/define-orchestrator.js", () => ({
  DefineOrchestrator: vi.fn(),
}));

describe("defineCommand — Define Until Solid wrapper", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((err) => {
      process.stderr.write(`${err}\n`);
    });
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(process, "cwd").mockReturnValue("/Users/gonzo/Code/gwrk");

    vi.mocked(loadConfig).mockReturnValue({
      project: { name: "gwrk" },
      agents: { define: "gemini", implement: "claude" },
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
    } as import("../utils/config.js").GwrkConfig);

    vi.mocked(startRun).mockReturnValue(42);
    vi.mocked(getDiffStats).mockReturnValue({
      filesChanged: 1,
      linesAdded: 1,
      linesDeleted: 1,
    });
    vi.mocked(getCurrentCommit).mockReturnValue("mock-commit");
    vi.mocked(getCurrentBranch).mockReturnValue("mock-branch");

    // Mock DefineOrchestrator to return exit code 0 by default
    vi.mocked(DefineOrchestrator).mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(0),
      runLoop: vi.fn().mockResolvedValue(0),
    }) as unknown as DefineOrchestrator);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails if feature is not provided", async () => {
    process.exitCode = 0;
    await defineCommand.parseAsync(["node", "cli.js"]);
    expect(process.exitCode).toBe(2);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("handles --dry-run without executing scripts", async () => {
    // DefineOrchestrator now handles dry-run internally
    vi.mocked(DefineOrchestrator).mockImplementation((config) => ({
      run: vi.fn().mockResolvedValue(0),
      runLoop: vi.fn().mockResolvedValue(0),
    }) as unknown as DefineOrchestrator);

    await defineCommand.parseAsync([
      "node",
      "cli.js",
      "004-ship-loop",
      "--dry-run",
    ]);

    // The orchestrator should still be constructed
    expect(DefineOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        featureId: "004-ship-loop",
        backend: "gemini",
        dryRun: true,
      }),
    );
  });

  it("executes define orchestrator and records success", async () => {
    await defineCommand.parseAsync(["node", "cli.js", "004-ship-loop"]);

    expect(loadConfig).toHaveBeenCalled();
    expect(startRun).toHaveBeenCalledWith({
      feature_id: "004-ship-loop",
      command: "define",
      agent_backend: "gemini",
      workflow: "define-orchestrator",
    });

    expect(DefineOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        featureId: "004-ship-loop",
        backend: "gemini",
      }),
    );

    expect(finishRun).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ exit_code: 0 }),
    );
  });

  it("records failure when orchestrator throws", async () => {
    vi.mocked(DefineOrchestrator).mockImplementation(() => ({
      run: vi.fn().mockRejectedValue(new Error("Command failed")),
      runLoop: vi.fn().mockRejectedValue(new Error("Command failed")),
    }) as unknown as DefineOrchestrator);

    process.exitCode = 0;
    await defineCommand.parseAsync(["node", "cli.js", "004-ship-loop"]);

    expect(process.exitCode).toBe(1);

    expect(finishRun).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ exit_code: 1 }),
    );
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
