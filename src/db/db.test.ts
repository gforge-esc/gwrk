import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { getTestDb } from "./index.js";
import { startRun, finishRun, listRuns, registerProject, listProjects } from "./runs.js";

describe("SQLite execution ledger", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should create tables on init", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);

    expect(tables).toContain("projects");
    expect(tables).toContain("runs");
    expect(tables).toContain("history");
    expect(tables).toContain("_migrations");
  });

  it("should record and finish a run", () => {
    const runId = startRun(
      {
        feature_id: "001-cli-core",
        phase_id: "phase-01",
        command: "wud",
        agent_backend: "gemini",
        workflow: "work-until-done",
      },
      db,
    );

    expect(runId).toBeGreaterThan(0);

    finishRun(
      runId,
      {
        exit_code: 0,
        duration_s: 42,
        gate_result: "PASS",
        review_verdict: "GO",
      },
      db,
    );

    const runs = listRuns("001-cli-core", db);
    expect(runs).toHaveLength(1);
    expect(runs[0].exit_code).toBe(0);
    expect(runs[0].duration_s).toBe(42);
    expect(runs[0].gate_result).toBe("PASS");
    expect(runs[0].review_verdict).toBe("GO");
  });

  it("should list runs most recent first", () => {
    const id1 = startRun({ feature_id: "test-feature", command: "define", workflow: "define-until-solid" }, db);
    const id2 = startRun({ feature_id: "test-feature", command: "wud", workflow: "work-until-done" }, db);
    startRun({ feature_id: "other-feature", command: "wud", workflow: "work-until-done" }, db);

    const runs = listRuns("test-feature", db);
    expect(runs).toHaveLength(2);
    // Most recent (higher ID) first
    expect(runs[0].id).toBe(id2);
    expect(runs[1].id).toBe(id1);
  });

  it("should return empty array for unknown feature", () => {
    const runs = listRuns("nonexistent", db);
    expect(runs).toHaveLength(0);
  });

  it("should register and list projects", () => {
    registerProject(
      { id: "gwrk", name: "gwrk", path: "/Users/gonzo/Code/gwrk" },
      db,
    );

    const projects = listProjects(db);
    expect(projects).toHaveLength(1);
    expect((projects[0] as { name: string }).name).toBe("gwrk");
  });

  it("should upsert projects by path", () => {
    registerProject(
      { id: "gwrk", name: "gwrk", path: "/Users/gonzo/Code/gwrk" },
      db,
    );
    registerProject(
      { id: "gwrk", name: "gwrk-updated", path: "/Users/gonzo/Code/gwrk" },
      db,
    );

    const projects = listProjects(db);
    expect(projects).toHaveLength(1);
    expect((projects[0] as { name: string }).name).toBe("gwrk-updated");
  });
});
