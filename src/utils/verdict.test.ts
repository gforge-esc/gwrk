// src/utils/verdict.test.ts
// RED tests — Phase 2: Verdict checker utility
import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkPhaseVerdict } from "./verdict.js"; // RED — module does not exist yet

vi.mock("./state.js", () => ({
  loadTaskState: vi.fn(),
}));

import { loadTaskState } from "./state.js";

const mockLoadTaskState = vi.mocked(loadTaskState);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FR-005: Phase verdict — checkPhaseVerdict()", () => {
  it("US-003 #1: returns GO when all tasks in phase are completed", () => {
    mockLoadTaskState.mockReturnValue({
      feature: "004-wud-loop",
      phases: [{
        id: "phase-01",
        name: "Phase 1",
        tasks: [
          { id: "T001", title: "Task 1", description: "Desc", status: "completed" },
          { id: "T002", title: "Task 2", description: "Desc", status: "completed" },
        ],
      }],
    });

    const result = checkPhaseVerdict("specs/004-wud-loop", 1);
    expect(result.verdict).toBe("GO");
    expect(result.totalTasks).toBe(2);
    expect(result.completedTasks).toBe(2);
    expect(result.openTasks).toHaveLength(0);
  });

  it("US-003 #2: returns NO-GO when open tasks remain", () => {
    mockLoadTaskState.mockReturnValue({
      feature: "004-wud-loop",
      phases: [{
        id: "phase-01",
        name: "Phase 1",
        tasks: [
          { id: "T001", title: "Done", description: "Desc", status: "completed" },
          { id: "T002", title: "Still open", description: "Desc", status: "open" },
        ],
      }],
    });

    const result = checkPhaseVerdict("specs/004-wud-loop", 1);
    expect(result.verdict).toBe("NO-GO");
    expect(result.completedTasks).toBe(1);
    expect(result.openTasks).toHaveLength(1);
    expect(result.openTasks[0].id).toBe("T002");
  });

  it("US-003 #3: returns NO-GO when in_progress tasks exist", () => {
    mockLoadTaskState.mockReturnValue({
      feature: "004-wud-loop",
      phases: [{
        id: "phase-01",
        name: "Phase 1",
        tasks: [
          { id: "T001", title: "In progress", description: "Desc", status: "in_progress" },
        ],
      }],
    });

    const result = checkPhaseVerdict("specs/004-wud-loop", 1);
    expect(result.verdict).toBe("NO-GO");
    expect(result.openTasks).toHaveLength(1);
  });

  it("rejects: phase not found in tasks.json", () => {
    // Negative path — nonexistent phase
    mockLoadTaskState.mockReturnValue({
      feature: "004-wud-loop",
      phases: [{ id: "phase-01", name: "Phase 1", tasks: [] }],
    });

    expect(() => checkPhaseVerdict("specs/004-wud-loop", 99)).toThrow(/[Pp]hase.*not found/);
  });
});
