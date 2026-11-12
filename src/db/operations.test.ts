/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "./index.js";
import { registerProject, startRun } from "./runs.js";

const now = "2026-11-11T12:00:00.000Z";
const migrations = fileURLToPath(new URL("./migrations/", import.meta.url));
const durableMigration = "017-durable-dispatch-and-harvest.sql";

describe("durable operations migration", () => {
  let root: string;
  let dbPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gwrk-durable-operations-"));
    dbPath = join(root, "ledger.sqlite");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("preserves the existing execution ledger when migration 017 runs", () => {
    const previousMigrations = join(root, "previous-migrations");
    mkdirSync(previousMigrations);
    cpSync(migrations, previousMigrations, {
      recursive: true,
      filter: (source) => basename(source) !== durableMigration,
    });

    const previous = openDatabase({
      dbPath,
      migrationsDir: previousMigrations,
    });
    let runId: number;
    try {
      registerProject(
        { id: "alpha", name: "Alpha", path: "/fixture/alpha" },
        previous,
      );
      runId = startRun(
        {
          feature_id: "001-fixture",
          phase_id: "phase-01",
          project_id: "alpha",
          command: "ship",
          agent_backend: "codex",
          workflow: "ship-done",
        },
        previous,
      );
    } finally {
      previous.close();
    }

    const upgraded = openDatabase({ dbPath });
    try {
      expect(
        upgraded
          .prepare("SELECT project_id FROM runs WHERE id = ?")
          .pluck()
          .get(runId),
      ).toBe("alpha");
      expect(
        upgraded
          .prepare("SELECT name FROM _migrations WHERE name = ?")
          .pluck()
          .get(durableMigration),
      ).toBe(durableMigration);
      expect(
        upgraded
          .prepare(
            "SELECT name FROM _migrations WHERE name >= '015' ORDER BY id",
          )
          .pluck()
          .all(),
      ).toEqual([
        "015-ledger-write-order.sql",
        "016-plan-write-order.sql",
        durableMigration,
      ]);
      const tables = upgraded
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .pluck()
        .all();
      expect(tables).toEqual(
        expect.arrayContaining([
          "dispatch_operations",
          "dispatch_attempts",
          "harvest_deliveries",
          "harvest_delivery_operations",
          "harvest_work_key_aliases",
          "harvest_cursors",
          "harvest_operations",
          "harvest_stage_receipts",
          "notification_outbox",
        ]),
      );
      expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("rolls back incomplete durable tables and retries migration cleanly", () => {
    const brokenMigrations = join(root, "broken-migrations");
    cpSync(migrations, brokenMigrations, { recursive: true });
    appendFileSync(
      join(brokenMigrations, durableMigration),
      "\nSELECT from_missing_column;\n",
    );
    expect(() =>
      openDatabase({ dbPath, migrationsDir: brokenMigrations }),
    ).toThrow(/from_missing_column/);
    const before = new Database(dbPath);
    try {
      expect(
        before
          .prepare(
            "SELECT name FROM sqlite_master WHERE name = 'dispatch_operations'",
          )
          .get(),
      ).toBeUndefined();
      expect(
        before
          .prepare("SELECT name FROM _migrations WHERE name = ?")
          .get(durableMigration),
      ).toBeUndefined();
    } finally {
      before.close();
    }
    const recovered = openDatabase({ dbPath });
    try {
      expect(
        recovered
          .prepare("SELECT name FROM _migrations WHERE name = ?")
          .pluck()
          .get(durableMigration),
      ).toBe(durableMigration);
      expect(recovered.pragma("foreign_key_check")).toEqual([]);
    } finally {
      recovered.close();
    }
  });

  it("persists an offline harvest without pull request metadata", () => {
    const db = openDatabase({ dbPath });
    const commit = "a".repeat(40);
    try {
      registerProject(
        { id: "alpha", name: "Alpha", path: "/fixture/alpha" },
        db,
      );
      db.prepare(`
        INSERT INTO harvest_operations (
          operation_id, project_id, work_key, trunk_branch, feature_id,
          terminal_event, merge_commit_sha, terminal_at, status, created_at, updated_at
        ) VALUES ('offline', 'alpha', 'local-commit', 'develop', '001-fixture',
          'merged', ?, ?, 'accepted', ?, ?)
      `).run(commit, now, now, now);
    } finally {
      db.close();
    }
    const reopened = openDatabase({ dbPath });
    try {
      expect(
        reopened
          .prepare(`
          SELECT pr_number, pr_url, merge_commit_sha, status
          FROM harvest_operations WHERE operation_id = 'offline'
        `)
          .get(),
      ).toEqual({
        pr_number: null,
        pr_url: null,
        merge_commit_sha: commit,
        status: "accepted",
      });
      expect(reopened.pragma("foreign_key_check")).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it("preserves the resolved Slack recipient separately across reopen", () => {
    const db = openDatabase({ dbPath });
    const recipient = JSON.stringify({
      workspaceId: "W1",
      channelId: "C1",
      threadTs: null,
    });
    const resolved = JSON.stringify({
      workspaceId: "W1",
      channelId: "C1",
      threadTs: "1700000000.000100",
    });
    try {
      registerProject(
        { id: "alpha", name: "Alpha", path: "/fixture/alpha" },
        db,
      );
      db.prepare(`
        INSERT INTO harvest_operations (
          operation_id, project_id, work_key, trunk_branch, feature_id,
          terminal_event, terminal_at, recipient_json, status, created_at, updated_at
        ) VALUES ('merge', 'alpha', 'merge-1', 'develop', '001-fixture',
          'merged', ?, ?, 'accepted', ?, ?)
      `).run(now, recipient, now, now);
      const select =
        "SELECT planned_slack_recipient_json FROM harvest_operations WHERE operation_id = 'merge'";
      expect(db.prepare(select).pluck().get()).toBeNull();
      db.prepare(`
        UPDATE harvest_operations SET planned_slack_recipient_json = ?
        WHERE project_id = 'alpha' AND operation_id = 'merge'
      `).run(resolved);
    } finally {
      db.close();
    }
    const reopened = openDatabase({ dbPath });
    try {
      expect(
        reopened
          .prepare(`
        SELECT recipient_json, planned_slack_recipient_json
        FROM harvest_operations WHERE operation_id = 'merge'
      `)
          .get(),
      ).toEqual({
        recipient_json: recipient,
        planned_slack_recipient_json: resolved,
      });
    } finally {
      reopened.close();
    }
  });

  it("reopens accepted dispatches in order and fences a superseded worker", async () => {
    const { createSqliteOperationsStoreAdapter } = await import(
      "../adapters/sqlite/operations.js"
    );
    const firstExpiry = "2026-11-11T12:00:10.000Z";
    const secondExpiry = "2026-11-11T12:01:10.000Z";
    const request = {
      projectId: "alpha",
      featureId: "001-fixture",
      phaseId: "phase-01",
      trunkBranch: "develop",
      backend: "codex",
      newOperationId: "first",
      nowIso: now,
    };
    const initial = openDatabase({ dbPath });
    let staleFence: {
      operationId: string;
      leaseOwner: string;
      leaseEpoch: number;
    };
    try {
      registerProject(
        { id: "alpha", name: "Alpha", path: "/fixture/alpha" },
        initial,
      );
      const store = createSqliteOperationsStoreAdapter({ db: initial });
      expect(store.acceptDispatch(request)).toMatchObject({
        operationId: "first",
        status: "accepted",
        deduplicated: false,
      });
      expect(
        store.acceptDispatch({ ...request, newOperationId: "duplicate" }),
      ).toMatchObject({
        operationId: "first",
        deduplicated: true,
      });
      store.acceptDispatch({
        ...request,
        phaseId: "phase-02",
        newOperationId: "second",
        nowIso: "2026-11-11T12:00:01.000Z",
      });
      const claim = store.claimDispatchLease({
        operationId: "first",
        leaseOwner: "old-worker",
        nowIso: now,
        leaseExpiresAt: firstExpiry,
      });
      if (!claim) throw new Error("Expected first dispatch lease");
      staleFence = claim.fence;
      expect(
        store
          .listRecoverableDispatches({ nowIso: now })
          .map(({ operationId }) => operationId),
      ).toEqual(["second"]);
    } finally {
      initial.close();
    }

    const reopened = openDatabase({ dbPath });
    try {
      const store = createSqliteOperationsStoreAdapter({ db: reopened });
      const recovered = store.listRecoverableDispatches({
        nowIso: firstExpiry,
        projectId: "alpha",
      });
      expect(recovered.map(({ operationId }) => operationId)).toEqual([
        "first",
        "second",
      ]);
      const claim = store.claimDispatchLease({
        operationId: "first",
        leaseOwner: "new-worker",
        nowIso: firstExpiry,
        leaseExpiresAt: secondExpiry,
      });
      if (!claim) throw new Error("Expected successor dispatch lease");
      expect(claim.fence.leaseEpoch).toBe(staleFence.leaseEpoch + 1);
      expect(
        store.completeDispatchAttempt({
          fence: staleFence,
          nowIso: firstExpiry,
          operationStatus: "failed",
          attemptStatus: "failed",
          exitCode: 1,
        }),
      ).toEqual({ ok: false, code: "LEASE_FENCED" });
      expect(store.getDispatchOperation(request)).toMatchObject({
        operationId: "first",
        leaseOwner: "new-worker",
        leaseEpoch: claim.fence.leaseEpoch,
      });
      expect(
        store.completeDispatchAttempt({
          fence: claim.fence,
          nowIso: firstExpiry,
          operationStatus: "completed",
          attemptStatus: "completed",
          exitCode: 0,
        }),
      ).toEqual({ ok: true });
      expect(store.getDispatchOperation(request)).toMatchObject({
        operationId: "first",
        status: "completed",
      });
      expect(reopened.pragma("foreign_key_check")).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it("enforces active dispatch uniqueness per project across connections", () => {
    const first = openDatabase({ dbPath });
    const second = openDatabase({ dbPath });
    try {
      for (const id of ["alpha", "beta"]) {
        registerProject({ id, name: id, path: `/fixture/${id}` }, first);
      }
      const statement = `
        INSERT INTO dispatch_operations (
          operation_id, project_id, work_key, feature_id, phase_id, backend,
          branch_name, trunk_branch, status, created_at, updated_at
        ) VALUES (?, ?, 'ship:001-fixture:phase-01', '001-fixture', 'phase-01',
          'codex', 'feat/001-fixture', 'develop', 'accepted', ?, ?)
      `;
      first.prepare(statement).run("alpha-active", "alpha", now, now);
      expect(() =>
        second.prepare(statement).run("alpha-duplicate", "alpha", now, now),
      ).toThrow(/UNIQUE constraint/);
      expect(
        second.prepare(statement).run("beta-active", "beta", now, now).changes,
      ).toBe(1);
      expect(() =>
        second.prepare(statement).run("foreign", "unenrolled", now, now),
      ).toThrow(/FOREIGN KEY constraint/);
      first
        .prepare(
          "UPDATE dispatch_operations SET status = 'completed' WHERE operation_id = ?",
        )
        .run("alpha-active");
      expect(
        second.prepare(statement).run("alpha-new", "alpha", now, now).changes,
      ).toBe(1);
    } finally {
      second.close();
      first.close();
    }
    const reopened = openDatabase({ dbPath });
    try {
      expect(
        reopened
          .prepare(
            "SELECT operation_id FROM dispatch_operations WHERE status = 'accepted' ORDER BY operation_id",
          )
          .pluck()
          .all(),
      ).toEqual(["alpha-new", "beta-active"]);
    } finally {
      reopened.close();
    }
  });
});
