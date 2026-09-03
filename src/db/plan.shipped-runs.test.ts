/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A ship run that FAILED must not promote its phase to SHIPPED.
 *
 * `getShippedPhases` selected every `command = 'ship'` row with no regard for
 * `exit_code`, and `plan init` promotes `PLANNED → SHIPPED` from that set. So a
 * run that died anywhere — PR_CI, a circuit breaker, a kill — still recorded the
 * phase as shipped.
 *
 * 005-dashboard-api/phase-07 is the live case: the run exited 1 on a transient
 * GitHub GraphQL error, and plan sync promoted the phase anyway. The audit caught
 * it ("graph says SHIPPED, gate is RED on this branch") — but the audit is a
 * separate opt-in pass, and everything in between believed the false status. It
 * matters more since #167, where readiness releases later phases on the strength
 * of a predecessor's status.
 *
 * In-flight runs (`exit_code IS NULL`) must not count either; `= 0` excludes them.
 */

import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "./index.js";
import { getShippedPhases } from "./plan.js";

const PROJECT = "test-project";

describe("getShippedPhases", () => {
  let db: Database.Database;

  /** Insert a run row directly — the shape `finishRun` leaves behind. */
  const run = (opts: {
    feature: string;
    phase: string;
    command?: string;
    exitCode?: number | null;
  }) => {
    db.prepare(
      `INSERT INTO runs (feature_id, phase_id, command, exit_code, project_id, started_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      opts.feature,
      opts.phase,
      opts.command ?? "ship",
      opts.exitCode === undefined ? 0 : opts.exitCode,
      PROJECT,
      "2026-08-10T00:00:00.000Z",
    );
  };

  beforeEach(() => {
    db = getTestDb();
    // runs.project_id references projects(id).
    for (const id of [PROJECT, "other-project"]) {
      db.prepare(
        "INSERT INTO projects (id, name, path) VALUES (?, ?, ?)",
      ).run(id, id, `/tmp/${id}`);
    }
  });

  it("counts a ship run that succeeded", () => {
    run({ feature: "005-dashboard-api", phase: "phase-01", exitCode: 0 });

    expect(getShippedPhases(PROJECT, db)).toEqual(
      new Set(["005-dashboard-api:phase-01"]),
    );
  });

  it("ignores a ship run that failed", () => {
    // The 005 phase-07 case: exited 1 at PR_CI, promoted anyway.
    run({ feature: "005-dashboard-api", phase: "phase-07", exitCode: 1 });

    expect(getShippedPhases(PROJECT, db)).toEqual(new Set());
  });

  it("ignores a run still in flight", () => {
    run({ feature: "005-dashboard-api", phase: "phase-08", exitCode: null });

    expect(getShippedPhases(PROJECT, db)).toEqual(new Set());
  });

  it("still ignores non-ship commands", () => {
    run({ feature: "005-dashboard-api", phase: "phase-01", command: "define", exitCode: 0 });

    expect(getShippedPhases(PROJECT, db)).toEqual(new Set());
  });

  it("counts a phase whose earlier attempt failed but a later one succeeded", () => {
    // Re-shipping after a failure is the normal recovery path.
    run({ feature: "005-dashboard-api", phase: "phase-07", exitCode: 1 });
    run({ feature: "005-dashboard-api", phase: "phase-07", exitCode: 0 });

    expect(getShippedPhases(PROJECT, db)).toEqual(
      new Set(["005-dashboard-api:phase-07"]),
    );
  });

  it("scopes to the project", () => {
    run({ feature: "005-dashboard-api", phase: "phase-01", exitCode: 0 });

    expect(getShippedPhases("other-project", db)).toEqual(new Set());
  });
});
