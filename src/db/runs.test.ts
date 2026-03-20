import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "./index.js";
import {
  type ProjectRecord,
  finishRun,
  getStats,
  listProjects,
  listRuns,
  recordHistory,
  recordRun,
  registerProject,
  startRun,
} from "./runs.js";

describe("runs db", () => {
  beforeEach(() => {
    // Each test gets a fresh in-memory DB if getDb() supports it,
    // but the current implementation might be sharing a file.
    // Let's assume for now we want to test the logic.
  });

  it("should start and finish a run", () => {
    const db = getDb();
    const runId = startRun(
      {
        feature_id: "test-feat",
        phase_id: "phase-1",
        command: "test",
        agent_backend: "gemini",
      },
      db,
    );

    expect(runId).toBeGreaterThan(0);

    finishRun(
      runId,
      {
        exit_code: 0,
        duration_s: 10,
      },
      db,
    );

    const runs = listRuns("test-feat", db);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].exit_code).toBe(0);
    expect(runs[0].feature_id).toBe("test-feat");
  });

  it("should record a complete run in one call", () => {
    const db = getDb();
    const runId = recordRun(
      {
        feature_id: "record-feat",
        command: "ship",
        exit_code: 0,
        duration_s: 45,
      },
      db,
    );

    expect(runId).toBeGreaterThan(0);
    const runs = listRuns("record-feat", db);
    expect(runs[0].duration_s).toBe(45);
  });

  it("should register and list projects", () => {
    const db = getDb();
    const project: ProjectRecord = {
      id: "proj-1",
      name: "Test Project",
      path: "/tmp/test-project",
    };

    registerProject(project, db);
    const projects = listProjects(db);
    const found = projects.find((p) => p.id === "proj-1");
    expect(found).toBeDefined();
    expect(found?.name).toBe("Test Project");
  });

  it("should calculate stats", () => {
    const db = getDb();
    recordRun(
      {
        feature_id: "stats-feat",
        command: "stats-cmd",
        agent_backend: "gemini",
        exit_code: 0,
        duration_s: 10,
      },
      db,
    );

    const stats = getStats(db);
    const stat = stats.find((s) => s.command === "stats-cmd");
    expect(stat).toBeDefined();
    expect(stat?.total_runs).toBeGreaterThan(0);
  });

  it("should record history", () => {
    const db = getDb();
    const historyId = recordHistory(
      {
        feature_id: "hist-feat",
        from_status: "open",
        to_status: "completed",
      },
      db,
    );

    expect(historyId).toBeGreaterThan(0);
  });

  describe("FR-H03: DB Record Finalization", () => {
    it("US-H03: finishRun updates status, PR, and merge commit", () => {
      const db = getDb();
      const runId = startRun(
        {
          feature_id: "harvest-feat",
          phase_id: "p1",
          command: "ship",
          agent_backend: "gemini",
        },
        db,
      );

      finishRun(
        runId,
        {
          exit_code: 0,
          duration_s: 120,
          // @ts-ignore - status doesn't exist yet on type
          status: "merged",
          pr_number: 42,
          merge_commit_sha: "abc1234567890",
        },
        db,
      );

      const runs = listRuns("harvest-feat", db);
      const run = runs.find((r) => r.id === runId);
      expect(run).toBeDefined();
      // @ts-ignore - status doesn't exist yet on type
      expect(run?.status).toBe("merged");
      // @ts-ignore - pr_number doesn't exist yet on type
      expect(run?.pr_number).toBe(42);
      // @ts-ignore - merge_commit_sha doesn't exist yet on type
      expect(run?.merge_commit_sha).toBe("abc1234567890");
    });

    it("should fail gracefully if runId does not exist", () => {
      const db = getDb();
      expect(() => {
        finishRun(
          999999, // Non-existent ID
          {
            exit_code: 0,
            duration_s: 10,
          },
          db,
        );
      }).not.toThrow(); // SQLite UPDATE on non-existent ID is usually a no-op, not an error.
    });

    it("should handle missing optional merge metadata", () => {
      const db = getDb();
      const runId = startRun(
        {
          feature_id: "harvest-partial-feat",
          command: "ship",
        },
        db,
      );

      finishRun(
        runId,
        {
          exit_code: 0,
          duration_s: 60,
          // Missing status, pr_number, etc.
        },
        db,
      );

      const runs = listRuns("harvest-partial-feat", db);
      const run = runs.find((r) => r.id === runId);
      expect(run).toBeDefined();
      // @ts-ignore
      expect(run?.status).toBeNull();
    });
  });
});
