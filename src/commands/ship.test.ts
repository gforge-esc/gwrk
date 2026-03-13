import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as runsModule from "../db/runs.js";
import * as execModule from "../utils/exec.js";
import * as uiModule from "../utils/format.js";
import * as stateModule from "../utils/state.js";
import { shipCommand } from "./ship.js";

// Mock dependencies
vi.mock("../utils/exec.js", () => ({
  run: vi.fn(),
  runGate: vi.fn(),
}));

vi.mock("../server/slack-notify.js", () => ({
  notifySlack: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../utils/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/config.js")>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      project: {
        name: "test",
        slack: { channelId: "C123", channelName: "test" },
      },
      agents: {
        implement: "mock-agent",
        define: "mock-agent",
      },
      server: { port: 18790, host: "localhost" },
    }),
  };
});

vi.mock("../db/runs.js", () => ({
  startRun: vi.fn().mockReturnValue(999),
  finishRun: vi.fn(),
  recordHistory: vi.fn(),
}));

vi.mock("../utils/format.js", () => ({
  fail: vi.fn(),
  success: vi.fn(),
  banner: vi.fn(),
  dryRun: vi.fn(),
  blocked: vi.fn(),
  color: {
    BOLD: "",
    DIM: "",
    CYAN: "",
    GREEN: "",
    YELLOW: "",
    RED: "",
    MAGENTA: "",
    RESET: "",
  },
}));

vi.mock("../utils/state.js", () => ({
  loadTaskState: vi.fn().mockReturnValue({
    phases: [
      {
        id: "phase-01",
        tasks: [{ id: "T001", title: "Task 1", status: "open" }],
      },
      {
        id: "phase-02",
        tasks: [{ id: "T002", title: "Task 2", status: "open" }],
      },
    ],
  }),
  markTaskComplete: vi.fn(),
  saveTaskState: vi.fn(),
}));

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

// Default fs.existsSync to true so ship's pre-flight checks pass.
// Tests that need specific existsSync behavior override with their own spy.
vi.spyOn(fs, "existsSync").mockReturnValue(true);

