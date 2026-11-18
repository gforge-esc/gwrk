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
import { computeHarvestWorkKey } from "../domain/durable-harvest.js";
import { openDatabase } from "./index.js";
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

  it("preserves the existing execution ledger when migration 018 runs", () => {
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
        "017-plan-parent-provenance.sql",
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

  it("TR-002: keeps separate transport deliveries across two repos with matching PR numbers isolated", async () => {
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
          ] as [any, ...any[]],
        },
      };

      const betaDelivery = {
        candidate: {
          source: "github_webhook" as const,
          deliveryId: "del-beta-42",
          repoSlug: "example/beta",
          headRepoSlug: "example/beta",
          baseBranch: "main",
          headBranch: "feat/002-feat-phase-01",
          expectedHeadSha: "3".repeat(40),
          prNumber: 42,
          prUrl: "https://github.com/example/beta/pull/42",
          terminalEvent: "merged" as const,
          mergeCommitSha: "4".repeat(40),
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
                mergeCommitSha: "4".repeat(40),
                featureId: "002-feat",
                phaseId: "phase-01",
              }),
              repoSlug: "example/beta",
              headRepoSlug: "example/beta",
              trunkBranch: "main",
              featureId: "002-feat",
              phaseId: "phase-01",
              prNumber: 42,
              prUrl: "https://github.com/example/beta/pull/42",
              headBranch: "feat/002-feat-phase-01",
              expectedHeadSha: "3".repeat(40),
              terminalEvent: "merged" as const,
              mergeCommitSha: "4".repeat(40),
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
          ] as [any, ...any[]],
        },
      };

      const resAlpha = store.recordHarvestIntake(alphaDelivery);
      expect(resAlpha).toMatchObject({
        ok: true,
        deduplicatedTransport: false,
      });

      const resBeta = store.recordHarvestIntake(betaDelivery);
      expect(resBeta).toMatchObject({
        ok: true,
        deduplicatedTransport: false,
      });

      // Transport deduplication check
      const resAlphaDup = store.recordHarvestIntake(alphaDelivery);
      expect(resAlphaDup).toMatchObject({
        ok: true,
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
        backend: "codex" as any,
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
        } as any,
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
