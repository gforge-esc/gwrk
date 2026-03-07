import { describe, it, expect, vi, beforeEach } from "vitest";
import { implementAction } from "./implement.js";
import { run, runGate } from "../utils/exec.js";
import { loadConfig } from "../utils/config.js";
import { loadTaskState } from "../utils/state.js";

vi.mock("../utils/exec.js", () => ({
  run: vi.fn().mockResolvedValue(undefined),
  runGate: vi.fn().mockReturnValue({ exitCode: 1, stdout: "", stderr: "" }),
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

describe("implementAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock: fail pre-flight (exit 1), pass post-flight (exit 0)
    const gateCalls: Record<string, number> = {};
    vi.mocked(runGate).mockImplementation((p: string) => {
      gateCalls[p] = (gateCalls[p] || 0) + 1;
      return { exitCode: gateCalls[p] === 1 ? 1 : 0, stdout: "", stderr: "" };
    });
  });

  it("iterates through tasks and calls agent-run.sh", async () => {
    await implementAction("004-wud-loop", "1", {});

    expect(loadTaskState).toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(1, expect.stringContaining("agent-run.sh"), ["implement", "004-wud-loop", "1", "T001"], expect.any(Object));
    expect(run).toHaveBeenNthCalledWith(2, expect.stringContaining("agent-run.sh"), ["implement", "004-wud-loop", "1", "T002"], expect.any(Object));
  });

  it("skips tasks that already pass pre-flight gate", async () => {
    // T001 passes pre-flight, T002 fails pre-flight then passes post-flight
    const gateCalls: Record<string, number> = {};
    vi.mocked(runGate).mockImplementation((p: string) => {
      if (p.includes("T001")) return { exitCode: 0, stdout: "", stderr: "" };
      gateCalls[p] = (gateCalls[p] || 0) + 1;
      return { exitCode: gateCalls[p] === 1 ? 1 : 0, stdout: "", stderr: "" };
    });

    await implementAction("004-wud-loop", "1", {});

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(expect.stringContaining("agent-run.sh"), ["implement", "004-wud-loop", "1", "T002"], expect.any(Object));
  });

  it("respects dry-run flag", async () => {
    await implementAction("004-wud-loop", "1", { dryRun: true });

    expect(run).not.toHaveBeenCalled();
  });
});
