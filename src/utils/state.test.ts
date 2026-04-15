import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendHistory } from "./history.js";
import {
  type TaskState,
  loadTaskState,
  markTaskComplete,
  saveTaskState,
} from "./state.js";

describe("Task Engine State", () => {
  const tempDir = path.join(process.cwd(), "temp-test-state");

  beforeEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const mockState: TaskState = {
    featureId: "test-feature",
    createdAt: new Date().toISOString(),
    phases: [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: "Task 1",
            description: "Desc 1",
            status: "open",
            gateScript: "gates/T001-gate.sh",
          },
        ],
      },
    ],
  };

  it("should save and load task state", () => {
    saveTaskState(tempDir, mockState);
    const loaded = loadTaskState(tempDir);
    expect(loaded.featureId).toBe("test-feature");
    expect(loaded.phases[0].tasks[0].id).toBe("T001");
  });

  it("should enforce SP additivity invariant", () => {
    const invalidState: TaskState = {
      ...mockState,
      phases: [
        {
          ...mockState.phases[0],
          sp_estimate: 5,
          tasks: [
            {
              ...mockState.phases[0].tasks[0],
              sp: 2,
            },
          ],
        },
      ],
    };

    expect(() => saveTaskState(tempDir, invalidState)).toThrow(
      /SP Invariant Violation/,
    );

    const validState: TaskState = {
      ...mockState,
      phases: [
        {
          ...mockState.phases[0],
          sp_estimate: 5,
          tasks: [
            {
              ...mockState.phases[0].tasks[0],
              sp: 5,
            },
          ],
        },
      ],
    };

    expect(() => saveTaskState(tempDir, validState)).not.toThrow();
  });

  it("should mark a task as complete", () => {
    const newState = markTaskComplete(mockState, "T001");
    expect(newState.phases[0].tasks[0].status).toBe("completed");
    expect(newState.phases[0].tasks[0].completedAt).toBeDefined();
    // Original should be unchanged (pure function)
    expect(mockState.phases[0].tasks[0].status).toBe("open");
  });

  it("should throw when marking non-existent task", () => {
    expect(() => markTaskComplete(mockState, "T999")).toThrow(/not found/);
  });

  it("should throw when marking already completed task", () => {
    const completedState = markTaskComplete(mockState, "T001");
    expect(() => markTaskComplete(completedState, "T001")).toThrow(
      /already completed/,
    );
  });

  it("should fail-fast on invalid state file", () => {
    const gwrkDir = path.join(tempDir, ".gwrk");
    fs.mkdirSync(gwrkDir, { recursive: true });
    fs.writeFileSync(path.join(gwrkDir, "tasks.json"), '{"invalid": "json"}');

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit(1)");
    });

    expect(() => loadTaskState(tempDir)).toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should append history correctly", () => {
    // Change directory to tempDir for history test
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      appendHistory({
        timestamp: new Date().toISOString(),
        featureId: "test-feature",
        taskId: "T001",
        fromStatus: "open",
        toStatus: "completed",
      });

      const historyPath = path.join(".gwrk", "history.jsonl");
      expect(fs.existsSync(historyPath)).toBe(true);
      const content = fs.readFileSync(historyPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.taskId).toBe("T001");
      expect(entry.toStatus).toBe("completed");
    } finally {
      process.chdir(originalCwd);
    }
  });
});
