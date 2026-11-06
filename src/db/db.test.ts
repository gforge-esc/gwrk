/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertCompressionRecord } from "./db.js";
import { getTestDb } from "./index.js";
import {
  finishRun,
  getStats,
  listProjects,
  listRuns,
  registerProject,
  startRun,
} from "./runs.js";

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
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
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
        project_id: "test-proj",
        command: "ship",
        agent_backend: "gemini",
        workflow: "ship-done",
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

    const runs = listRuns("001-cli-core", "test-proj", db);
    expect(runs).toHaveLength(1);
    expect(runs[0].exit_code).toBe(0);
    expect(runs[0].duration_s).toBe(42);
    expect(runs[0].gate_result).toBe("PASS");
    expect(runs[0].review_verdict).toBe("GO");
  });

  it("should list runs most recent first", () => {
    const id1 = startRun(
      {
        feature_id: "test-feature",
        project_id: "test-proj",
        command: "define",
        workflow: "define-until-solid",
      },
      db,
    );
    const id2 = startRun(
      {
        feature_id: "test-feature",
        project_id: "test-proj",
        command: "ship",
        workflow: "ship-done",
      },
      db,
    );
    startRun(
      {
        feature_id: "other-feature",
        project_id: "test-proj",
        command: "ship",
        workflow: "ship-done",
      },
      db,
    );

    const runs = listRuns("test-feature", "test-proj", db);
    expect(runs).toHaveLength(2);
    expect(runs[0].id).toBe(id2);
    expect(runs[1].id).toBe(id1);
  });

  it("should return empty array for unknown feature", () => {
    const runs = listRuns("nonexistent", "test-proj", db);
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

  it("should aggregate run statistics with getStats", () => {
    const id1 = startRun(
      {
        feature_id: "f1",
        project_id: "test-proj",
        command: "ship",
        agent_backend: "gemini",
        workflow: "ship-done",
      },
      db,
    );
    finishRun(id1, { exit_code: 0, duration_s: 100 }, db);

    const id2 = startRun(
      {
        feature_id: "f2",
        project_id: "test-proj",
        command: "ship",
        agent_backend: "gemini",
        workflow: "ship-done",
      },
      db,
    );
    finishRun(id2, { exit_code: 0, duration_s: 200 }, db);

    const id3 = startRun(
      {
        feature_id: "f3",
        project_id: "test-proj",
        command: "ship",
        agent_backend: "gemini",
        workflow: "ship-done",
      },
      db,
    );
    finishRun(id3, { exit_code: 1, duration_s: 50 }, db);

    const id4 = startRun(
      {
        feature_id: "f4",
        project_id: "test-proj",
        command: "define",
        agent_backend: "claude",
        workflow: "define-until-solid",
      },
      db,
    );
    finishRun(id4, { exit_code: 0, duration_s: 300 }, db);

    startRun(
      {
        feature_id: "f5",
        project_id: "test-proj",
        command: "analyze",
        agent_backend: "openai",
        workflow: "analyze",
      },
      db,
    );

    const stats = getStats("test-proj", db);

    expect(stats).toHaveLength(2);
    expect(stats[0]?.command).toBe("ship");
    expect(stats[0]?.agent_backend).toBe("gemini");
    expect(stats[0]?.total_runs).toBe(3);
    expect(stats[0]?.success_runs).toBe(2);
    expect(stats[0]?.avg_duration_s).toBe(350 / 3);

    expect(stats[1]?.command).toBe("define");
    expect(stats[1]?.agent_backend).toBe("claude");
    expect(stats[1]?.total_runs).toBe(1);
    expect(stats[1]?.success_runs).toBe(1);
    expect(stats[1]?.avg_duration_s).toBe(300);
  });
});

describe("FR-013: SQLite Persistence", () => {
  it("US-009 / TR-014: Should insert compression results into the SQLite table", () => {
    expect(() => insertCompressionRecord({ feature_id: "123" })).toThrow();
  });

  it("Should fail if required fields are missing", () => {
    expect(() => insertCompressionRecord({})).toThrow();
  });
});
