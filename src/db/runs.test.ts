/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverGitIdentityFacts } from "../adapters/git/project-id.js";
import {
  computeLegacyProjectIds,
  computeProjectId,
} from "../domain/project-id.js";
import { getTestDb } from "./index.js";
import { createProjectRegistry } from "./project-registry.js";
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

const TEST_PROJECT_ID = "test-project-id";

describe("runs db", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
    registerProject(
      {
        id: TEST_PROJECT_ID,
        name: "Test Project",
        path: "/tmp/test-project",
      },
      db,
    );
  });

  it("should start and finish a run", () => {
    const runId = startRun(
      {
        feature_id: "test-feat",
        phase_id: "phase-1",
        command: "test",
        agent_backend: "gemini",
        project_id: TEST_PROJECT_ID,
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

    const runs = listRuns("test-feat", TEST_PROJECT_ID, db);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].exit_code).toBe(0);
    expect(runs[0].feature_id).toBe("test-feat");
  });

  it("should record a complete run in one call", () => {
    const runId = recordRun(
      {
        feature_id: "record-feat",
        command: "ship",
        exit_code: 0,
        duration_s: 45,
        project_id: TEST_PROJECT_ID,
      },
      db,
    );

    expect(runId).toBeGreaterThan(0);
    const runs = listRuns("record-feat", TEST_PROJECT_ID, db);
    expect(runs[0].duration_s).toBe(45);
  });

  it("should register and list projects", () => {
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
    recordRun(
      {
        feature_id: "stats-feat",
        command: "stats-cmd",
        agent_backend: "gemini",
        exit_code: 0,
        duration_s: 10,
        project_id: TEST_PROJECT_ID,
      },
      db,
    );

    const stats = getStats(TEST_PROJECT_ID, db);
    const stat = stats.find((s) => s.command === "stats-cmd");
    expect(stat).toBeDefined();
    expect(stat?.total_runs).toBeGreaterThan(0);
  });

  it("should record history", () => {
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

  it("startRun reconciles by path when a stale project id occupies cwd (changed remote)", () => {
    // Regression: the repo's `origin` remote changed, so resolveProjectId(cwd)
    // now returns a NEW id, but the projects table still holds a row for the
    // SAME path under the OLD id. `INSERT OR IGNORE` can't add the new id
    // (projects.path is UNIQUE), so the runs insert used to fail the FK.
    const STALE_ID = "stale-remote-id-0000000000000000";
    registerProject(
      { id: STALE_ID, name: "cwd-project", path: process.cwd() },
      db,
    );

    // No explicit project_id → startRun resolves one from cwd. Must not throw,
    // and must record the run under the existing (path-bound) project.
    let runId = 0;
    expect(() => {
      runId = startRun(
        { feature_id: "reconcile-feat", command: "define tests" },
        db,
      );
    }).not.toThrow();

    expect(runId).toBeGreaterThan(0);
    const runs = listRuns("reconcile-feat", STALE_ID, db);
    expect(runs.length).toBe(1);
  });

  it("keeps implicit runs with the checkout after a write for another project", () => {
    const checkoutId = TEST_PROJECT_ID;
    registerProject(
      { id: checkoutId, name: "Checkout", path: process.cwd() },
      db,
    );

    startRun(
      {
        feature_id: "shared",
        command: "explicit",
        project_id: "other-project",
      },
      db,
    );
    const implicitId = startRun(
      { feature_id: "shared", command: "implicit" },
      db,
    );

    expect(listRuns("shared", checkoutId, db).map(({ id }) => id)).toEqual([
      implicitId,
    ]);
    expect(
      listRuns("shared", "other-project", db).map(({ command }) => command),
    ).toEqual(["explicit"]);
    expect(
      db.prepare("SELECT id FROM projects ORDER BY id").pluck().all(),
    ).toEqual(["other-project", checkoutId]);
    expect(
      db
        .prepare("SELECT path, local_root FROM projects WHERE id = ?")
        .get("other-project"),
    ).toEqual({ path: "", local_root: null });
  });

  it("keeps implicit runs with verified legacy history until enrollment", () => {
    const checkout = realpathSync(
      mkdtempSync(join(tmpdir(), "gwrk-run-owner-")),
    );
    try {
      execFileSync("git", ["init", "--quiet", checkout], { stdio: "ignore" });
      const facts = discoverGitIdentityFacts(checkout);
      const [legacyId] = computeLegacyProjectIds(facts);
      const computedId = computeProjectId(facts);
      registerProject({ id: legacyId, name: "Checkout", path: checkout }, db);
      const cwd = vi.spyOn(process, "cwd").mockReturnValue(checkout);
      try {
        const previous = startRun(
          { feature_id: "shared", command: "previous", project_id: legacyId },
          db,
        );
        const explicit = startRun(
          { feature_id: "shared", command: "explicit", project_id: computedId },
          db,
        );
        const implicit = startRun(
          { feature_id: "shared", command: "implicit" },
          db,
        );

        expect
          .soft(listRuns("shared", legacyId, db).map(({ id }) => id))
          .toEqual([implicit, previous]);
        expect
          .soft(listRuns("shared", computedId, db).map(({ id }) => id))
          .toEqual([explicit]);

        const registry = createProjectRegistry(db, () => {});
        const now = "2026-11-11T12:00:00.000Z";
        registry.enrollProject({
          projectId: computedId,
          slug: "checkout",
          name: "Checkout",
          repoSlug: null,
          trunkBranch: "develop",
          localRoot: checkout,
          mirrorPath: null,
          runnerPolicy: { allowedKinds: ["local"] },
          slack: null,
          legacyProjectIds: [legacyId],
          createdAt: now,
          updatedAt: now,
        });
        const enrolledRun = startRun(
          { feature_id: "shared", command: "enrolled" },
          db,
        );
        for (const id of [legacyId, computedId]) {
          expect(listRuns("shared", id, db).map((run) => run.id)).toEqual([
            enrolledRun,
            implicit,
            explicit,
            previous,
          ]);
        }
      } finally {
        cwd.mockRestore();
      }
    } finally {
      rmSync(checkout, { recursive: true, force: true });
    }
  });

  describe("FR-H03: DB Record Finalization", () => {
    it("US-H03: finishRun updates status, PR, and merge commit", () => {
      const runId = startRun(
        {
          feature_id: "harvest-feat",
          phase_id: "p1",
          command: "ship",
          agent_backend: "gemini",
          project_id: TEST_PROJECT_ID,
        },
        db,
      );

      finishRun(
        runId,
        {
          exit_code: 0,
          duration_s: 120,
          status: "merged",
          merge_commit_sha: "abc1234567890",
        },
        db,
      );

      const runs = listRuns("harvest-feat", TEST_PROJECT_ID, db);
      const run = runs.find((r) => r.id === runId);
      expect(run).toBeDefined();
      expect(run?.status).toBe("merged");
      expect(run?.merge_commit_sha).toBe("abc1234567890");
    });

    it("should fail gracefully if runId does not exist", () => {
      expect(() => {
        finishRun(
          999999, // Non-existent ID
          {
            exit_code: 0,
            duration_s: 10,
          },
          db,
        );
      }).not.toThrow();
    });

    it("should handle missing optional merge metadata", () => {
      const runId = startRun(
        {
          feature_id: "harvest-partial-feat",
          command: "ship",
          project_id: TEST_PROJECT_ID,
        },
        db,
      );

      finishRun(
        runId,
        {
          exit_code: 0,
          duration_s: 60,
        },
        db,
      );

      const runs = listRuns("harvest-partial-feat", TEST_PROJECT_ID, db);
      const run = runs.find((r) => r.id === runId);
      expect(run).toBeDefined();
      expect(run?.status).toBeNull();
    });
  });
});
