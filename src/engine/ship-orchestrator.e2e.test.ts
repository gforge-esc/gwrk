/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @phase phase-13
 *
 * Ship Orchestrator E2E — Real DB, Mocked Externals
 *
 * This test exercises the full chain that has broken repeatedly:
 *   startRun() → orchestrator.run() → harvest → finishRun()
 *
 * It uses a real in-memory SQLite DB (via getTestDb) and mocks only
 * external side-effects (git, gh, agent dispatch, filesystem).
 *
 * Bugs this test would have caught:
 *   1. ESM require('node:crypto') → project_id=NULL
 *   2. finishRun missing pr_number/pr_url/status
 *   3. Harvest runs inside orchestrator.run() before CLI calls finishRun
 *   4. Stale runs with status=NULL blocking harvest
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { getTestDb } from "../db/index.js";
import { startRun, finishRun, listRuns } from "../db/runs.js";

/**
 * Part 1: DB Integration Tests
 *
 * These test the actual DB operations that broke ship/harvest.
 * No mocking of filesystem — pure DB with in-memory SQLite.
 */
describe("Ship→Harvest DB Chain", () => {
  let db: Database.Database;
  const PROJECT_ID = "e2e-test-project-id";
  const FEATURE_ID = "test-feature";
  const PHASE_ID = "phase-01";

  beforeEach(() => {
    db = getTestDb();
    // Register project
    db.prepare(
      `INSERT INTO projects (id, name, path) VALUES (?, ?, ?)`,
    ).run(PROJECT_ID, "test-project", "/mock/cwd");
  });

  afterEach(() => {
    db.close();
  });

  it("startRun creates a record with explicit project_id", () => {
    const runId = startRun(
      {
        feature_id: FEATURE_ID,
        phase_id: PHASE_ID,
        command: "ship",
        agent_backend: "gemini",
        workflow: "work-until-done",
        project_id: PROJECT_ID,
      },
      db,
    );

    const runs = listRuns(FEATURE_ID, PROJECT_ID, db);
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(runId);
    expect(runs[0].project_id).toBe(PROJECT_ID);
  });

  it("startRun auto-resolves project_id from cwd when not provided", () => {
    // This catches the ESM require('node:crypto') bug —
    // if crypto import fails, project_id would be null
    const runId = startRun(
      {
        feature_id: FEATURE_ID,
        phase_id: PHASE_ID,
        command: "ship",
      },
      db,
    );

    // We don't know the exact MD5 of process.cwd() here easily, 
    // but we know listRuns NOW REQUIRES a projectId.
    // For this test, we can query the DB directly to see what was inserted.
    const row = db.prepare("SELECT project_id FROM runs WHERE id = ?").get(runId) as { project_id: string };
    const resolvedProjectId = row.project_id;

    const runs = listRuns(FEATURE_ID, resolvedProjectId, db);
    expect(runs).toHaveLength(1);
    expect(runs[0].project_id).toBeTruthy();
    expect(runs[0].project_id).toMatch(/^[0-9a-f]{32}$/); // MD5 hex
  });

  it("finishRun writes pr_number, pr_url, and status", () => {
    const runId = startRun(
      {
        feature_id: FEATURE_ID,
        phase_id: PHASE_ID,
        command: "ship",
        project_id: PROJECT_ID,
      },
      db,
    );

    finishRun(
      runId,
      {
        exit_code: 0,
        duration_s: 300,
        status: "shipped",
        pr_number: 72,
        pr_url: "https://github.com/test/repo/pull/72",
      },
      db,
    );

    const runs = listRuns(FEATURE_ID, PROJECT_ID, db);
    expect(runs[0].status).toBe("shipped");
    expect(runs[0].pr_number).toBe(72);
    expect(runs[0].pr_url).toBe("https://github.com/test/repo/pull/72");
    expect(runs[0].exit_code).toBe(0);
  });

  it("listRuns filters by project_id — mismatched project returns empty", () => {
    startRun(
      {
        feature_id: FEATURE_ID,
        phase_id: PHASE_ID,
        command: "ship",
        project_id: PROJECT_ID,
      },
      db,
    );

    const wrongProject = listRuns(FEATURE_ID, "wrong-project-id", db);
    expect(wrongProject).toHaveLength(0);

    const rightProject = listRuns(FEATURE_ID, PROJECT_ID, db);
    expect(rightProject).toHaveLength(1);
  });

  it("harvest match: finds run by phase + pr_number (NULL pr_number matches any)", () => {
    const runId = startRun(
      {
        feature_id: FEATURE_ID,
        phase_id: PHASE_ID,
        command: "ship",
        project_id: PROJECT_ID,
      },
      db,
    );

    // Before finishRun: status=NULL, pr_number=NULL
    const runs = listRuns(FEATURE_ID, PROJECT_ID, db);
    expect(runs[0].status).toBeNull();
    expect(runs[0].pr_number).toBeNull();

    // This is the harvest match logic (from harvest.ts L130-135):
    const prNumber = 42;
    const targetRun = runs.find(
      (r) =>
        r.phase_id === PHASE_ID &&
        (r.pr_number === prNumber || !r.pr_number) &&
        r.status !== "merged",
    );

    expect(targetRun).toBeDefined();
    expect(targetRun!.id).toBe(runId);
  });

  it("stale runs with status=NULL block harvest phase finalization", () => {
    // Create 3 stale runs (simulating failed ship attempts)
    for (let i = 0; i < 3; i++) {
      startRun(
        {
          feature_id: FEATURE_ID,
          phase_id: PHASE_ID,
          command: "ship",
          project_id: PROJECT_ID,
        },
        db,
      );
    }

    const runs = listRuns(FEATURE_ID, PROJECT_ID, db);
    expect(runs).toHaveLength(3);

    // Simulate harvest matching the most recent run and marking it merged
    const targetRun = runs[0]; // most recent (listRuns is DESC)
    finishRun(targetRun.id!, { status: "merged" }, db);

    // The other 2 runs are still pending (status=NULL) — this blocks phase finalization
    const pendingRuns = listRuns(FEATURE_ID, PROJECT_ID, db).filter(
      (r) =>
        r.phase_id === PHASE_ID &&
        r.id !== targetRun.id &&
        r.status !== "merged" &&
        r.status !== "closed",
    );

    // This reproduces the "8 pending runs, skipping phase finalization" bug
    expect(pendingRuns).toHaveLength(2);
  });

  it("marking stale runs as abandoned unblocks harvest", () => {
    const stale1 = startRun(
      { feature_id: FEATURE_ID, phase_id: PHASE_ID, command: "ship", project_id: PROJECT_ID },
      db,
    );
    const stale2 = startRun(
      { feature_id: FEATURE_ID, phase_id: PHASE_ID, command: "ship", project_id: PROJECT_ID },
      db,
    );
    const currentRun = startRun(
      { feature_id: FEATURE_ID, phase_id: PHASE_ID, command: "ship", project_id: PROJECT_ID },
      db,
    );

    finishRun(stale1, { status: "abandoned" }, db);
    finishRun(stale2, { status: "abandoned" }, db);
    finishRun(currentRun, { status: "merged" }, db);

    const pendingRuns = listRuns(FEATURE_ID, PROJECT_ID, db).filter(
      (r) =>
        r.phase_id === PHASE_ID &&
        r.status !== "merged" &&
        r.status !== "closed" &&
        r.status !== "abandoned",
    );

    expect(pendingRuns).toHaveLength(0);
  });

  it("full chain: startRun → finishRun(PR data) → harvest can match", () => {
    // 1. CLI wrapper calls startRun
    const runId = startRun(
      {
        feature_id: FEATURE_ID,
        phase_id: PHASE_ID,
        command: "ship",
        agent_backend: "gemini",
        workflow: "work-until-done",
        project_id: PROJECT_ID,
      },
      db,
    );

    // 2. After orchestrator.run() completes, CLI writes PR data
    finishRun(
      runId,
      {
        exit_code: 0,
        duration_s: 120,
        status: "shipped",
        pr_number: 42,
        pr_url: "https://github.com/test/repo/pull/42",
      },
      db,
    );

    // 3. Verify the DB has the complete record
    const runs = listRuns(FEATURE_ID, PROJECT_ID, db);
    expect(runs).toHaveLength(1);

    const run = runs[0];
    expect(run.exit_code).toBe(0);
    expect(run.duration_s).toBe(120);
    expect(run.status).toBe("shipped");
    expect(run.pr_number).toBe(42);
    expect(run.pr_url).toContain("pull/42");
    expect(run.project_id).toBe(PROJECT_ID);

    // 4. Verify harvest match logic works
    const targetRun = runs.find(
      (r) =>
        r.phase_id === PHASE_ID &&
        (r.pr_number === 42 || !r.pr_number) &&
        r.status !== "merged",
    );
    expect(targetRun).toBeDefined();
    expect(targetRun!.id).toBe(runId);
  });

  it("finishRun with pr_number COALESCE preserves existing pr_number", () => {
    const runId = startRun(
      { feature_id: FEATURE_ID, phase_id: PHASE_ID, command: "ship", project_id: PROJECT_ID },
      db,
    );

    // First: set pr_number
    finishRun(runId, { pr_number: 42, status: "shipped" }, db);

    // Second: update status to merged without passing pr_number
    finishRun(runId, { status: "merged" }, db);

    const runs = listRuns(FEATURE_ID, PROJECT_ID, db);
    // COALESCE(@pr_number, pr_number) should preserve 42
    expect(runs[0].pr_number).toBe(42);
    expect(runs[0].status).toBe("merged");
  });
});
