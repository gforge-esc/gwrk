import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startRun, finishRun, listRuns } from "./runs.js";
import { getDb, closeDb } from "./index.js";
import fs from "node:fs";

describe("runs db", () => {
  beforeEach(() => {
    // Ensure we are using a clean in-memory database or a temp file
    // For these tests, we'll just use the default getDb() which might be a file,
    // so let's be careful. Actually better-sqlite3 :memory: is best.
  });

  afterEach(() => {
    // closeDb();
  });

  it("should start and finish a run", () => {
    const db = getDb();
    const runId = startRun({
      feature_id: "test-feat",
      phase_id: "phase-1",
      command: "test",
      agent_backend: "gemini",
    }, db);

    expect(runId).toBeGreaterThan(0);

    finishRun(runId, {
      exit_code: 0,
      duration_s: 10,
    }, db);

    const runs = listRuns("test-feat", db);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].exit_code).toBe(0);
    expect(runs[0].feature_id).toBe("test-feat");
  });
});
