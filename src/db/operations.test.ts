/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteOperationsStoreAdapter } from "../adapters/sqlite/operations.js";
import {
  type HarvestCandidateInput,
  computeHarvestWorkKey,
  planHarvestStages,
  verifyHarvestTarget,
} from "../domain/durable-harvest.js";
import type { EnrolledProject } from "../domain/project-registry.js";
import type {
  DurableHarvestOperation,
  OperationsStorePort,
} from "../ports/operations-port.js";
import {
  persistDispatch,
  readLegacyDispatches,
} from "../server/persistence.js";
import type { DispatchRecord } from "../server/types.js";
import { openDatabase } from "./index.js";
import { createOperationsStore } from "./operations.js";
import { registerProject, startRun } from "./runs.js";

const now = "2026-11-11T12:00:00.000Z";
const migrations = fileURLToPath(new URL("./migrations/", import.meta.url));
const durableMigration = "018-durable-dispatch-and-harvest.sql";

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

  it("enforces outbox metadata uniqueness when upgrading the earlier durable schema", () => {
    const previousMigrations = join(root, "pre-durable-unique-index");
    cpSync(migrations, previousMigrations, {
      recursive: true,
      filter: (source) =>
        basename(source) !== "019-outbox-metadata-uniqueness.sql",
    });
    const previousSql = readFileSync(
      join(previousMigrations, durableMigration),
      "utf8",
    ).replace(",\n  UNIQUE (client_metadata_key)", "");
    writeFileSync(join(previousMigrations, durableMigration), previousSql);
    const previous = openDatabase({
      dbPath,
      migrationsDir: previousMigrations,
    });
    const insert = `INSERT INTO notification_outbox (outbox_id, project_id, dedupe_key, owner_kind, owner_operation_id, event_type, feature_id, recipient_json, payload_json, client_metadata_key, status, created_at, updated_at) VALUES (?, ?, ?, 'harvest', 'operation', 'completed', '001-fixture', '{}', '{}', 'shared-key', 'pending', ?, ?)`;
    try {
      registerProject(
        { id: "alpha", name: "Alpha", path: "/fixture/alpha" },
        previous,
      );
      registerProject(
        { id: "beta", name: "Beta", path: "/fixture/beta" },
        previous,
      );
      previous.prepare(insert).run("first", "alpha", "one", now, now);
    } finally {
      previous.close();
    }
    const upgraded = openDatabase({ dbPath });
    try {
      expect(
        upgraded
          .prepare(
            "SELECT client_metadata_key FROM notification_outbox WHERE outbox_id = 'first'",
          )
          .pluck()
          .get(),
      ).toBe("shared-key");
      expect(() =>
        upgraded.prepare(insert).run("second", "beta", "two", now, now),
      ).toThrow(/unique/i);
    } finally {
      upgraded.close();
    }
  });

  it("preserves the existing execution ledger when migration 018 runs", () => {
    const previousMigrations = join(root, "previous-migrations");
    mkdirSync(previousMigrations);
    cpSync(migrations, previousMigrations, {
      recursive: true,
      filter: (source) =>
        !basename(source).endsWith(".sql") ||
        basename(source) < durableMigration,
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
        "017-plan-parent-provenance.sql",
        durableMigration,
        "019-outbox-metadata-uniqueness.sql",
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

  it("persists verified checkout identity for offline deliveries", () => {
    const db = openDatabase({ dbPath });
    try {
      registerProject(
        { id: "alpha", name: "Alpha", path: "/fixture/alpha" },
        db,
      );
      const insert = db.prepare(`
        INSERT INTO harvest_deliveries (
          source, delivery_id, project_id, repo_slug, checkout_repo_slug,
          payload_digest, event_type, outcome, received_at
        ) VALUES ('manual_cli', ?, 'alpha', NULL, ?, 'fixture-digest',
          'merged', 'accepted', ?)
      `);
      insert.run("with-origin", "example/alpha", now);
      insert.run("without-origin", null, now);
    } finally {
      db.close();
    }

    const reopened = openDatabase({ dbPath });
    try {
      expect(
        reopened
          .prepare(`
          SELECT delivery_id, repo_slug, checkout_repo_slug
          FROM harvest_deliveries ORDER BY delivery_id
        `)
          .all(),
      ).toEqual([
        {
          delivery_id: "with-origin",
          repo_slug: null,
          checkout_repo_slug: "example/alpha",
        },
        {
          delivery_id: "without-origin",
          repo_slug: null,
          checkout_repo_slug: null,
        },
      ]);
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

  it.each(["expired", "terminal"])(
    "fences dispatch writes for a %s lease",
    async (state) => {
      const { createSqliteOperationsStoreAdapter } = await import(
        "../adapters/sqlite/operations.js"
      );
      const db = openDatabase({ dbPath });
      try {
        registerProject(
          { id: "alpha", name: "Alpha", path: "/fixture/alpha" },
          db,
        );
        const store = createSqliteOperationsStoreAdapter({ db });
        const request = {
          projectId: "alpha",
          featureId: "001-fixture",
          phaseId: "phase-01",
          trunkBranch: "develop",
          backend: "codex",
          newOperationId: "fenced",
          nowIso: now,
        };
        store.acceptDispatch(request);
        const claim = store.claimDispatchLease({
          operationId: "fenced",
          leaseOwner: "worker",
          nowIso: now,
          leaseExpiresAt: "2026-11-11T12:00:10.000Z",
        });
        if (!claim) throw new Error("Missing fixture lease");
        const finish = {
          fence: claim.fence,
          nowIso:
            state === "expired"
              ? "2026-11-11T12:00:10.000Z"
              : "2026-11-11T12:00:01.000Z",
          operationStatus: "completed" as const,
          attemptStatus: "completed" as const,
          exitCode: 0,
        };
        if (state === "expired") {
          const before = db
            .prepare("SELECT * FROM dispatch_attempts WHERE operation_id = ?")
            .get("fenced");
          expect(store.completeDispatchAttempt(finish)).toEqual({
            ok: false,
            code: "LEASE_EXPIRED",
          });
          expect(
            db
              .prepare("SELECT * FROM dispatch_attempts WHERE operation_id = ?")
              .get("fenced"),
          ).toEqual(before);
        } else {
          expect(store.completeDispatchAttempt(finish)).toEqual({ ok: true });
          expect(store.getDispatchOperation(request)).toMatchObject({
            status: "completed",
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
          });
          expect(
            store.completeDispatchAttempt({
              ...finish,
              operationStatus: "failed",
              attemptStatus: "failed",
              exitCode: 1,
            }),
          ).toEqual({ ok: false, code: "LEASE_FENCED" });
          expect(
            store.heartbeatDispatchLease({
              fence: claim.fence,
              nowIso: finish.nowIso,
              leaseExpiresAt: "2026-11-11T12:01:00.000Z",
            }),
          ).toEqual({ ok: false, code: "LEASE_FENCED" });
          expect(store.getDispatchOperation(request)).toMatchObject({
            status: "completed",
          });
        }
      } finally {
        db.close();
      }
    },
  );

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

  it("TR-002: isolates deliveries with the same feature, PR number and merge SHA across repos", async () => {
    const { createSqliteOperationsStoreAdapter } = await import(
      "../adapters/sqlite/operations.js"
    );
    const db = openDatabase({ dbPath });
    try {
      registerProject(
        { id: "alpha", name: "Alpha", path: "/fixture/alpha" },
        db,
      );
      registerProject({ id: "beta", name: "Beta", path: "/fixture/beta" }, db);
      db.prepare("UPDATE projects SET repo_slug = ? WHERE id = ?").run(
        "example/alpha",
        "alpha",
      );
      db.prepare("UPDATE projects SET repo_slug = ? WHERE id = ?").run(
        "example/beta",
        "beta",
      );

      const store = createSqliteOperationsStoreAdapter({ db });

      const alphaDelivery = {
        candidate: {
          source: "github_webhook" as const,
          deliveryId: "del-alpha-42",
          repoSlug: "example/alpha",
          headRepoSlug: "example/alpha",
          baseBranch: "main",
          headBranch: "feat/001-feat-phase-01",
          expectedHeadSha: "1".repeat(40),
          prNumber: 42,
          prUrl: "https://github.com/example/alpha/pull/42",
          terminalEvent: "merged" as const,
          mergeCommitSha: "2".repeat(40),
          terminalAt: now,
        },
        payloadDigest: "digest-alpha-42",
        receivedAt: now,
        target: {
          accepted: true as const,
          project: {
            projectId: "alpha",
            slug: "alpha",
            name: "Alpha",
            repoSlug: "example/alpha",
            trunkBranch: "main",
            localRoot: "/fixture/alpha",
            mirrorPath: null,
            runnerPolicy: { allowedKinds: ["local" as const] },
            slack: null,
            legacyProjectIds: [],
            createdAt: now,
            updatedAt: now,
          },
          operations: [
            {
              operationId: "alpha-op-42",
              projectId: "alpha",
              workKey: computeHarvestWorkKey({
                repoSlug: "example/alpha",
                baseBranch: "main",
                prNumber: 42,
                terminalEvent: "merged",
                mergeCommitSha: "2".repeat(40),
                featureId: "001-feat",
                phaseId: "phase-01",
              }),
              repoSlug: "example/alpha",
              headRepoSlug: "example/alpha",
              trunkBranch: "main",
              featureId: "001-feat",
              phaseId: "phase-01",
              prNumber: 42,
              prUrl: "https://github.com/example/alpha/pull/42",
              headBranch: "feat/001-feat-phase-01",
              expectedHeadSha: "1".repeat(40),
              terminalEvent: "merged" as const,
              mergeCommitSha: "2".repeat(40),
              terminalAt: now,
              recipient: null,
              plannedSlackRecipient: null,
              status: "accepted" as const,
              leaseOwner: null,
              leaseEpoch: 0,
              leaseExpiresAt: null,
              linkedRunId: null,
              lastError: null,
              createdAt: now,
              updatedAt: now,
              completedAt: null,
            },
          ] as [DurableHarvestOperation],
        },
      };

      const betaDelivery = {
        candidate: {
          source: "github_webhook" as const,
          deliveryId: "del-beta-42",
          repoSlug: "example/beta",
          headRepoSlug: "example/beta",
          baseBranch: "main",
          headBranch: "feat/001-feat-phase-01",
          expectedHeadSha: "3".repeat(40),
          prNumber: 42,
          prUrl: "https://github.com/example/beta/pull/42",
          terminalEvent: "merged" as const,
          mergeCommitSha: "2".repeat(40),
          terminalAt: now,
        },
        payloadDigest: "digest-beta-42",
        receivedAt: now,
        target: {
          accepted: true as const,
          project: {
            projectId: "beta",
            slug: "beta",
            name: "Beta",
            repoSlug: "example/beta",
            trunkBranch: "main",
            localRoot: "/fixture/beta",
            mirrorPath: null,
            runnerPolicy: { allowedKinds: ["local" as const] },
            slack: null,
            legacyProjectIds: [],
            createdAt: now,
            updatedAt: now,
          },
          operations: [
            {
              operationId: "beta-op-42",
              projectId: "beta",
              workKey: computeHarvestWorkKey({
                repoSlug: "example/beta",
                baseBranch: "main",
                prNumber: 42,
                terminalEvent: "merged",
                mergeCommitSha: "2".repeat(40),
                featureId: "001-feat",
                phaseId: "phase-01",
              }),
              repoSlug: "example/beta",
              headRepoSlug: "example/beta",
              trunkBranch: "main",
              featureId: "001-feat",
              phaseId: "phase-01",
              prNumber: 42,
              prUrl: "https://github.com/example/beta/pull/42",
              headBranch: "feat/001-feat-phase-01",
              expectedHeadSha: "3".repeat(40),
              terminalEvent: "merged" as const,
              mergeCommitSha: "2".repeat(40),
              terminalAt: now,
              recipient: null,
              plannedSlackRecipient: null,
              status: "accepted" as const,
              leaseOwner: null,
              leaseEpoch: 0,
              leaseExpiresAt: null,
              linkedRunId: null,
              lastError: null,
              createdAt: now,
              updatedAt: now,
              completedAt: null,
            },
          ] as [DurableHarvestOperation],
        },
      };

      const resAlpha = store.recordHarvestIntake(alphaDelivery);
      expect(resAlpha).toMatchObject({
        ok: true,
        deduplicatedTransport: false,
        deduplicatedWork: false,
      });

      const resBeta = store.recordHarvestIntake(betaDelivery);
      expect(resBeta).toMatchObject({
        ok: true,
        deduplicatedTransport: false,
        deduplicatedWork: false,
      });

      // Transport deduplication check
      const resAlphaDup = store.recordHarvestIntake(alphaDelivery);
      expect(resAlphaDup).toMatchObject({
        ok: true,
        operations: [{ operationId: "alpha-op-42" }],
        deduplicatedTransport: true,
      });
      expect(store.recordHarvestIntake(betaDelivery)).toMatchObject({
        ok: true,
        operations: [{ operationId: "beta-op-42" }],
        deduplicatedTransport: true,
      });
    } finally {
      db.close();
    }

    const reopened = openDatabase({ dbPath });
    try {
      const store = createSqliteOperationsStoreAdapter({ db: reopened });
      const alphaHarvests = store.listRecoverableHarvests({
        nowIso: now,
        projectId: "alpha",
      });
      const betaHarvests = store.listRecoverableHarvests({
        nowIso: now,
        projectId: "beta",
      });

      expect(alphaHarvests).toHaveLength(1);
      expect(alphaHarvests[0].operationId).toBe("alpha-op-42");
      expect(alphaHarvests[0].repoSlug).toBe("example/alpha");

      expect(betaHarvests).toHaveLength(1);
      expect(betaHarvests[0].operationId).toBe("beta-op-42");
      expect(betaHarvests[0].repoSlug).toBe("example/beta");
      expect(reopened.pragma("foreign_key_check")).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it("handles outbox lifecycle, stage receipts, and legacy dispatches preservation", async () => {
    const { createSqliteOperationsStoreAdapter } = await import(
      "../adapters/sqlite/operations.js"
    );
    const { persistDispatch, readLegacyDispatches } = await import(
      "../server/persistence.js"
    );
    const projectRoot = join(root, "project-alpha");
    mkdirSync(projectRoot);

    persistDispatch(
      {
        id: "legacy-d1",
        featureId: "001-legacy",
        phaseId: "phase-01",
        backend: "codex",
        status: "completed",
        branchName: "feat/001-legacy",
        attempts: [],
        tasks: [],
        createdAt: now,
      },
      projectRoot,
    );

    const legacyEntries = readLegacyDispatches(projectRoot);
    expect(legacyEntries).toHaveLength(1);
    expect(legacyEntries[0]).toMatchObject({
      id: "legacy-d1",
      evidenceLevel: "legacy_unverified",
    });

    const db = openDatabase({ dbPath });
    try {
      registerProject({ id: "alpha", name: "Alpha", path: projectRoot }, db);
      db.prepare("UPDATE projects SET local_root = ? WHERE id = ?").run(
        projectRoot,
        "alpha",
      );

      const store = createSqliteOperationsStoreAdapter({ db });

      const outboxItem = store.enqueueOutbox({
        outboxId: "outbox-1",
        projectId: "alpha",
        dedupeKey: "key-1",
        ownerKind: "dispatch",
        ownerOperationId: "op-1",
        eventType: "dispatch_completed",
        featureId: "001-feat",
        phaseId: "phase-01",
        recipient: {
          surface: "slack",
          projectId: "alpha",
          channelId: "C123",
        },
        payload: { text: "Hello Slack" },
        clientMetadataKey: "meta-key-1",
        nowIso: now,
      });

      expect(outboxItem.status).toBe("pending");
      expect(store.getOutboxItem("outbox-1")).toMatchObject({
        outboxId: "outbox-1",
        status: "pending",
      });

      const claim = store.claimOutboxItem({
        outboxId: "outbox-1",
        nowIso: now,
        destination: { workspaceId: "W1", channelId: "C123", threadTs: null },
      });
      expect(claim).toMatchObject({
        action: "send",
        claim: { outboxId: "outbox-1", attemptNumber: 1 },
      });

      if (!claim || claim.action !== "send")
        throw new Error("Expected outbox claim");

      const completeResult = store.completeOutboxItem({
        claim: claim.claim,
        nowIso: now,
        outcome: {
          status: "delivered",
          channelId: "C123",
          messageTs: "1700000000.000100",
        },
      });
      expect(completeResult).toEqual({ ok: true });

      const status = store.getOperationsStatus("alpha");
      expect(status.historical.legacyUnverifiedDispatches).toBe(1);
      expect(status.delivery.pendingCount).toBe(0);
    } finally {
      db.close();
    }
  });
});

const project: EnrolledProject = {
  projectId: "alpha",
  slug: "alpha",
  name: "Alpha",
  repoSlug: "example/alpha",
  trunkBranch: "main",
  localRoot: "/fixture/alpha",
  mirrorPath: null,
  runnerPolicy: { allowedKinds: ["local"] },
  slack: null,
  legacyProjectIds: [],
  createdAt: now,
  updatedAt: now,
};
const phaseOne = "phase-01";
const phaseTwo = "phase-02";
const featureId = "001-fixture";
const legacyRecord = {
  id: "legacy",
  featureId,
  phaseId: phaseOne,
  backend: "codex",
  status: "completed",
  branchName: "feat/001-fixture",
  createdAt: now,
  attempts: [],
  tasks: [],
} satisfies DispatchRecord;
const expiryWithOffset = "2026-11-11T13:00:00+01:00";
const futureWithOffset = "2026-11-11T11:00:01-01:00";

function harvestIntake(
  deliveryId: string,
  phases: [string, ...string[]],
  overrides: Partial<HarvestCandidateInput> = {},
): Parameters<OperationsStorePort["recordHarvestIntake"]>[0] & {
  target: {
    accepted: true;
    operations: [DurableHarvestOperation, ...DurableHarvestOperation[]];
  };
} {
  const candidate: HarvestCandidateInput = {
    source: "github_webhook",
    deliveryId,
    repoSlug: project.repoSlug,
    headRepoSlug: project.repoSlug,
    baseBranch: project.trunkBranch,
    headBranch:
      phases.length === 1
        ? `feat/${featureId}-${phases[0]}`
        : `feat/${featureId}`,
    expectedHeadSha: "1".repeat(40),
    prNumber: 42,
    prUrl: "https://github.com/example/alpha/pull/42",
    terminalEvent: "merged",
    mergeCommitSha: "2".repeat(40),
    terminalAt: now,
    ...overrides,
  };
  function operation(phaseId: string): DurableHarvestOperation {
    const verified = verifyHarvestTarget(project, candidate);
    if (!verified.ok) throw new Error(verified.reason);
    const workKey =
      verified.kind === "local_commit"
        ? verified.workKey
        : computeHarvestWorkKey({
            ...verified.pullRequestIdentity,
            featureId,
            phaseId,
          });
    return {
      operationId: `${deliveryId}-${phaseId}`,
      projectId: project.projectId,
      workKey,
      repoSlug: verified.repoSlug,
      headRepoSlug: candidate.headRepoSlug,
      trunkBranch: project.trunkBranch,
      featureId,
      phaseId,
      prNumber: candidate.prNumber,
      prUrl: candidate.prUrl,
      headBranch: candidate.headBranch,
      expectedHeadSha: candidate.expectedHeadSha,
      terminalEvent: candidate.terminalEvent,
      mergeCommitSha: candidate.mergeCommitSha,
      terminalAt: candidate.terminalAt,
      recipient: null,
      plannedSlackRecipient: null,
      status: "accepted",
      leaseOwner: null,
      leaseEpoch: 0,
      leaseExpiresAt: null,
      linkedRunId: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
  }
  return {
    candidate,
    payloadDigest: deliveryId,
    receivedAt: now,
    target: {
      accepted: true,
      project,
      checkoutPhaseIds: phases,
      operations: [operation(phases[0]), ...phases.slice(1).map(operation)],
    },
  };
}

function localIntake() {
  return harvestIntake("local", [phaseOne], {
    source: "manual_cli",
    repoSlug: null,
    checkoutRepoSlug: project.repoSlug,
    headRepoSlug: null,
    headBranch: null,
    expectedHeadSha: null,
    prNumber: null,
    prUrl: null,
    explicitFeatureId: featureId,
    explicitPhaseId: phaseOne,
    terminalAt: "2026-11-11T11:00:00.000Z",
  });
}

describe("durable operations review regressions", () => {
  let root: string;
  let dbPath: string;
  let db: Database.Database;
  let store: OperationsStorePort;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gwrk-operations-review-"));
    dbPath = join(root, "ledger.sqlite");
    db = openDatabase({ dbPath });
    registerProject({ id: "alpha", name: "Alpha", path: root }, db);
    store = createSqliteOperationsStoreAdapter({ db });
  });

  afterEach(() => {
    if (db.open) db.close();
    rmSync(root, { recursive: true, force: true });
  });

  function accept(
    input: Parameters<OperationsStorePort["recordHarvestIntake"]>[0],
  ) {
    const result = store.recordHarvestIntake(input);
    if (!result.ok) throw new Error(result.code);
    return result.operations;
  }

  it("counts stage executions across retry leases without counting repeated writes", () => {
    const [operation] = accept(harvestIntake("stage-attempts", [phaseOne]));
    const first = store.claimHarvestLease({
      operationId: operation.operationId,
      leaseOwner: "first",
      nowIso: now,
      leaseExpiresAt: "2026-11-11T12:00:10.000Z",
    });
    if (!first) throw new Error("Missing first lease");
    const planned = planHarvestStages({
      terminalEvent: operation.terminalEvent,
      phaseIds: [phaseOne],
      hasSlackTarget: false,
      hasRemoteBranchTarget: true,
    });
    expect(
      store.initializeHarvestStages({
        fence: first.fence,
        nowIso: now,
        phaseIds: [phaseOne],
        hasSlackTarget: false,
        hasRemoteBranchTarget: true,
        stages: planned,
      }),
    ).toEqual({ ok: true });
    const stage = planned.find(({ stage }) => stage === "git_sync")!;
    const firstInput = {
      fence: first.fence,
      nowIso: now,
      phaseKey: stage.phaseKey,
      stage: stage.stage,
    };
    expect(
      store.transitionHarvestStage({ ...firstInput, status: "running" }),
    ).toEqual({ ok: true });
    expect(
      store.transitionHarvestStage({ ...firstInput, status: "running" }),
    ).toEqual({ ok: true });
    expect(
      store.transitionHarvestStage({
        ...firstInput,
        status: "retryable_failure",
      }),
    ).toEqual({ ok: true });
    const second = store.claimHarvestLease({
      operationId: operation.operationId,
      leaseOwner: "second",
      nowIso: "2026-11-11T12:00:11.000Z",
      leaseExpiresAt: "2026-11-11T12:00:30.000Z",
    });
    if (!second) throw new Error("Missing retry lease");
    const secondInput = {
      ...firstInput,
      fence: second.fence,
      nowIso: "2026-11-11T12:00:11.000Z",
    };
    expect(
      store.transitionHarvestStage({ ...secondInput, status: "running" }),
    ).toEqual({ ok: true });
    expect(
      store.transitionHarvestStage({ ...secondInput, status: "succeeded" }),
    ).toEqual({ ok: true });
    expect(
      db
        .prepare(
          "SELECT attempt_count FROM harvest_stage_receipts WHERE operation_id = ? AND stage = 'git_sync'",
        )
        .pluck()
        .get(operation.operationId),
    ).toBe(2);
  });

  it.each([
    "operation ID",
    "primary work key",
    "alias work key",
    "verified head facts",
  ])("rolls back the whole intake on conflict with %s", (conflict) => {
    const incoming = harvestIntake("incoming", [phaseOne, phaseTwo]);
    const second = incoming.target.operations[1];
    if (conflict === "verified head facts") {
      accept(localIntake());
      accept(
        harvestIntake("existing", [phaseTwo], {
          headBranch: incoming.candidate.headBranch,
          explicitPhaseId: phaseTwo,
          source: "manual_cli",
          expectedHeadSha: "3".repeat(40),
        }),
      );
    } else {
      const [existing] = accept(
        harvestIntake("existing", [phaseTwo], {
          prNumber: 43,
          prUrl: null,
        }),
      );
      if (conflict === "operation ID") {
        second.operationId = existing.operationId;
      } else if (conflict === "primary work key") {
        db.prepare(
          "UPDATE harvest_operations SET work_key = ?, repo_slug = 'other/repo' WHERE operation_id = ?",
        ).run(second.workKey, existing.operationId);
      } else {
        db.prepare(
          "INSERT INTO harvest_work_key_aliases (project_id, work_key, operation_id) VALUES (?, ?, ?)",
        ).run("alpha", second.workKey, existing.operationId);
        db.prepare(
          "UPDATE harvest_operations SET repo_slug = 'other/repo' WHERE operation_id = ?",
        ).run(existing.operationId);
      }
    }
    const snapshot = () => [
      db
        .prepare("SELECT * FROM harvest_operations ORDER BY operation_id")
        .all(),
      db
        .prepare("SELECT * FROM harvest_work_key_aliases ORDER BY work_key")
        .all(),
      db.prepare("SELECT * FROM harvest_deliveries ORDER BY delivery_id").all(),
      db
        .prepare(
          "SELECT * FROM harvest_delivery_operations ORDER BY delivery_id, position",
        )
        .all(),
    ];
    const before = snapshot();
    expect(store.recordHarvestIntake(incoming)).toEqual({
      ok: false,
      code: "HARVEST_IDENTITY_MISMATCH",
    });
    expect(snapshot()).toEqual(before);
  });

  it.each([
    { event: "merged", conflict: "proposed operation ID" },
    { event: "closed_unmerged", conflict: "proposed operation ID" },
    { event: "closed_unmerged", conflict: "work-key alias" },
  ] as const)(
    "links a $event delivery despite a conflicting $conflict",
    ({ event, conflict }) => {
      const [saved] = accept(harvestIntake("saved-merge", [phaseOne]));
      const [other] = accept(
        harvestIntake("other-merge", [phaseOne], { prNumber: 43, prUrl: null }),
      );
      const delivery = harvestIntake("matched-delivery", [phaseOne], {
        source: event === "merged" ? "github_poller" : "github_webhook",
        terminalEvent: event,
        mergeCommitSha: event === "merged" ? saved.mergeCommitSha : null,
      });
      const [incoming] = delivery.target.operations;
      if (conflict === "proposed operation ID") {
        incoming.operationId = other.operationId;
      } else {
        db.prepare(
          "INSERT INTO harvest_work_key_aliases (project_id, work_key, operation_id) VALUES (?, ?, ?)",
        ).run(project.projectId, incoming.workKey, other.operationId);
      }

      const match = { ok: true, operations: [saved], deduplicatedWork: true };
      expect(store.recordHarvestIntake(delivery)).toEqual({
        ...match,
        deduplicatedTransport: false,
      });
      expect(store.recordHarvestIntake(delivery)).toEqual({
        ...match,
        deduplicatedTransport: true,
      });
      expect(store.listRecoverableHarvests({ nowIso: now })).toHaveLength(2);
    },
  );

  it("persists the verified pull request terminal time across reopen", () => {
    const [local] = accept(localIntake());
    const [enriched] = accept(harvestIntake("enrich", [phaseOne]));
    expect(enriched).toMatchObject({
      operationId: local.operationId,
      terminalAt: now,
      prNumber: 42,
    });
    db.close();
    db = openDatabase({ dbPath });
    store = createSqliteOperationsStoreAdapter({ db });
    expect(store.listRecoverableHarvests({ nowIso: now })).toEqual([enriched]);
    expect(
      store.recordHarvestIntake(harvestIntake("alias-replay", [phaseOne])),
    ).toEqual({
      ok: true,
      operations: [enriched],
      deduplicatedTransport: false,
      deduplicatedWork: true,
    });
  });

  it("recovers expired reconciling and null-expiry dispatches by instant", () => {
    for (const [index, operationId] of [
      "a-reconciling",
      "b-no-expiry",
      "c-expired",
      "d-future",
    ].entries()) {
      store.acceptDispatch({
        projectId: "alpha",
        featureId,
        phaseId: `phase-0${index + 1}`,
        trunkBranch: "main",
        backend: "codex",
        newOperationId: operationId,
        nowIso: now,
      });
    }
    const update = db.prepare(
      "UPDATE dispatch_operations SET status = ?, lease_expires_at = ? WHERE operation_id = ?",
    );
    update.run("reconciling", expiryWithOffset, "a-reconciling");
    update.run("leased", null, "b-no-expiry");
    update.run("running", expiryWithOffset, "c-expired");
    update.run("leased", futureWithOffset, "d-future");
    expect(
      store
        .listRecoverableDispatches({ nowIso: now, projectId: "alpha" })
        .map((op) => op.operationId),
    ).toEqual(["a-reconciling", "b-no-expiry", "c-expired"]);
    for (const operationId of [
      "a-reconciling",
      "b-no-expiry",
      "c-expired",
      "d-future",
    ]) {
      const claimed = store.claimDispatchLease({
        operationId,
        nowIso: now,
        leaseOwner: "replacement",
        leaseExpiresAt: futureWithOffset,
      });
      if (operationId === "d-future") expect(claimed).toBeNull();
      else
        expect(claimed?.operation).toMatchObject({
          operationId,
          status: "leased",
        });
    }
  });

  it("orders accepted dispatches and reports queue age by instant after reopen", () => {
    expect(
      store.getOperationsStatus(project.projectId).queue.oldestQueuedAt,
    ).toBeNull();

    const oldest = "2026-11-11T13:00:00+02:00";
    for (const { operationId, phaseId, createdAt } of [
      { operationId: "later", phaseId: phaseTwo, createdAt: now },
      {
        operationId: "z-tie",
        phaseId: "phase-03",
        createdAt: "2026-11-11T11:00:00Z",
      },
      { operationId: "earlier", phaseId: phaseOne, createdAt: oldest },
    ]) {
      store.acceptDispatch({
        projectId: project.projectId,
        featureId,
        phaseId,
        trunkBranch: project.trunkBranch,
        backend: "codex",
        newOperationId: operationId,
        nowIso: createdAt,
      });
    }

    db.close();
    db = openDatabase({ dbPath });
    store = createSqliteOperationsStoreAdapter({ db });

    expect
      .soft(
        store
          .listRecoverableDispatches({
            nowIso: now,
            projectId: project.projectId,
          })
          .map(({ operationId }) => operationId),
        "recovery order",
      )
      .toEqual(["earlier", "z-tie", "later"]);
    const { oldestQueuedAt } = store.getOperationsStatus(
      project.projectId,
    ).queue;
    expect.soft(oldestQueuedAt, "oldest queue timestamp").toBe(oldest);
  });

  it("finds the newest phase dispatch by instant across task scopes and statuses", () => {
    const scope = {
      projectId: project.projectId,
      featureId,
      phaseId: phaseOne,
    };
    const outsideScope = "2026-11-11T14:00:00+01:00";
    registerProject({ id: "beta", name: "Beta", path: join(root, "beta") }, db);
    const rename = db.prepare(
      "UPDATE dispatch_operations SET operation_id = ? WHERE operation_id = ?",
    );
    for (const { operationId, createdAt, ...request } of [
      {
        operationId: "older",
        createdAt: "2026-11-11T13:00:00+02:00",
        taskIds: ["T001"],
      },
      { operationId: "a-newer", createdAt: now, taskIds: ["T002"] },
      { operationId: "z-newer", createdAt: "2026-11-11T11:00:00-01:00" },
      {
        operationId: "other-project",
        createdAt: outsideScope,
        projectId: "beta",
      },
      {
        operationId: "other-feature",
        createdAt: outsideScope,
        featureId: "002-fixture",
      },
      {
        operationId: "other-phase",
        createdAt: outsideScope,
        phaseId: phaseTwo,
      },
    ]) {
      const receipt = store.acceptDispatch({
        ...scope,
        ...request,
        trunkBranch: project.trunkBranch,
        backend: "codex",
        newOperationId: operationId,
        nowIso: createdAt,
      });
      rename.run(operationId, receipt.operationId);
    }
    const claim = store.claimDispatchLease({
      operationId: "z-newer",
      leaseOwner: "worker",
      nowIso: now,
      leaseExpiresAt: futureWithOffset,
    });
    if (!claim) throw new Error("Missing dispatch lease");
    expect(
      store.completeDispatchAttempt({
        fence: claim.fence,
        nowIso: now,
        operationStatus: "completed",
        attemptStatus: "completed",
      }),
    ).toEqual({ ok: true });

    expect(store.getDispatchOperation(scope)).toMatchObject({
      operationId: "z-newer",
      status: "completed",
      taskIds: [],
    });
  });

  it("recovers harvests by creation instant and keeps the local intake link on replay", () => {
    for (const [deliveryId, prNumber, createdAt] of [
      ["z-equal", 44, "2026-11-11T11:00:00Z"],
      ["later", 43, now],
      ["a-earliest", 42, "2026-11-11T13:00:00+02:00"],
    ] as const) {
      const input = harvestIntake(deliveryId, [phaseOne], {
        prNumber,
        prUrl: null,
      });
      input.target.operations[0].createdAt = createdAt;
      accept(input);
    }

    expect
      .soft(
        store
          .listRecoverableHarvests({
            nowIso: now,
            projectId: project.projectId,
          })
          .map(({ operationId }) => operationId),
        "harvest recovery order",
      )
      .toEqual(["a-earliest-phase-01", "z-equal-phase-01", "later-phase-01"]);

    const input = localIntake();
    const linked = { operationId: "a-earliest-phase-01", prNumber: 42 };
    expect
      .soft(store.recordHarvestIntake(input), "local intake link")
      .toMatchObject({
        ok: true,
        operations: [linked],
        deduplicatedTransport: false,
        deduplicatedWork: true,
      });

    db.prepare(
      "UPDATE harvest_operations SET created_at = ? WHERE operation_id = ?",
    ).run("2026-11-11T10:00:00Z", "later-phase-01");
    expect
      .soft(store.recordHarvestIntake(input), "persisted delivery link")
      .toMatchObject({
        ok: true,
        operations: [linked],
        deduplicatedTransport: true,
        deduplicatedWork: true,
      });
  });

  it("reports the completion timestamp and merge SHA from the latest harvest instant", () => {
    const latest = "2026-11-11T11:30:00-01:00";
    const latestSha = "c".repeat(40);
    const complete = db.prepare(
      "UPDATE harvest_operations SET status = 'completed', completed_at = ? WHERE operation_id = ?",
    );
    for (const [deliveryId, completedAt, mergeCommitSha] of [
      ["older", now, "a".repeat(40)],
      ["a-newer", "2026-11-11T11:45:00-00:45", "b".repeat(40)],
      ["z-newer", latest, latestSha],
    ]) {
      const [operation] = accept(
        harvestIntake(deliveryId, [phaseTwo], { mergeCommitSha }),
      );
      complete.run(completedAt, operation.operationId);
    }

    expect(store.getOperationsStatus(project.projectId).harvest).toMatchObject({
      lastCompletedAt: latest,
      lastMergeCommitSha: latestSha,
    });
  });

  it("recovers harvest leases by instant with offset timestamps", () => {
    const [first, second] = accept(
      harvestIntake("offset", [phaseOne, phaseTwo]),
    );
    const update = db.prepare(
      "UPDATE harvest_operations SET status = 'running', lease_expires_at = ? WHERE operation_id = ?",
    );
    update.run(expiryWithOffset, first.operationId);
    update.run(futureWithOffset, second.operationId);
    expect(
      store
        .listRecoverableHarvests({ nowIso: now })
        .map((op) => op.operationId),
    ).toEqual([first.operationId]);
    const lease = {
      nowIso: now,
      leaseOwner: "worker",
      leaseExpiresAt: futureWithOffset,
    };
    expect(
      store.claimHarvestLease({ ...lease, operationId: first.operationId })
        ?.operation.operationId,
    ).toBe(first.operationId);
    expect(
      store.claimHarvestLease({ ...lease, operationId: second.operationId }),
    ).toBeNull();
  });

  it.each(["retired", "different workspace", "different channel", "matching"])(
    "resolves harvest Slack targets with a %s binding or thread",
    (scenario) => {
      db.prepare(
        "UPDATE projects SET slack_workspace_id = 'W1', slack_channel = 'C1', updated_at = ? WHERE id = 'alpha'",
      ).run(scenario === "retired" ? null : now);
      db.prepare(
        "INSERT INTO slack_feature_threads (project_id, feature_id, workspace_id, channel_id, root_ts) VALUES ('alpha', ?, ?, ?, '1700000000.000100')",
      ).run(
        featureId,
        scenario === "different workspace" ? "W2" : "W1",
        scenario === "different channel" ? "C2" : "C1",
      );
      const [op] = accept(
        harvestIntake("slack", [phaseOne], {
          recipient: { projectId: "alpha", surface: "slack" },
        }),
      );
      const claim = store.claimHarvestLease({
        operationId: op.operationId,
        leaseOwner: "worker",
        nowIso: now,
        leaseExpiresAt: futureWithOffset,
      });
      if (!claim) throw new Error("Missing harvest lease");
      const stages = {
        terminalEvent: op.terminalEvent,
        phaseIds: [phaseOne],
        hasSlackTarget: scenario !== "retired",
        hasRemoteBranchTarget: true,
      };
      expect(
        store.initializeHarvestStages({
          fence: claim.fence,
          nowIso: now,
          phaseIds: stages.phaseIds,
          hasSlackTarget: stages.hasSlackTarget,
          hasRemoteBranchTarget: stages.hasRemoteBranchTarget,
          stages: planHarvestStages(stages),
        }),
      ).toEqual({ ok: true });
      const [planned] = store.listRecoverableHarvests({
        nowIso: futureWithOffset,
      });
      expect(planned.plannedSlackRecipient).toEqual(
        scenario === "retired"
          ? null
          : {
              projectId: "alpha",
              surface: "slack",
              workspaceId: "W1",
              channelId: "C1",
              ...(scenario === "matching"
                ? { threadTs: "1700000000.000100" }
                : {}),
            },
      );
    },
  );

  function enqueueNotice() {
    return store.enqueueOutbox({
      outboxId: "notice",
      projectId: "alpha",
      dedupeKey: "notice",
      ownerKind: "dispatch",
      ownerOperationId: "op",
      eventType: "dispatch_completed",
      featureId,
      phaseId: phaseOne,
      recipient: { surface: "slack", projectId: "alpha" },
      payload: { text: "Notice" },
      clientMetadataKey: "notice",
      nowIso: now,
    });
  }

  it("recovers outbox items by timestamp instant and stable ID inside one project", () => {
    const notice = enqueueNotice();
    for (const [outboxId, createdAt] of [
      ["offset", "2026-11-11T13:00:00+02:00"],
      ["a-first", "2026-11-11T11:00:00Z"],
    ]) {
      store.enqueueOutbox({
        ...notice,
        outboxId,
        dedupeKey: outboxId,
        clientMetadataKey: outboxId,
        nowIso: createdAt,
      });
    }
    registerProject({ id: "beta", name: "Beta", path: "/fixture/beta" }, db);
    store.enqueueOutbox({
      ...notice,
      outboxId: "foreign",
      projectId: "beta",
      dedupeKey: "foreign",
      clientMetadataKey: "foreign",
      recipient: { surface: "slack", projectId: "beta" },
      nowIso: "2026-11-11T10:00:00Z",
    });
    expect(
      store
        .listRecoverableOutboxItems({ projectId: "alpha", nowIso: now })
        .map(({ outboxId }) => outboxId),
    ).toEqual(["a-first", "offset", "notice"]);
  });

  function seedGateFailureOwner(threadTs?: string) {
    const [op] = accept(harvestIntake("gate-owner", [phaseOne]));
    const recipient = {
      surface: "slack",
      projectId: "alpha",
      workspaceId: "W-alpha",
      channelId: "C-alpha",
      ...(threadTs ? { threadTs } : {}),
    };
    db.prepare(
      "UPDATE harvest_operations SET planned_slack_recipient_json = ?, status = 'gate_failed' WHERE operation_id = ?",
    ).run(JSON.stringify(recipient), op.operationId);
    db.prepare(`INSERT INTO harvest_stage_receipts
      (operation_id, phase_key, stage, status, lease_epoch, attempt_count, updated_at, completed_at)
      VALUES (?, ?, 'gate_verify', 'gate_failed', 0, 1, ?, ?)`).run(
      op.operationId,
      phaseOne,
      now,
      now,
    );
    return op.operationId;
  }

  it.each(["missing receipt", "planned route changed", "foreign feature"])(
    "rejects a gate notice with %s after database reopen without mutation",
    (scenario) => {
      const ownerOperationId = seedGateFailureOwner();
      const item = store.enqueueOutbox({
        outboxId: "invalid-gate",
        projectId: "alpha",
        dedupeKey: JSON.stringify([
          "harvest_gate_failed",
          ownerOperationId,
          phaseOne,
        ]),
        ownerKind: "harvest",
        ownerOperationId,
        eventType: "harvest_gate_failed",
        featureId,
        phaseId: phaseOne,
        recipient: {
          surface: "slack",
          projectId: "alpha",
          workspaceId: "W-alpha",
          channelId: "C-alpha",
        },
        payload: { text: "Gate failed" },
        clientMetadataKey: "invalid-gate",
        nowIso: now,
      });
      if (scenario === "missing receipt") {
        db.prepare(
          "DELETE FROM harvest_stage_receipts WHERE operation_id = ?",
        ).run(ownerOperationId);
      } else if (scenario === "planned route changed") {
        db.prepare(
          "UPDATE harvest_operations SET planned_slack_recipient_json = ? WHERE operation_id = ?",
        ).run(
          JSON.stringify({ ...item.recipient, channelId: "C-other" }),
          ownerOperationId,
        );
      } else {
        db.prepare(
          "UPDATE notification_outbox SET feature_id = '002-foreign' WHERE outbox_id = ?",
        ).run(item.outboxId);
      }
      db.close();
      db = openDatabase({ dbPath });
      store = createSqliteOperationsStoreAdapter({ db });
      const before = store.getOutboxItem(item.outboxId);
      expect
        .soft(
          store.claimOutboxItem({
            outboxId: item.outboxId,
            nowIso: now,
            destination: null,
          }),
        )
        .toBeNull();
      expect(store.getOutboxItem(item.outboxId)).toEqual(before);
    },
  );

  it.each([
    { status: "pending", recipientProject: "alpha", boundProject: null },
    { status: "pending", recipientProject: "beta", boundProject: null },
    { status: "pending", recipientProject: "alpha", boundProject: "beta" },
    {
      status: "pending",
      recipientProject: "alpha",
      boundProject: "alpha",
      recipientThreadTs: "1700000000.000100",
      boundThreadTs: "1700000000.000200",
    },
    {
      status: "pending",
      recipientProject: "alpha",
      boundProject: "alpha",
      recipientThreadTs: "1700000000.000100",
      boundThreadTs: "1700000000.000100",
    },
    {
      status: "pending",
      recipientProject: "alpha",
      boundProject: "alpha",
      partialRoute: true,
    },
    {
      status: "sending",
      recipientProject: "alpha",
      boundProject: "alpha",
      recipientThreadTs: "1700000000.000100",
      boundThreadTs: "1700000000.000100",
    },
    { status: "sending", recipientProject: "beta", boundProject: "beta" },
    { status: "uncertain", recipientProject: "alpha", boundProject: "alpha" },
    { status: "uncertain", recipientProject: "beta", boundProject: "beta" },
    { status: "uncertain", recipientProject: "alpha", boundProject: "beta" },
    {
      status: "uncertain",
      recipientProject: "alpha",
      boundProject: "alpha",
      boundThreadTs: "1700000000.000100",
    },
  ])(
    "scopes $status gate failure notices to the saved recipient after restart ($recipientProject, $boundProject, $boundThreadTs)",
    ({
      status,
      recipientProject,
      boundProject,
      recipientThreadTs,
      boundThreadTs = null,
      partialRoute = false,
    }) => {
      const ownerOperationId = seedGateFailureOwner(recipientThreadTs);
      const notice = store.enqueueOutbox({
        outboxId: "gate-failure",
        projectId: "alpha",
        dedupeKey: JSON.stringify([
          "harvest_gate_failed",
          ownerOperationId,
          phaseOne,
        ]),
        ownerKind: "harvest",
        ownerOperationId,
        eventType: "harvest_gate_failed",
        featureId,
        phaseId: phaseOne,
        recipient: {
          surface: "slack",
          projectId: "alpha",
          workspaceId: "W-alpha",
          channelId: "C-alpha",
        },
        payload: { text: "Gate failed" },
        clientMetadataKey: "gate-failure",
        nowIso: now,
      });
      db.prepare(
        `UPDATE notification_outbox
         SET recipient_json = ?, status = ?, workspace_id = ?, channel_id = ?, thread_ts = ?, attempt_count = ?
         WHERE outbox_id = ?`,
      ).run(
        JSON.stringify({
          surface: "slack",
          projectId: recipientProject,
          workspaceId: `W-${recipientProject}`,
          channelId: `C-${recipientProject}`,
          threadTs: recipientThreadTs,
        }),
        status,
        boundProject === null ? null : `W-${boundProject}`,
        boundProject === null || partialRoute ? null : `C-${boundProject}`,
        boundThreadTs,
        status === "pending" ? 0 : 1,
        notice.outboxId,
      );
      db.close();
      db = openDatabase({ dbPath });
      store = createSqliteOperationsStoreAdapter({ db });
      const row = db.prepare(
        "SELECT * FROM notification_outbox WHERE outbox_id = ?",
      );
      const before = row.get(notice.outboxId);
      const claimed = store.claimOutboxItem({
        outboxId: notice.outboxId,
        nowIso: "2026-11-11T12:01:00.000Z",
        destination:
          status === "pending"
            ? null
            : { workspaceId: "W-other", channelId: "C-other", threadTs: null },
      });
      if (
        recipientProject !== "alpha" ||
        boundProject === "beta" ||
        partialRoute ||
        boundThreadTs !== (recipientThreadTs ?? null)
      ) {
        expect.soft(claimed).toBeNull();
        expect(row.get(notice.outboxId)).toEqual(before);
      } else {
        const claimedItem = {
          workspaceId: "W-alpha",
          channelId: "C-alpha",
          threadTs: boundThreadTs,
          clientMetadataKey: notice.clientMetadataKey,
          attemptCount: status === "pending" ? 1 : 2,
        };
        expect(claimed).toMatchObject({
          action: status === "pending" ? "send" : "reconcile",
          claim: { clientMetadataKey: notice.clientMetadataKey },
          item: claimedItem,
        });
        expect(store.getOutboxItem(notice.outboxId)).toMatchObject({
          ...claimedItem,
          status: "sending",
        });
      }
    },
  );

  it.each(["pending", "uncertain", "sending"])(
    "rejects duplicate gate failure notices with status %s after restart",
    (status) => {
      const route = {
        workspaceId: "W-alpha",
        channelId: "C-alpha",
        threadTs: "1700000000.000100",
      };
      db.prepare(
        "UPDATE projects SET slack_workspace_id = ?, slack_channel = ?, updated_at = ? WHERE id = 'alpha'",
      ).run(route.workspaceId, route.channelId, now);
      db.prepare(
        "INSERT INTO slack_feature_threads (project_id, feature_id, workspace_id, channel_id, root_ts) VALUES ('alpha', ?, ?, ?, ?)",
      ).run(featureId, route.workspaceId, route.channelId, route.threadTs);

      const [owner] = accept(
        harvestIntake("gate-dedupe", [phaseOne], {
          recipient: { projectId: "alpha", surface: "slack" },
        }),
      );
      const lease = store.claimHarvestLease({
        operationId: owner.operationId,
        leaseOwner: "worker",
        nowIso: now,
        leaseExpiresAt: futureWithOffset,
      });
      if (!lease) throw new Error("Missing harvest lease");
      const plan = {
        terminalEvent: owner.terminalEvent,
        phaseIds: [phaseOne],
        hasSlackTarget: true,
        hasRemoteBranchTarget: true,
      };
      expect(
        store.initializeHarvestStages({
          ...plan,
          fence: lease.fence,
          nowIso: now,
          stages: planHarvestStages(plan),
        }),
      ).toEqual({ ok: true });
      const notice = {
        outboxId: "committed-gate-notice",
        projectId: owner.projectId,
        dedupeKey: JSON.stringify([
          "harvest_gate_failed",
          owner.operationId,
          phaseOne,
        ]),
        ownerKind: "harvest",
        ownerOperationId: owner.operationId,
        eventType: "harvest_gate_failed",
        featureId,
        phaseId: phaseOne,
        recipient: { ...route, surface: "slack", projectId: owner.projectId },
        payload: { text: "Gate failed" },
        clientMetadataKey: "committed-gate-metadata",
      } as const;
      expect(
        store.transitionHarvestStage({
          fence: lease.fence,
          nowIso: now,
          phaseKey: phaseOne,
          stage: "gate_verify",
          status: "gate_failed",
          failureNotice: notice,
        }),
      ).toEqual({ ok: true });
      const duplicate = store.enqueueOutbox({
        ...notice,
        outboxId: "duplicate-gate-notice",
        dedupeKey: "duplicate-gate-key",
        clientMetadataKey: "duplicate-gate-metadata",
        nowIso: now,
      });
      if (status !== "pending") {
        db.prepare(
          `UPDATE notification_outbox
           SET status = ?, workspace_id = ?, channel_id = ?, thread_ts = ?, attempt_count = 1
           WHERE outbox_id = ?`,
        ).run(
          status,
          route.workspaceId,
          route.channelId,
          route.threadTs,
          duplicate.outboxId,
        );
      }

      db.close();
      db = openDatabase({ dbPath });
      store = createSqliteOperationsStoreAdapter({ db });
      const canonicalClaim = { outboxId: notice.outboxId, destination: null };
      const savedIdentity = {
        claim: { clientMetadataKey: notice.clientMetadataKey },
        item: {
          ...route,
          dedupeKey: notice.dedupeKey,
          clientMetadataKey: notice.clientMetadataKey,
        },
      };
      expect(
        store.claimOutboxItem({ ...canonicalClaim, nowIso: now }),
      ).toMatchObject({
        ...savedIdentity,
        action: "send",
      });

      const reconcileAt = "2026-11-11T12:01:00.000Z";
      const row = db.prepare(
        "SELECT * FROM notification_outbox WHERE outbox_id = ?",
      );
      const before = row.get(duplicate.outboxId);
      expect(before).toMatchObject({ status });
      expect
        .soft(
          store.claimOutboxItem({
            outboxId: duplicate.outboxId,
            nowIso: reconcileAt,
            destination: null,
          }),
        )
        .toBeNull();
      expect.soft(row.get(duplicate.outboxId)).toEqual(before);
      expect(
        store.claimOutboxItem({ ...canonicalClaim, nowIso: reconcileAt }),
      ).toMatchObject({ ...savedIdentity, action: "reconcile" });
    },
  );

  it.each(
    (["dispatch", "harvest"] as const).flatMap((kind) =>
      ["earlier", "equal"].map((expiry) => ({ kind, expiry })),
    ),
  )(
    "preserves a renewed $kind lease when a delayed heartbeat has an $expiry expiry",
    ({ kind, expiry }) => {
      const operationId =
        kind === "dispatch"
          ? store.acceptDispatch({
              projectId: "alpha",
              featureId,
              phaseId: phaseOne,
              trunkBranch: "main",
              backend: "codex",
              newOperationId: "dispatch-heartbeat",
              nowIso: now,
            }).operationId
          : accept(harvestIntake("harvest-heartbeat", [phaseOne]))[0]
              .operationId;
      const claim = (
        request: Parameters<OperationsStorePort["claimDispatchLease"]>[0],
      ) =>
        kind === "dispatch"
          ? store.claimDispatchLease(request)
          : store.claimHarvestLease(request);
      const renew = (
        request: Parameters<OperationsStorePort["heartbeatDispatchLease"]>[0],
      ) =>
        kind === "dispatch"
          ? store.heartbeatDispatchLease(request)
          : store.heartbeatHarvestLease(request);
      const first = claim({
        operationId,
        leaseOwner: "worker",
        nowIso: now,
        leaseExpiresAt: "2026-11-11T12:01:00.000Z",
      });
      if (!first) throw new Error("Missing worker lease");
      const renewedExpiry = "2026-11-11T12:04:00.000Z";
      const renewedAt = "2026-11-11T12:00:30.000Z";
      expect(
        renew({
          fence: first.fence,
          nowIso: renewedAt,
          leaseExpiresAt: renewedExpiry,
        }),
      ).toEqual({ ok: true });
      expect(
        renew({
          fence: first.fence,
          nowIso: "2026-11-11T12:00:20.000Z",
          leaseExpiresAt:
            expiry === "equal"
              ? "2026-11-11T13:04:00.000+01:00"
              : "2026-11-11T13:02:00.000+01:00",
        }),
      ).toEqual({ ok: true });

      db.close();
      db = openDatabase({ dbPath });
      store = createSqliteOperationsStoreAdapter({ db });
      const savedLease = db
        .prepare(
          kind === "dispatch"
            ? "SELECT lease_expires_at, updated_at, heartbeat_at FROM dispatch_operations WHERE operation_id = ?"
            : "SELECT lease_expires_at, updated_at FROM harvest_operations WHERE operation_id = ?",
        )
        .get(operationId);
      expect.soft(savedLease).toEqual({
        lease_expires_at: renewedExpiry,
        updated_at: renewedAt,
        ...(kind === "dispatch" ? { heartbeat_at: renewedAt } : {}),
      });
      const replacement = {
        operationId,
        leaseOwner: "replacement",
        leaseExpiresAt: "2026-11-11T12:06:00.000Z",
      };
      expect(
        claim({ ...replacement, nowIso: "2026-11-11T12:02:00.000Z" }),
      ).toBeNull();
      expect(claim({ ...replacement, nowIso: renewedExpiry })?.fence).toEqual({
        operationId,
        leaseOwner: replacement.leaseOwner,
        leaseEpoch: first.fence.leaseEpoch + 1,
      });
    },
  );

  const destination = { workspaceId: "W1", channelId: "C1", threadTs: null };

  it.each([
    {
      status: "uncertain",
      scenario: "recipient project conflict",
      recipientOverride: { projectId: "beta" },
    },
    {
      status: "sending",
      scenario: "recipient workspace conflict",
      recipientOverride: { workspaceId: "W2" },
    },
    {
      status: "uncertain",
      scenario: "recipient channel conflict",
      recipientOverride: { channelId: "C2" },
    },
    {
      status: "sending",
      scenario: "recipient thread conflict",
      recipientOverride: { threadTs: "1700000000.000200" },
    },
    {
      status: "uncertain",
      scenario: "matching recipient and conflicting proposed destination",
      proposedDestination: {
        workspaceId: "W-other",
        channelId: "C-other",
        threadTs: null,
      },
    },
    {
      status: "sending",
      scenario: "matching recipient and no proposed destination",
      proposedDestination: null,
    },
  ])(
    "reconciles $status dispatch completion notices after restart ($scenario)",
    ({ status, recipientOverride, proposedDestination = null }) => {
      const notice = enqueueNotice();
      const route = { ...destination, threadTs: "1700000000.000100" };
      const clientMetadataKey = "dispatch-notice-metadata";
      const recipient = { ...notice.recipient, ...route, ...recipientOverride };
      db.prepare(
        `UPDATE notification_outbox
         SET recipient_json = ?, status = ?, workspace_id = ?, channel_id = ?, thread_ts = ?, client_metadata_key = ?, attempt_count = 1
         WHERE outbox_id = ?`,
      ).run(
        JSON.stringify(recipient),
        status,
        route.workspaceId,
        route.channelId,
        route.threadTs,
        clientMetadataKey,
        notice.outboxId,
      );
      db.close();
      db = openDatabase({ dbPath });
      store = createSqliteOperationsStoreAdapter({ db });

      const savedRow = db.prepare(
        "SELECT * FROM notification_outbox WHERE outbox_id = ?",
      );
      const before = savedRow.get(notice.outboxId);
      const recoverableNotice = store.getOutboxItem(notice.outboxId);
      const nowIso = "2026-11-11T12:01:00.000Z";
      const claimed = store.claimOutboxItem({
        outboxId: notice.outboxId,
        nowIso,
        destination: proposedDestination,
      });

      if (recipientOverride) {
        expect.soft(claimed).toBeNull();
        expect.soft(savedRow.get(notice.outboxId)).toEqual(before);
        expect(
          store.listRecoverableOutboxItems({
            projectId: notice.projectId,
            nowIso,
          }),
        ).toEqual([recoverableNotice]);
      } else {
        const claimedItem = {
          ...route,
          clientMetadataKey,
          status: "sending",
          attemptCount: 2,
        };
        expect(claimed).toMatchObject({
          action: "reconcile",
          claim: {
            outboxId: notice.outboxId,
            attemptNumber: 2,
            clientMetadataKey,
          },
          item: claimedItem,
        });
        expect(store.getOutboxItem(notice.outboxId)).toMatchObject(claimedItem);
      }
    },
  );

  it.each([
    { route: "send", destination, status: "delivered", attemptCount: 0 },
    { route: "send", destination, status: "pending", attemptCount: 2 },
    { route: "skip", destination: null, status: "delivered", attemptCount: 0 },
    { route: "skip", destination: null, status: "pending", attemptCount: 2 },
  ])(
    "rejects a stale $route claim when the row is $status at attempt $attemptCount",
    ({ destination, status, attemptCount }) => {
      const stale = enqueueNotice();
      db.prepare(
        "UPDATE notification_outbox SET status = ?, attempt_count = ? WHERE outbox_id = ?",
      ).run(status, attemptCount, stale.outboxId);
      const recoverable = vi
        .spyOn(store, "listRecoverableOutboxItems")
        .mockReturnValue([stale]);
      try {
        expect(
          store.claimOutboxItem({
            outboxId: stale.outboxId,
            nowIso: now,
            destination,
          }),
        ).toBeNull();
        expect(store.getOutboxItem(stale.outboxId)).toMatchObject({
          status,
          attemptCount,
        });
      } finally {
        recoverable.mockRestore();
      }
    },
  );

  it("reports pending stages by receipt phase and counts sending deliveries", () => {
    const [first, second] = accept(
      harvestIntake("status", [phaseOne, phaseTwo]),
    );
    db.prepare(
      "UPDATE harvest_operations SET phase_id = NULL WHERE operation_id = ?",
    ).run(first.operationId);
    db.prepare(
      "UPDATE harvest_operations SET status = 'gate_failed' WHERE operation_id = ?",
    ).run(second.operationId);
    const stage = db.prepare(
      "INSERT INTO harvest_stage_receipts (operation_id, phase_key, stage, status, updated_at) VALUES (?, ?, ?, 'pending', ?)",
    );
    stage.run(first.operationId, phaseOne, "gate_verify", now);
    stage.run(first.operationId, "feature", "learning_record", now);
    stage.run(second.operationId, phaseTwo, "branch_cleanup", now);
    const item = enqueueNotice();
    expect(
      store.claimOutboxItem({
        outboxId: item.outboxId,
        nowIso: now,
        destination,
      })?.action,
    ).toBe("send");
    const status = store.getOperationsStatus("alpha");
    expect(status.harvest.pendingStages).toHaveLength(2);
    expect(status.harvest.pendingStages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: first.operationId,
          phaseId: phaseOne,
          stage: "gate_verify",
        }),
        expect.objectContaining({
          operationId: first.operationId,
          phaseId: null,
          stage: "learning_record",
        }),
      ]),
    );
    expect(status.delivery.pendingCount).toBe(1);
  });

  it("counts historical runs across aliases and uses the canonical local root", () => {
    const checkout = join(root, "checkout");
    const aliasDir = join(root, "alias");
    registerProject({ id: "old-alpha", name: "Old Alpha", path: aliasDir }, db);
    const run = (projectId: string) =>
      startRun(
        {
          project_id: projectId,
          feature_id: featureId,
          phase_id: phaseOne,
          command: "ship",
          agent_backend: "codex",
          workflow: "ship-done",
        },
        db,
      );
    run("alpha");
    run("old-alpha");
    run("old-alpha");
    const linked = run("old-alpha");
    db.prepare(
      "INSERT INTO project_aliases (alias_id, project_id) VALUES ('old-alpha', 'alpha')",
    ).run();
    db.prepare(
      "UPDATE projects SET local_root = ?, updated_at = ? WHERE id = 'alpha'",
    ).run(checkout, now);
    const [op] = accept(harvestIntake("linked", [phaseOne]));
    db.prepare(
      "UPDATE harvest_operations SET linked_run_id = ? WHERE operation_id = ?",
    ).run(linked, op.operationId);
    persistDispatch(legacyRecord, checkout);
    persistDispatch(legacyRecord, root);
    persistDispatch(legacyRecord, root);
    for (const id of ["old-alpha", "alpha"]) {
      expect(store.getOperationsStatus(id).historical).toEqual({
        legacyUnverifiedRuns: 3,
        legacyUnverifiedDispatches: 1,
      });
    }
    db.prepare(
      "UPDATE projects SET local_root = NULL, mirror_path = ? WHERE id = 'alpha'",
    ).run(checkout);
    expect(
      store.getOperationsStatus("old-alpha").historical
        .legacyUnverifiedDispatches,
    ).toBe(0);
    expect(existsSync(join(aliasDir, ".gwrk"))).toBe(false);
  });

  it("preserves the latest cursor when an older poll saves on another connection", () => {
    const older = {
      projectId: project.projectId,
      lastPolledAt: "2026-11-11T12:50:00+01:00",
      lastTerminalAt: "2026-11-11T12:40:00+01:00",
      lastPrNumber: 41,
      lastError: "older poll failed",
    };
    const newer = {
      projectId: project.projectId,
      lastPolledAt: now,
      lastTerminalAt: "2026-11-11T11:50:00Z",
      lastPrNumber: 45,
      lastError: null,
    };
    const secondDb = openDatabase({ dbPath });
    try {
      const secondStore = createOperationsStore(secondDb);
      store.saveHarvestCursor(newer);
      secondStore.saveHarvestCursor(older);
      expect(store.getHarvestCursor(project.projectId)).toEqual(newer);
    } finally {
      secondDb.close();
    }
  });

  it("advances the terminal and poll cursor fields independently", () => {
    const initial = {
      projectId: project.projectId,
      lastPolledAt: now,
      lastTerminalAt: null,
      lastPrNumber: null,
      lastError: null,
    };
    store.saveHarvestCursor(initial);
    expect(store.getHarvestCursor(project.projectId)).toEqual(initial);

    const watermark = {
      lastTerminalAt: "2026-11-11T11:50:00Z",
      lastPrNumber: 45,
    };
    store.saveHarvestCursor({ ...initial, ...watermark });
    expect(store.getHarvestCursor(project.projectId)).toEqual({
      ...initial,
      ...watermark,
    });

    const nextPoll = {
      ...initial,
      lastPolledAt: "2026-11-11T11:10:00-01:00",
      lastError: "poll failed",
    };
    store.saveHarvestCursor(nextPoll);
    expect(store.getHarvestCursor(project.projectId)).toEqual({
      ...nextPoll,
      ...watermark,
    });

    const nextWatermark = {
      lastTerminalAt: "2026-11-11T11:00:00-01:00",
      lastPrNumber: 46,
    };
    store.saveHarvestCursor({ ...initial, ...nextWatermark });
    expect(store.getHarvestCursor(project.projectId)).toEqual({
      ...nextPoll,
      ...nextWatermark,
    });

    store.saveHarvestCursor({
      ...initial,
      lastPolledAt: "2026-11-11T12:10:00Z",
      lastTerminalAt: now,
      lastPrNumber: 47,
    });
    expect(store.getHarvestCursor(project.projectId)).toEqual({
      ...nextPoll,
      ...nextWatermark,
    });
  });

  it("reads historical dispatch formats and leaves missing .gwrk directories untouched", () => {
    const storeWithoutReader = createOperationsStore(db);
    const directory = join(root, ".gwrk");
    expect(readLegacyDispatches(root)).toEqual([]);
    expect(
      storeWithoutReader.getOperationsStatus("alpha").historical
        .legacyUnverifiedDispatches,
    ).toBe(0);
    expect(existsSync(directory)).toBe(false);
    const { attempts: _attempts, ...withoutAttempts } = legacyRecord;
    const { tasks: _tasks, ...withoutTasks } = legacyRecord;
    const historicalRecord = {
      ...withoutTasks,
      id: "historical",
      taskId: "T001",
    };
    const { createdAt: _createdAt, ...phaseWideRecord } = withoutTasks;
    const timestampedPhaseWideRecord = {
      id: "timestamped-phase-wide",
      featureId,
      phaseId: phaseOne,
      backend: legacyRecord.backend,
      status: "queued",
      branchName: `phase/${featureId}-${phaseOne}`,
      attempts: [],
      createdAt: now,
    };
    mkdirSync(directory);
    writeFileSync(
      join(directory, "dispatches.jsonl"),
      [
        "{bad json",
        "",
        ...[
          null,
          42,
          true,
          "text",
          [legacyRecord],
          {},
          { ...legacyRecord, status: "unknown" },
          { ...legacyRecord, backend: " " },
          withoutAttempts,
          { ...withoutTasks, createdAt: " " },
          { ...withoutTasks, createdAt: null },
          { ...withoutTasks, taskId: " " },
          { ...withoutTasks, tasks: "T001" },
          historicalRecord,
          legacyRecord,
          phaseWideRecord,
          timestampedPhaseWideRecord,
        ].map((value) => JSON.stringify(value)),
      ].join("\n"),
    );
    expect.soft(readLegacyDispatches(root)).toStrictEqual([
      { ...historicalRecord, evidenceLevel: "legacy_unverified" },
      { ...legacyRecord, evidenceLevel: "legacy_unverified" },
      { ...phaseWideRecord, evidenceLevel: "legacy_unverified" },
      { ...timestampedPhaseWideRecord, evidenceLevel: "legacy_unverified" },
    ]);
    expect
      .soft(
        store.getOperationsStatus("alpha").historical
          .legacyUnverifiedDispatches,
        "injected reader count",
      )
      .toBe(4);
    expect
      .soft(
        storeWithoutReader.getOperationsStatus("alpha").historical
          .legacyUnverifiedDispatches,
        "fallback reader count",
      )
      .toBe(4);
  });
});