describe("shipCommand", () => {
  let mockRun: ReturnType<typeof vi.fn>;
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRun = vi.mocked(execModule.run);

    program = new Command();
    program.addCommand(shipCommand);

    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit unexpectedly called with "${code}"`);
    });
  });

  it("ship with phase should execute work-until-done.sh for that phase", async () => {
    mockRun.mockResolvedValueOnce(undefined);

    await program.parseAsync(["node", "test", "ship", "001-cli-core", "7"]);

    expect(execModule.run).toHaveBeenCalledTimes(1);
    const [scriptPath, args] = mockRun.mock.calls[0];

    expect(scriptPath).toContain("work-until-done.sh");
    expect(args).toEqual(["001-cli-core", "7"]);

    expect(runsModule.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "ship",
        workflow: "work-until-done",
      }),
    );
  });

  it("ship without phase should ship all phases from tasks.json", async () => {
    mockRun.mockResolvedValue(undefined);

    await program.parseAsync(["node", "test", "ship", "001-cli-core"]);

    // Should call work-until-done.sh twice (phase-01, phase-02 from mock)
    expect(execModule.run).toHaveBeenCalledTimes(2);
    expect(mockRun.mock.calls[0][1]).toEqual(["001-cli-core", "01"]);
    expect(mockRun.mock.calls[1][1]).toEqual(["001-cli-core", "02"]);
  });

  it("ship should pass custom max-iterations", async () => {
    mockRun.mockResolvedValueOnce(undefined);

    await program.parseAsync([
      "node",
      "test",
      "ship",
      "004-ship-loop",
      "1",
      "--max-iterations",
      "5",
    ]);

    expect(execModule.run).toHaveBeenCalledTimes(1);
    const [, , options] = mockRun.mock.calls[0];
    expect(options.env.MAX_ITERATIONS).toBe("5");
  });

  it("ship should pass custom ci-timeout", async () => {
    mockRun.mockResolvedValueOnce(undefined);

    await program.parseAsync([
      "node",
      "test",
      "ship",
      "004-ship-loop",
      "1",
      "--ci-timeout",
      "60",
    ]);

    expect(execModule.run).toHaveBeenCalledTimes(1);
    const [, , options] = mockRun.mock.calls[0];
    expect(options.env.CI_TIMEOUT).toBe("60");
  });

  it("should stop on first phase failure", async () => {
    const errorWithCode = new Error("shell error");
    (errorWithCode as unknown as { code: number }).code = 127;
    mockRun.mockRejectedValueOnce(errorWithCode);

    // Ship without phase — should fail on phase-01 and not attempt phase-02
    await expect(
      program.parseAsync(["node", "test", "ship", "001-cli-core"]),
    ).rejects.toThrow('process.exit unexpectedly called with "127"');

    expect(execModule.run).toHaveBeenCalledTimes(1);
    expect(runsModule.finishRun).toHaveBeenCalledWith(
      999,
      expect.objectContaining({ exit_code: 127 }),
    );
    expect(uiModule.fail).toHaveBeenCalled();
  });

  it("should support dry-run mode", async () => {
    await program.parseAsync([
      "node",
      "test",
      "ship",
      "--dry-run",
      "001-cli-core",
      "1",
    ]);

    expect(execModule.run).not.toHaveBeenCalled();
    expect(uiModule.dryRun).toHaveBeenCalled();
  });

  it("should support dry-run mode for all phases", async () => {
    await program.parseAsync([
      "node",
      "test",
      "ship",
      "--dry-run",
      "001-cli-core",
    ]);

    expect(execModule.run).not.toHaveBeenCalled();
    // Should print dry-run for each phase
    expect(uiModule.dryRun).toHaveBeenCalledTimes(2);
  });

  it("should exit 1 with BLOCKED message if no test files found for phase", async () => {
    // Modify loadTaskState mock to return a task with a source file but no tests
    vi.mocked(stateModule.loadTaskState).mockReturnValueOnce({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      generatedFrom: { plan: { hash: "abc", modifiedAt: "now" } },
      phases: [
        {
          id: "phase-01",
          tasks: [
            {
              id: "T001",
              title: "Implement src/commands/ship.ts",
              status: "open",
              gateScript: "gates/T001-gate.sh",
            },
          ],
          doneWhen: [],
        },
      ],
    });

    // Ensure fs.existsSync returns false for the corresponding test file but true for others
    const existsSpy = vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (typeof p === "string" && p.endsWith(".test.ts")) return false;
      return true;
    });

    // Mock blocked() from uiModule
    const blockedSpy = vi.mocked(uiModule.blocked);

    // We expect process.exit(1)
    await expect(
      program.parseAsync(["node", "test", "ship", "004-ship-loop", "1"]),
    ).rejects.toThrow('process.exit unexpectedly called with "1"');

    expect(blockedSpy).toHaveBeenCalledWith(
      expect.stringContaining("[BLOCKED] No test files found for phase-01"),
    );

    existsSpy.mockRestore();
  });

  it("should exit 1 without side effects when feature spec.md does not exist", async () => {
    // Mock fs.existsSync: spec.md returns false, everything else returns true
    const existsSpy = vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (typeof p === "string" && p.endsWith("spec.md")) return false;
      return true;
    });

    // Mock readdirSync and statSync for the available-features listing
    const readdirSpy = vi
      .spyOn(fs, "readdirSync")
      .mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);

    await expect(
      program.parseAsync([
        "node",
        "test",
        "ship",
        "nonexistent-feature",
        "1",
      ]),
    ).rejects.toThrow('process.exit unexpectedly called with "1"');

    // No shell script should have been invoked
    expect(execModule.run).not.toHaveBeenCalled();
    // No DB recording either
    expect(runsModule.startRun).not.toHaveBeenCalled();

    existsSpy.mockRestore();
    readdirSpy.mockRestore();
  });
});
