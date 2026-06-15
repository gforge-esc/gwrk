import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../utils/config.js";
import { run } from "../utils/exec.js";
import { runGate } from "../utils/gate-runner.js";
import { loadTaskState } from "../utils/state.js";
import { implementAction } from "./implement.js";

vi.mock("../utils/exec.js", () => ({
  run: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../utils/gate-runner.js", () => ({
  runGate: vi.fn().mockResolvedValue({ passed: false, exitCode: 1, output: "" }),
}));

vi.mock("../utils/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    agents: { implement: "mock-backend" },
  }),
}));

vi.mock("../utils/state.js", () => ({
  loadTaskState: vi.fn().mockReturnValue({
    phases: [
      {
        id: "phase-01",
        tasks: [
          { id: "T001", title: "Task 1", status: "open" },
          { id: "T002", title: "Task 2", status: "open" },
        ],
      },
    ],
  }),
  markTaskComplete: vi.fn(),
  saveTaskState: vi.fn(),
}));

vi.mock("../utils/history.js", () => ({
  appendHistory: vi.fn(),
}));

vi.mock("../db/runs.js", () => ({
  startRun: vi.fn().mockReturnValue(123),
  finishRun: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
  },
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock("../utils/resolve-feature.js", () => ({
  resolveFeature: vi.fn().mockImplementation((input: string) => input),
}));

describe("implementAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock: fail pre-flight (not passed), pass post-flight (passed)
    const gateCalls: Record<string, number> = {};
    vi.mocked(runGate).mockImplementation(async (p: string) => {
      gateCalls[p] = (gateCalls[p] || 0) + 1;
      const passed = gateCalls[p] !== 1;
      return { passed, exitCode: passed ? 0 : 1, output: "" };
    });
  });

  it("iterates through tasks and calls agent-run.sh", async () => {
    await implementAction("004-ship-loop", "1", {});

    expect(loadTaskState).toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("agent-run.sh"),
      ["implement", "004-ship-loop", "1", "T001"],
      expect.any(Object),
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("agent-run.sh"),
      ["implement", "004-ship-loop", "1", "T002"],
      expect.any(Object),
    );
  });

  it("skips tasks that already pass pre-flight gate", async () => {
    // T001 passes pre-flight, T002 fails pre-flight then passes post-flight
    const gateCalls: Record<string, number> = {};
    vi.mocked(runGate).mockImplementation(async (p: string) => {
      if (p.includes("T001")) return { passed: true, exitCode: 0, output: "" };
      gateCalls[p] = (gateCalls[p] || 0) + 1;
      const passed = gateCalls[p] !== 1;
      return { passed, exitCode: passed ? 0 : 1, output: "" };
    });

    await implementAction("004-ship-loop", "1", {});

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining("agent-run.sh"),
      ["implement", "004-ship-loop", "1", "T002"],
      expect.any(Object),
    );
  });

  it("respects dry-run flag", async () => {
    await implementAction("004-ship-loop", "1", { dryRun: true });

    expect(run).not.toHaveBeenCalled();
  });
});
