/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverGitIdentityFacts } from "../adapters/git/project-id.js";
import {
  computeLegacyProjectIds,
  computeProjectId,
} from "../domain/project-id.js";
import { listRoutingDecisions } from "../server/routing-decisions.js";
import { listCompressionRecords } from "./compression.js";
import { insertCompressionRecord } from "./db.js";
import { getGateResult } from "./gates.js";
import { getTestDb, openDatabase } from "./index.js";
import { listIssues } from "./issues.js";
import {
  getAllDependencies,
  getEdgesForFeature,
  getFeature,
  getPhase,
  getProposal,
  insertPhase,
  insertProposal,
  listFeatures,
  listPhases,
  listProposals,
} from "./plan.js";
import { getRoutingHistory } from "./plugins.js";
import { createProjectRegistry } from "./project-registry.js";
import {
  finishRun,
  getStats,
  listCheckoutRuns,
  listProjects,
  listRuns,
  registerProject,
  startRun,
} from "./runs.js";

describe("Project registry upgrade", () => {
  const migration = "014-project-registry-and-composite-keys.sql";
  const source = new URL("./migrations/", import.meta.url);
  let root: string;
  let dbPath: string;
  let migrationsDir: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "gwrk-upgrade-")));
    dbPath = join(root, "ledger.sqlite");
    migrationsDir = join(root, "migrations");
    mkdirSync(migrationsDir);
    for (const file of readdirSync(source)) {
      if (file.endsWith(".sql") && file < migration) {
        copyFileSync(new URL(file, source), join(migrationsDir, file));
      }
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function writeEarlierRegistryMigration() {
    const legacyRegistry = readFileSync(
      new URL(migration, source),
      "utf8",
    ).replace(
      /-- Retain provenance until migration 017[\s\S]*?(?=UPDATE sqlite_sequence)/,
      "",
    );
    writeFileSync(join(migrationsDir, migration), legacyRegistry);
  }

  function upgrade(
    seed: (db: Database.Database) => void,
    registryVersion: "earlier" | "current" = "current",
  ) {
    const legacy = openDatabase({ dbPath, migrationsDir });
    try {
      seed(legacy);
    } finally {
      legacy.close();
    }
    for (const file of readdirSync(source)) {
      if (file.endsWith(".sql") && file >= migration) {
        if (registryVersion === "earlier" && file >= "017-") continue;
        copyFileSync(new URL(file, source), join(migrationsDir, file));
      }
    }
    if (registryVersion === "earlier") writeEarlierRegistryMigration();
    return openDatabase({ dbPath, migrationsDir });
  }

  it.each(["original", "expanded"])(
    "upgrades plan rows from the %s ledger write-order migration",
    (version) => {
      const ledgerMigration = "015-ledger-write-order.sql";
      const planMigration = "016-plan-write-order.sql";
      const columns = ["plan_phases", "plan_proposals"].map(
        (table) =>
          `ALTER TABLE ${table} ADD COLUMN write_seq INTEGER NOT NULL DEFAULT 0;`,
      );
      copyFileSync(new URL(migration, source), join(migrationsDir, migration));
      let ledgerSql = readFileSync(new URL(ledgerMigration, source), "utf8");
      for (const column of columns) ledgerSql = ledgerSql.replace(column, "");
      const expanded = version === "expanded";
      if (expanded) ledgerSql += `\n${columns.join("\n")}\n`;
      writeFileSync(join(migrationsDir, ledgerMigration), ledgerSql);

      const legacy = openDatabase({ dbPath, migrationsDir });
      try {
        legacy.exec(`
          INSERT INTO projects (id, name, path) VALUES ('legacy-local', 'Legacy local', '');
          INSERT INTO plan_features (id, name, project_id) VALUES ('feature', 'Feature', 'legacy-local');
          INSERT INTO plan_phases (id, feature_id, name, seq, project_id)
            VALUES ('phase', 'feature', 'Phase', 1, 'legacy-local');
          INSERT INTO plan_proposals (id, target_phase_id, proposal_type, project_id)
            VALUES ('proposal', 'phase', 'amend', 'legacy-local');
          UPDATE ledger_write_order SET sequence = 42 WHERE id = 1;
        `);
        if (expanded) {
          legacy.exec(`
            UPDATE plan_phases SET write_seq = 41;
            UPDATE plan_proposals SET write_seq = 42;
          `);
        }
      } finally {
        legacy.close();
      }

      for (const name of [planMigration, "017-plan-parent-provenance.sql"]) {
        copyFileSync(new URL(name, source), join(migrationsDir, name));
      }
      const projectId = "legacy-local";
      const upgraded = openDatabase({ dbPath, migrationsDir });
      try {
        const phase = getPhase("phase", projectId, upgraded);
        const proposal = getProposal("proposal", projectId, upgraded);
        expect(phase).toMatchObject({ name: "Phase" });
        expect(proposal).toMatchObject({ target_phase_id: "phase" });
        expect(
          upgraded.prepare("SELECT write_seq FROM plan_phases").pluck().get(),
        ).toBe(expanded ? 41 : 0);
        expect(
          upgraded
            .prepare("SELECT write_seq FROM plan_proposals")
            .pluck()
            .get(),
        ).toBe(expanded ? 42 : 0);
        expect(
          upgraded
            .prepare("SELECT sequence FROM ledger_write_order")
            .pluck()
            .get(),
        ).toBe(42);

        if (!phase || !proposal) throw new Error("Missing upgraded plan rows");
        insertPhase({ ...phase, status: "COMPLETED" }, projectId, upgraded);
        insertProposal(
          { ...proposal, status: "ACCEPTED" },
          projectId,
          upgraded,
        );
        expect(upgraded.pragma("foreign_key_check")).toEqual([]);
      } finally {
        upgraded.close();
      }

      const reopened = openDatabase({ dbPath, migrationsDir });
      try {
        expect(getPhase("phase", projectId, reopened)?.status).toBe(
          "COMPLETED",
        );
        expect(getProposal("proposal", projectId, reopened)?.status).toBe(
          "ACCEPTED",
        );
        expect(
          reopened.prepare("SELECT write_seq FROM plan_phases").pluck().get(),
        ).toBe(43);
        expect(
          reopened
            .prepare("SELECT write_seq FROM plan_proposals")
            .pluck()
            .get(),
        ).toBe(44);
        expect(
          reopened
            .prepare(
              "SELECT name FROM _migrations WHERE name IN (?, ?) ORDER BY name",
            )
            .pluck()
            .all(ledgerMigration, planMigration),
        ).toEqual([ledgerMigration, planMigration]);
      } finally {
        reopened.close();
      }
    },
  );

  it("adds parent provenance to a ledger with migration 016 already applied", () => {
    const parentProvenance = "017-plan-parent-provenance.sql";
    writeEarlierRegistryMigration();
    for (const name of [
      "015-ledger-write-order.sql",
      "016-plan-write-order.sql",
    ]) {
      copyFileSync(new URL(name, source), join(migrationsDir, name));
    }

    const prior = openDatabase({ dbPath, migrationsDir });
    try {
      prior.exec(`
        INSERT INTO projects (id, name, path, slug) VALUES ('alpha', 'Alpha', '/fixture/alpha', 'alpha');
        INSERT INTO plan_features (id, name, project_id, status)
          VALUES ('feature', 'Saved feature', 'alpha', 'SHIPPED');
        INSERT INTO plan_phases (id, name, feature_id, project_id, status, seq, write_seq)
          VALUES ('phase', 'Saved phase', 'feature', 'alpha', 'COMPLETED', 1, 3);
      `);
    } finally {
      prior.close();
    }

    copyFileSync(
      new URL(parentProvenance, source),
      join(migrationsDir, parentProvenance),
    );
    for (let reopen = 0; reopen < 2; reopen++) {
      const db = openDatabase({ dbPath, migrationsDir });
      try {
        expect(getFeature("feature", "alpha", db)).toMatchObject({
          status: "SHIPPED",
        });
        expect(getPhase("phase", "alpha", db)).toMatchObject({
          status: "COMPLETED",
        });
        expect(
          db
            .prepare("SELECT synthetic_parent, write_seq FROM plan_phases")
            .get(),
        ).toEqual({ synthetic_parent: 0, write_seq: 3 });
        expect(
          db
            .prepare("SELECT COUNT(*) FROM _migrations WHERE name = ?")
            .pluck()
            .get(parentProvenance),
        ).toBe(1);
      } finally {
        db.close();
      }
    }
  });

  it.each([
    { registryVersion: "current", clockOffset: 0 },
    { registryVersion: "earlier", clockOffset: 0 },
    { registryVersion: "earlier", clockOffset: 1 },
  ] as const)(
    "preserves real plan parents after first-origin enrollment with $registryVersion migration 014 and clock offset $clockOffset",
    ({ registryVersion, clockOffset }) => {
      const checkout = join(root, "checkout");
      const git = (...args: string[]) =>
        execFileSync("git", ["-C", checkout, ...args]);
      execFileSync("git", ["init", "--quiet", checkout]);
      const localId = computeProjectId(discoverGitIdentityFacts(checkout));
      const origin = "https://github.com/example/checkout.git";
      git("remote", "add", "origin", origin);
      const remoteId = computeProjectId(discoverGitIdentityFacts(checkout));
      git("remote", "remove", "origin");

      const upgraded = upgrade((legacy) => {
        legacy
          .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
          .run(localId, "Checkout", checkout);
        legacy
          .prepare(`
        INSERT INTO plan_features (id, name, project_id, status, created_at, updated_at)
        VALUES ('feature', 'Saved feature', ?, 'SHIPPED', '2026-01-01 09:00:00', '2026-01-01 10:00:00')
      `)
          .run(localId);
        legacy
          .prepare(`
        INSERT INTO plan_phases (id, feature_id, name, seq, project_id, status, created_at, updated_at)
        VALUES ('phase', 'feature', 'Saved phase', 1, ?, 'COMPLETED', '2026-01-01 09:00:00', '2026-01-01 10:00:00')
      `)
          .run(localId);
        legacy
          .prepare(`
        INSERT INTO plan_proposals (id, target_phase_id, proposal_type, project_id, status)
        VALUES ('proposal', 'phase', 'amend', ?, 'ACCEPTED')
      `)
          .run(remoteId);
      }, registryVersion);
      try {
        if (registryVersion === "earlier") {
          const appliedAt = upgraded
            .prepare("SELECT applied_at FROM _migrations WHERE name = ?")
            .pluck()
            .get(migration);
          const placeholderCreatedAt = upgraded
            .prepare("SELECT datetime(?, ?)")
            .pluck()
            .get(appliedAt, `-${clockOffset} seconds`);
          for (const [table, id] of [
            ["plan_features", "feature"],
            ["plan_phases", "phase"],
          ]) {
            upgraded
              .prepare(`UPDATE ${table} SET created_at = ?, updated_at = ?
                WHERE id = ? AND project_id = ?`)
              .run(placeholderCreatedAt, placeholderCreatedAt, id, remoteId);
          }
          upgraded
            .prepare(`
          INSERT INTO plan_features (id, name, project_id, created_at, updated_at)
          VALUES ('edited-feature', 'edited-feature', ?, ?, '2099-01-01 00:00:00')
        `)
            .run(remoteId, appliedAt);
          upgraded
            .prepare(`
          INSERT INTO plan_phases (id, feature_id, name, seq, project_id, created_at, updated_at)
          VALUES ('edited-phase', 'edited-feature', 'Edited phase', 0, ?, ?, ?)
        `)
            .run(remoteId, appliedAt, appliedAt);
          upgraded
            .prepare(`
          INSERT INTO plan_proposals (id, target_phase_id, proposal_type, project_id)
          VALUES ('edited-proposal', 'edited-phase', 'amend', ?)
        `)
            .run(remoteId);
          const provenance = "017-plan-parent-provenance.sql";
          copyFileSync(
            new URL(provenance, source),
            join(migrationsDir, provenance),
          );
        }
      } finally {
        upgraded.close();
      }

      git("remote", "add", "origin", origin);
      const reopened = openDatabase({ dbPath, migrationsDir });
      try {
        createProjectRegistry(reopened, () => {}).enrollProject({
          projectId: remoteId,
          slug: "checkout",
          name: "Checkout",
          repoSlug: "example/checkout",
          trunkBranch: "develop",
          localRoot: checkout,
          mirrorPath: null,
          runnerPolicy: { allowedKinds: ["local"] },
          slack: null,
          legacyProjectIds: [],
          createdAt: "2026-11-01T00:00:00Z",
          updatedAt: "2026-11-01T00:00:00Z",
        });
        const feature = {
          id: "feature",
          name: "Saved feature",
          status: "SHIPPED",
        };
        const phase = { id: "phase", name: "Saved phase", status: "COMPLETED" };
        if (registryVersion === "earlier") {
          for (const [table, id] of [
            ["plan_features", "feature"],
            ["plan_phases", "phase"],
          ]) {
            expect
              .soft(
                reopened
                  .prepare(
                    `SELECT synthetic_parent FROM ${table} WHERE id = ? AND project_id = ?`,
                  )
                  .pluck()
                  .get(id, remoteId),
              )
              .toBe(1);
          }
          for (const [table, id] of [
            ["plan_features", "edited-feature"],
            ["plan_phases", "edited-phase"],
          ]) {
            expect(
              reopened
                .prepare(`SELECT synthetic_parent FROM ${table} WHERE id = ?`)
                .pluck()
                .get(id),
            ).toBe(0);
          }
        }
        for (const owner of [localId, remoteId]) {
          expect
            .soft(getFeature("feature", owner, reopened))
            .toMatchObject(feature);
          expect
            .soft(
              listFeatures(owner, reopened).filter(
                (row) => row.id === "feature",
              ),
            )
            .toMatchObject([feature]);
          expect.soft(getPhase("phase", owner, reopened)).toMatchObject(phase);
          expect
            .soft(listPhases("feature", owner, reopened))
            .toMatchObject([phase]);
          expect.soft(getProposal("proposal", owner, reopened)).toMatchObject({
            project_id: remoteId,
            status: "ACCEPTED",
          });
        }
        expect(reopened.pragma("foreign_key_check")).toEqual([]);
      } finally {
        reopened.close();
      }
    },
  );

  it("retains newer legacy plan state after upgrade and enrollment", () => {
    const checkout = join(root, "checkout");
    execFileSync("git", ["init", "--quiet", checkout]);
    const localId = computeProjectId(discoverGitIdentityFacts(checkout));
    const enrollment = {
      projectId: localId,
      slug: "checkout",
      name: "Checkout",
      repoSlug: null,
      trunkBranch: "develop",
      localRoot: checkout,
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local" as const] },
      slack: null,
      legacyProjectIds: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const ledgerOrder = "015-ledger-write-order.sql";
    const planOrder = "016-plan-write-order.sql";
    for (const name of [migration, ledgerOrder]) {
      copyFileSync(new URL(name, source), join(migrationsDir, name));
    }
    const legacy = openDatabase({ dbPath, migrationsDir });
    let remoteId: string;
    try {
      createProjectRegistry(legacy, () => {}).enrollProject(enrollment);
      execFileSync("git", [
        "-C",
        checkout,
        "remote",
        "add",
        "origin",
        "https://github.com/example/checkout.git",
      ]);
      remoteId = computeProjectId(discoverGitIdentityFacts(checkout));
      registerProject(
        {
          id: remoteId,
          name: "Checkout",
          path: checkout,
          github_repo: "example/checkout",
        },
        legacy,
      );
      const feature = legacy.prepare(
        `INSERT INTO plan_features (id, name, project_id, status, updated_at, write_seq)
         VALUES (?, 'Feature', ?, ?, ?, ?)`,
      );
      const phase = legacy.prepare(
        "INSERT INTO plan_phases (id, feature_id, name, seq, project_id, status, updated_at) VALUES ('phase', 'feature', 'Phase', 1, ?, ?, ?)",
      );
      const proposal = legacy.prepare(
        "INSERT INTO plan_proposals (id, target_phase_id, proposal_type, project_id, status, created_at, updated_at) VALUES ('proposal', 'phase', 'amend', ?, ?, ?, ?)",
      );
      feature.run("feature", remoteId, "PLANNED", "2026-01-01 10:00:00", 0);
      feature.run("feature", localId, "SHIPPED", "2026-01-01T11:00:00Z", 0);
      feature.run("sequenced", remoteId, "SHIPPED", "2026-01-01 09:00:00", 1);
      feature.run("sequenced", localId, "PLANNED", "2026-01-01T12:00:00Z", 0);
      legacy
        .prepare(
          `INSERT INTO plan_edges (from_id, to_id, edge_type, project_id)
           VALUES ('feature', 'sequenced', 'DEPENDS_ON', ?)`,
        )
        .run(localId);
      phase.run(remoteId, "PLANNED", "2026-01-01 10:00:00");
      phase.run(localId, "COMPLETED", "2026-01-01T11:00:00Z");
      proposal.run(
        remoteId,
        "PENDING",
        "2026-01-01 09:00:00",
        "2026-01-01 10:00:00",
      );
      proposal.run(localId, "ACCEPTED", "2026-01-01T11:00:00Z", null);
    } finally {
      legacy.close();
    }

    copyFileSync(new URL(planOrder, source), join(migrationsDir, planOrder));
    const parentProvenance = "017-plan-parent-provenance.sql";
    copyFileSync(
      new URL(parentProvenance, source),
      join(migrationsDir, parentProvenance),
    );
    const upgraded = openDatabase({ dbPath, migrationsDir });
    try {
      createProjectRegistry(upgraded, () => {}).enrollProject({
        ...enrollment,
        projectId: remoteId,
        repoSlug: "example/checkout",
      });
      for (const owner of [localId, remoteId]) {
        expect
          .soft(getFeature("feature", owner, upgraded)?.status)
          .toBe("SHIPPED");
        expect
          .soft(getFeature("sequenced", owner, upgraded)?.status)
          .toBe("SHIPPED");
        expect.soft(listFeatures(owner, upgraded)).toMatchObject([
          { id: "feature", status: "SHIPPED" },
          { id: "sequenced", status: "SHIPPED" },
        ]);
        expect
          .soft(getAllDependencies("sequenced", owner, upgraded))
          .toMatchObject([{ id: "feature", status: "SHIPPED" }]);
        expect
          .soft(getPhase("phase", owner, upgraded)?.status)
          .toBe("COMPLETED");
        expect
          .soft(listPhases("feature", owner, upgraded))
          .toMatchObject([{ id: "phase", status: "COMPLETED" }]);
        expect
          .soft(getProposal("proposal", owner, upgraded)?.status)
          .toBe("ACCEPTED");
        expect
          .soft(listProposals(owner, upgraded))
          .toMatchObject([{ id: "proposal", status: "ACCEPTED" }]);
      }
      expect
        .soft(
          upgraded
            .prepare(
              "SELECT status FROM plan_features WHERE id = 'feature' AND project_id = ?",
            )
            .pluck()
            .get(remoteId),
        )
        .toBe("SHIPPED");
      expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("preserves history and records the IDs of missing legacy runs", () => {
    const upgraded = upgrade((legacy) => {
      legacy.pragma("foreign_keys = OFF");
      legacy.exec(`
        INSERT INTO projects (id, name, path) VALUES ('alpha', 'Alpha', '/alpha');
        INSERT INTO runs (id, feature_id, command) VALUES (1, 'shared', 'ship');
        INSERT INTO history (id, project_id, feature_id, run_id, metadata)
          VALUES (1, 'alpha', 'shared', 1, 'linked'),
                 (2, 'alpha', 'shared', 99, 'orphaned'),
                 (3, 'alpha', 'shared', NULL, 'unlinked');
      `);
      expect(legacy.pragma("foreign_key_check")).toHaveLength(1);
    });
    try {
      expect(
        upgraded
          .prepare(
            "SELECT project_id, run_id, legacy_run_id, metadata FROM history ORDER BY id",
          )
          .all(),
      ).toEqual([
        {
          project_id: "alpha",
          run_id: 1,
          legacy_run_id: null,
          metadata: "linked",
        },
        {
          project_id: "alpha",
          run_id: null,
          legacy_run_id: 99,
          metadata: "orphaned",
        },
        {
          project_id: "alpha",
          run_id: null,
          legacy_run_id: null,
          metadata: "unlinked",
        },
      ]);
      expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("preserves explicit run and history owners missing from the project table", () => {
    const upgraded = upgrade((legacy) => {
      legacy.pragma("foreign_keys = OFF");
      legacy.exec(`
        INSERT INTO runs (id, project_id, feature_id, command)
          VALUES (41, 'run-owner', 'fixture', 'ship');
        INSERT INTO history (project_id, feature_id, run_id)
          VALUES ('history-owner', 'fixture', 41);
      `);
    });
    try {
      expect(
        upgraded
          .prepare("SELECT project_id FROM runs WHERE id = 41")
          .pluck()
          .get(),
      ).toBe("run-owner");
      expect(
        upgraded
          .prepare(
            "SELECT project_id, run_id FROM history WHERE feature_id = 'fixture'",
          )
          .get(),
      ).toEqual({ project_id: "history-owner", run_id: 41 });
      expect(
        upgraded
          .prepare(
            "SELECT id, path, updated_at FROM projects WHERE id IN ('run-owner', 'history-owner') ORDER BY id",
          )
          .all(),
      ).toEqual([
        { id: "history-owner", path: "", updated_at: null },
        { id: "run-owner", path: "", updated_at: null },
      ]);
      expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("assigns unattributed runs and history to their legacy scopes", () => {
    const upgraded = upgrade((legacy) => {
      legacy.exec(`
        INSERT INTO projects (id, name, path) VALUES ('alpha', 'Alpha', '/alpha');
        INSERT INTO runs (id, project_id, feature_id, command) VALUES
          (41, NULL, 'fixture', 'ship'), (42, 'alpha', 'fixture', 'ship');
        INSERT INTO history (id, project_id, feature_id, run_id) VALUES
          (1, NULL, 'fixture', 41), (2, NULL, 'fixture', 42),
          (3, NULL, 'fixture', NULL), (4, 'alpha', 'fixture', 41);
      `);
    });
    try {
      expect
        .soft(listRuns("fixture", "legacy-local", upgraded))
        .toMatchObject([{ id: 41, project_id: "legacy-local" }]);
      expect(listRuns("fixture", "alpha", upgraded)).toMatchObject([
        { id: 42, project_id: "alpha" },
      ]);
      expect(
        upgraded
          .prepare("SELECT project_id, run_id FROM history ORDER BY id")
          .all(),
      ).toEqual([
        { project_id: "legacy-local", run_id: 41 },
        { project_id: "alpha", run_id: 42 },
        { project_id: "legacy-local", run_id: null },
        { project_id: "alpha", run_id: 41 },
      ]);
      expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("creates legacy-local for unattributed history without any runs", () => {
    const upgraded = upgrade((legacy) => {
      legacy.exec("INSERT INTO history (feature_id) VALUES ('fixture')");
    });
    try {
      expect(
        upgraded.prepare("SELECT project_id FROM history").pluck().get(),
      ).toBe("legacy-local");
      expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("creates legacy-local for ownerless compression without other legacy ledgers", () => {
    const upgraded = upgrade((legacy) => {
      legacy.exec(`
        INSERT INTO projects (id, name, path) VALUES ('alpha', 'Alpha', '/alpha');
        INSERT INTO compression (
          id, project_id, feature_id, phase_id, estimated_hours, actual_coding_hours,
          estimated_days, actual_delivery_days, point_compression, total_compression, merge_timestamp
        ) VALUES
          (1, NULL, 'shared', 'phase-01', 8, 1, 1, 1, 8, 8, '2026-11-11'),
          (2, NULL, 'shared', 'phase-01', 8, 2, 1, 1, 4, 4, '2026-11-11'),
          (3, 'alpha', 'shared', 'phase-01', 8, 4, 1, 1, 2, 2, '2026-11-11');
      `);
    });
    try {
      expect
        .soft(
          upgraded
            .prepare("SELECT id FROM projects WHERE id = ?")
            .pluck()
            .get("legacy-local"),
        )
        .toBe("legacy-local");
      expect
        .soft(listCompressionRecords("shared", "legacy-local", upgraded))
        .toMatchObject([{ project_id: "legacy-local", point_compression: 4 }]);
      expect
        .soft(listCompressionRecords("shared", "alpha", upgraded))
        .toMatchObject([{ project_id: "alpha", point_compression: 2 }]);
      expect
        .soft(
          upgraded
            .prepare("SELECT id, project_id FROM compression ORDER BY id")
            .all(),
        )
        .toEqual([
          { id: 1, project_id: "legacy-local" },
          { id: 2, project_id: "legacy-local" },
          { id: 3, project_id: "alpha" },
        ]);
      expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("creates legacy-local for ownerless routing history without other legacy ledgers", () => {
    const upgraded = upgrade((legacy) => {
      legacy.exec(`
        INSERT INTO projects (id, name, path) VALUES ('alpha', 'Alpha', '/alpha');
        INSERT INTO routing_history (project_id, task_type, selected_backend, outcome)
        VALUES (NULL, 'implement', 'legacy-backend', 'success'),
               ('alpha', 'implement', 'alpha-backend', 'success');
      `);
    });
    try {
      expect
        .soft(
          upgraded
            .prepare("SELECT id FROM projects WHERE id = ?")
            .pluck()
            .get("legacy-local"),
        )
        .toBe("legacy-local");
      expect
        .soft(getRoutingHistory("implement", "legacy-local", 10, upgraded))
        .toMatchObject([
          { project_id: "legacy-local", selected_backend: "legacy-backend" },
        ]);
      expect
        .soft(getRoutingHistory("implement", "alpha", 10, upgraded))
        .toMatchObject([
          { project_id: "alpha", selected_backend: "alpha-backend" },
        ]);
      expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("keeps an unlinked ship decision outside the older run's project scope", () => {
    const runId = "ship-shared-1700000000000";
    const upgraded = upgrade((legacy) => {
      legacy.exec(`
        INSERT INTO projects (id, name, path) VALUES ('alpha', 'Alpha', '/alpha');
        INSERT INTO plan_features (id, name, project_id) VALUES ('shared', 'Shared', 'alpha');
        INSERT INTO plan_phases (id, feature_id, name, seq, project_id)
          VALUES ('shared/phase-01', 'shared', 'Phase 1', 1, 'alpha');
        INSERT INTO runs (project_id, feature_id, phase_id, command, started_at, finished_at)
          VALUES ('alpha', 'shared', 'phase-01', 'ship', '2023-11-13 22:13:20', '2023-11-13 22:14:20');
      `);
      legacy
        .prepare(`
          INSERT INTO routing_decisions (run_id, feature, phase, selected_backend, reason, probe_status, created_at)
          VALUES (?, 'shared', 'phase-01', 'beta-backend', 'decision before startRun', 'fresh',
            datetime(1700000000, 'unixepoch'))
        `)
        .run(runId);
    });
    try {
      expect.soft(listRoutingDecisions("alpha", runId, upgraded)).toEqual([]);
      expect(
        listRoutingDecisions("legacy-local", runId, upgraded),
      ).toMatchObject([
        { projectId: "legacy-local", selectedBackend: "beta-backend" },
      ]);
    } finally {
      upgraded.close();
    }
  });

  it("keeps legacy ship decisions without a linked run in legacy-local", () => {
    const upgraded = upgrade((legacy) => {
      legacy.exec(`
        INSERT INTO projects (id, name, path) VALUES
          ('alpha', 'Alpha', '/alpha'), ('beta', 'Beta', '/beta');
        INSERT INTO plan_features (id, name, project_id) VALUES
          ('feature-one', 'Feature one', 'alpha'),
          ('conflict', 'Conflicting feature', 'alpha'),
          ('run-conflict', 'Conflicting run', 'alpha'),
          ('placeholder', 'Unattributed feature', NULL);
        INSERT INTO plan_phases (id, feature_id, name, seq, project_id) VALUES
          ('feature-one/phase-01', 'feature-one', 'Phase 1', 1, 'alpha'),
          ('conflict/phase-01', 'conflict', 'Phase 1', 1, 'beta'),
          ('placeholder/phase-01', 'placeholder', 'Phase 1', 1, 'alpha');
        INSERT INTO runs (id, project_id, feature_id, phase_id, command) VALUES
          (42, 'beta', 'conflict', 'phase-01', 'ship'),
          (43, 'beta', 'run-conflict', 'phase-01', 'ship'),
          (44, 'beta', 'feature-one', 'phase-01', 'research'),
          (45, 'beta', 'feature-one', 'phase-02', 'ship'),
          (46, 'beta', 'runs-only', 'phase-01', 'ship');
        INSERT INTO routing_decisions (run_id, feature, phase, selected_backend, reason, probe_status) VALUES
          ('ship-conflict-1700000000000', 'conflict', 'phase-01', 'fixture', 'phase conflict', 'fresh'),
          ('ship-run-conflict-1700000000000', 'run-conflict', 'phase-01', 'fixture', 'run conflict', 'fresh'),
          ('ship-missing-1700000000000', 'missing', 'phase-01', 'fixture', 'missing', 'fresh'),
          ('ship-placeholder-1700000000000', 'placeholder', 'phase-01', 'fixture', 'explicit phase', 'fresh'),
          ('ship-runs-only-1700000000000', 'runs-only', 'phase-01', 'fixture', 'ship run only', 'fresh'),
          ('ship-feature-one-1700000000000x', 'feature-one', 'phase-01', 'fixture', 'invalid suffix', 'fresh'),
          ('ship-other-1700000000000', 'feature-one', 'phase-01', 'fixture', 'invalid prefix', 'fresh'),
          ('42', 'conflict', 'phase-01', 'fixture', 'exact run', 'fresh');
      `);
    });
    try {
      const cases = [
        ["ship-conflict-1700000000000", "legacy-local", "phase conflict"],
        ["ship-run-conflict-1700000000000", "legacy-local", "run conflict"],
        ["ship-missing-1700000000000", "legacy-local", "missing"],
        ["ship-placeholder-1700000000000", "legacy-local", "explicit phase"],
        ["ship-runs-only-1700000000000", "legacy-local", "ship run only"],
        ["ship-feature-one-1700000000000x", "legacy-local", "invalid suffix"],
        ["ship-other-1700000000000", "legacy-local", "invalid prefix"],
        ["42", "beta", "exact run"],
      ];
      for (const [runId, owner, reason] of cases) {
        for (const projectId of ["alpha", "beta", "legacy-local"]) {
          expect
            .soft(listRoutingDecisions(projectId, runId, upgraded), reason)
            .toMatchObject(projectId === owner ? [{ projectId, reason }] : []);
        }
      }
      expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("upgrades a historical issue table without html_url", () => {
    const upgraded = upgrade((legacy) => {
      legacy.exec(`
        ALTER TABLE issues DROP COLUMN html_url;
        INSERT INTO projects (id, name, path) VALUES ('alpha', 'Alpha', '/alpha');
        INSERT INTO issues (issue_number, feature_id, title, body, created_at, author, project_id)
        VALUES (42, 'fixture', 'Original issue', 'Issue body', '2026-11-11', 'fixture', 'alpha');
      `);
    });
    try {
      expect(listIssues("fixture", "alpha", upgraded)).toMatchObject([
        {
          issue_number: 42,
          title: "Original issue",
          body: "Issue body",
          html_url: null,
        },
      ]);
      expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("preserves explicit issue and gate owners when a feature ID collides", () => {
    const upgraded = upgrade((legacy) => {
      // The old feature key allowed only Alpha's copy of the shared feature ID.
      legacy.exec(`
        INSERT INTO projects (id, name, path) VALUES ('alpha', 'Alpha', '/alpha');
        INSERT INTO plan_features (id, name, project_id)
          VALUES ('shared', 'Alpha feature', 'alpha'), ('alpha-only', 'Alpha only', 'alpha'),
                 ('unowned-feature', 'Unowned feature', NULL);
        INSERT INTO plan_phases (id, feature_id, name, seq, project_id)
          VALUES ('phase', 'shared', 'Alpha phase', 1, 'alpha'),
                 ('other-phase', 'shared', 'Beta phase', 2, 'beta-unregistered'),
                 ('owned-phase', 'unowned-feature', 'Owned phase', 1, 'alpha');
        INSERT INTO issues (issue_number, feature_id, title, created_at, author, project_id)
          VALUES (7, 'shared', 'Beta issue', '2026-11-11', 'fixture', 'beta-unregistered'),
                 (8, 'shared', 'Ambiguous issue', '2026-11-11', 'fixture', NULL),
                 (9, 'alpha-only', 'Unattributed issue', '2026-11-11', 'fixture', NULL),
                 (10, 'unowned-feature', 'Issue with an owned phase', '2026-11-11', 'fixture', NULL);
        INSERT INTO gate_results (feature_id, phase_id, task_id, gate_script, project_id)
          VALUES ('shared', 'phase', 'T001', 'beta.sh', 'beta-unregistered'),
                 ('shared', 'other-phase', 'T002', 'ambiguous.sh', NULL),
                 ('unowned-feature', 'owned-phase', 'T003', 'alpha.sh', NULL);
      `);
    });
    try {
      expect
        .soft(
          listIssues("shared", "alpha", upgraded).map(
            (issue) => issue.issue_number,
          ),
        )
        .toEqual([]);
      expect
        .soft(listIssues("shared", "legacy-local", upgraded))
        .toMatchObject([{ issue_number: 8 }]);
      expect(listIssues("alpha-only", "alpha", upgraded)).toMatchObject([
        { issue_number: 9 },
      ]);
      expect
        .soft(listIssues("unowned-feature", "alpha", upgraded))
        .toMatchObject([{ issue_number: 10 }]);
      expect
        .soft(
          getGateResult(
            "unowned-feature",
            "owned-phase",
            "T003",
            "alpha",
            upgraded,
          ),
        )
        .toMatchObject({ gate_script: "alpha.sh" });
      expect
        .soft(getGateResult("shared", "phase", "T001", "alpha", upgraded))
        .toBeUndefined();
      expect
        .soft(listIssues("shared", "beta-unregistered", upgraded))
        .toMatchObject([{ issue_number: 7, title: "Beta issue" }]);
      expect
        .soft(
          getGateResult(
            "shared",
            "phase",
            "T001",
            "beta-unregistered",
            upgraded,
          )?.gate_script,
        )
        .toBe("beta.sh");
      expect(
        getGateResult("shared", "other-phase", "T002", "legacy-local", upgraded)
          ?.gate_script,
      ).toBe("ambiguous.sh");
    } finally {
      upgraded.close();
    }
  });

  it("preserves explicit plan owners absent from the projects table", () => {
    const beta = "beta-unregistered";
    const upgraded = upgrade((legacy) => {
      legacy.exec(`
        INSERT INTO projects (id, name, path) VALUES ('alpha', 'Alpha', '/alpha');
        INSERT INTO plan_features (id, name, project_id)
          VALUES ('shared', 'Alpha feature', 'alpha'),
                 ('beta-only', 'Beta feature', 'beta-unregistered');
        INSERT INTO plan_phases (id, feature_id, name, seq, project_id)
          VALUES ('alpha-phase', 'shared', 'Alpha phase', 1, 'alpha'),
                 ('beta-phase', 'shared', 'Beta phase', 2, 'beta-unregistered');
        INSERT INTO plan_proposals (id, target_phase_id, proposal_type, project_id)
          VALUES ('beta-proposal', 'alpha-phase', 'ADD_TASK', 'beta-unregistered');
        INSERT INTO plan_edges (from_id, to_id, edge_type, project_id)
          VALUES ('beta-only', 'shared', 'DEPENDS_ON', 'beta-unregistered');
      `);
    });
    try {
      expect.soft(getFeature("beta-only", "alpha", upgraded)).toBeUndefined();
      expect.soft(getPhase("beta-phase", "alpha", upgraded)).toBeUndefined();
      expect
        .soft(getProposal("beta-proposal", "alpha", upgraded))
        .toBeUndefined();
      expect.soft(getEdgesForFeature("shared", "alpha", upgraded)).toEqual([]);
      expect
        .soft(getFeature("beta-only", beta, upgraded)?.name)
        .toBe("Beta feature");
      expect.soft(getFeature("shared", beta, upgraded)?.name).toBe("shared");
      expect
        .soft(getPhase("beta-phase", beta, upgraded)?.name)
        .toBe("Beta phase");
      expect
        .soft(getProposal("beta-proposal", beta, upgraded)?.target_phase_id)
        .toBe("alpha-phase");
      expect
        .soft(getPhase("alpha-phase", beta, upgraded)?.name)
        .toBe("alpha-phase");
      expect
        .soft(getEdgesForFeature("shared", beta, upgraded))
        .toMatchObject([{ from_id: "beta-only", project_id: beta }]);
      expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("backfills checkout roots and path aliases for verified projects", () => {
    const checkout = join(root, "checkout");
    const suffixed = join(root, "suffixed");
    const missing = join(root, "missing");
    mkdirSync(checkout);
    execFileSync("git", ["init", "--quiet", checkout], { stdio: "ignore" });
    execFileSync("git", ["init", "--quiet", suffixed], { stdio: "ignore" });
    const suffixedFacts = discoverGitIdentityFacts(suffixed);
    const suffixedId = computeProjectId(suffixedFacts);
    const unrelatedId = "unrelated";
    const nested = join(checkout, "nested");
    mkdirSync(nested);
    const facts = discoverGitIdentityFacts(checkout);
    const [verifiedId] = computeLegacyProjectIds(facts);
    const missingId = computeProjectId({ projectRoot: missing });
    const [nestedId] = computeLegacyProjectIds({ projectRoot: nested });
    const upgraded = upgrade((legacy) => {
      const insert = legacy.prepare(
        "INSERT INTO projects (id, name, path) VALUES (?, ?, ?)",
      );
      insert.run(verifiedId, "Verified", checkout);
      insert.run(missingId, "Missing", missing);
      insert.run(nestedId, "Nested", nested);
      insert.run(suffixedId, "Suffixed", `${suffixed}#${suffixedId}`);
      insert.run(unrelatedId, "Unrelated", `${suffixed}#${unrelatedId}`);
    });
    try {
      const getRoot = upgraded
        .prepare("SELECT local_root FROM projects WHERE id = ?")
        .pluck();
      expect.soft(getRoot.get(verifiedId)).toBe(checkout);
      expect.soft(getRoot.get(suffixedId)).toBe(suffixed);
      for (const id of [missingId, nestedId, unrelatedId]) {
        expect.soft(getRoot.get(id)).toBeNull();
      }

      const getAliases = upgraded
        .prepare(
          "SELECT alias_id FROM project_aliases WHERE project_id = ? ORDER BY alias_id",
        )
        .pluck();
      for (const [id, checkoutFacts] of [
        [verifiedId, facts],
        [suffixedId, suffixedFacts],
      ] as const) {
        expect.soft(getAliases.all(id)).toEqual(
          computeLegacyProjectIds(checkoutFacts)
            .filter((alias) => alias !== id)
            .sort(),
        );
      }
      for (const id of [missingId, nestedId, unrelatedId]) {
        expect.soft(getAliases.all(id)).toEqual([]);
      }
      const registry = createProjectRegistry(upgraded, () => {});
      const projectId = computeProjectId(facts);
      const now = "2026-11-11T12:00:00.000Z";
      registry.enrollProject({
        projectId,
        slug: "verified",
        name: "Verified",
        repoSlug: null,
        trunkBranch: "develop",
        localRoot: checkout,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local"] },
        slack: null,
        legacyProjectIds: computeLegacyProjectIds(facts),
        createdAt: now,
        updatedAt: now,
      });
      for (const alias of computeLegacyProjectIds(facts)) {
        expect(registry.getProject(alias)?.projectId).toBe(projectId);
      }
    } finally {
      upgraded.close();
    }
  });

  it("unifies occupied path hashes with their verified remote owner", () => {
    const checkout = join(root, "occupied-hashes");
    execFileSync("git", ["init", "--quiet", checkout], { stdio: "ignore" });
    execFileSync("git", [
      "-C",
      checkout,
      "remote",
      "add",
      "origin",
      "git@github.com:example/alpha.git",
    ]);
    const facts = discoverGitIdentityFacts(checkout);
    const canonical = computeProjectId(facts);
    const ids = [
      canonical,
      ...computeLegacyProjectIds({ projectRoot: checkout }),
    ];
    const upgraded = upgrade((legacy) => {
      for (const [index, id] of ids.entries()) {
        legacy
          .prepare(
            "INSERT INTO projects (id, name, path, github_repo) VALUES (?, ?, ?, ?)",
          )
          .run(
            id,
            "Alpha",
            index === 0 ? checkout : `${checkout}#${id}`,
            "example/alpha",
          );
        legacy
          .prepare(
            "INSERT INTO runs (id, project_id, feature_id, command) VALUES (?, ?, 'shared', 'ship')",
          )
          .run(index + 1, id);
      }
    });
    try {
      for (const id of ids) {
        expect
          .soft(
            listRuns("shared", id, upgraded)
              .map((run) => run.id)
              .sort(),
          )
          .toEqual([1, 2, 3]);
      }
      expect(
        listCheckoutRuns("shared", checkout, upgraded)
          .map((run) => run.id)
          .sort(),
      ).toEqual([1, 2, 3]);
      expect(
        upgraded
          .prepare("SELECT project_id FROM runs ORDER BY id")
          .pluck()
          .all(),
      ).toEqual(ids);
      expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("restores verified plan parents without copying them into unrelated scopes", () => {
    const checkout = join(root, "checkout");
    execFileSync("git", ["init", "--quiet", checkout]);
    execFileSync("git", [
      "-C",
      checkout,
      "remote",
      "add",
      "origin",
      "https://github.com/example/alpha.git",
    ]);
    const facts = discoverGitIdentityFacts(checkout);
    const canonical = computeProjectId(facts);
    const [alias] = computeLegacyProjectIds(facts);
    const upgraded = upgrade((legacy) => {
      const project = legacy.prepare(
        "INSERT INTO projects (id, name, path, github_repo) VALUES (?, 'Alpha', ?, 'example/alpha')",
      );
      project.run(canonical, checkout);
      project.run(alias, `${checkout}#${alias}`);
      legacy
        .prepare(
          `INSERT INTO plan_features (id, name, project_id, status)
           VALUES ('feature', 'Real Feature', ?, 'SHIPPED')`,
        )
        .run(alias);
      legacy
        .prepare(
          `INSERT INTO plan_phases (id, feature_id, name, seq, project_id, status, created_at, updated_at)
           VALUES ('phase', 'feature', 'Real Phase', 1, ?, 'COMPLETED', '2026-01-01 09:00:00', '2026-01-01T10:00:00Z')`,
        )
        .run(alias);
      const proposal = legacy.prepare(
        "INSERT INTO plan_proposals (id, target_phase_id, proposal_type, project_id) VALUES (?, 'phase', 'ADD_TASK', ?)",
      );
      proposal.run("alpha-proposal", canonical);
      proposal.run("beta-proposal", "beta");
      legacy.exec(`
        INSERT INTO issues (issue_number, feature_id, title, created_at, author)
          VALUES (7, 'feature', 'Legacy issue', '2026-01-01', 'fixture');
        INSERT INTO gate_results (feature_id, phase_id, task_id, gate_script)
          VALUES ('feature', 'phase', 'T001', 'legacy.sh');
      `);
    });
    try {
      const expectedPhase = {
        id: "phase",
        name: "Real Phase",
        seq: 1,
        status: "COMPLETED",
        created_at: "2026-01-01 09:00:00",
        updated_at: "2026-01-01T10:00:00Z",
      };
      for (const id of [canonical, alias]) {
        expect.soft(getFeature("feature", id, upgraded)).toMatchObject({
          name: "Real Feature",
          status: "SHIPPED",
        });
        expect
          .soft(getPhase("phase", id, upgraded))
          .toMatchObject(expectedPhase);
        expect
          .soft(listPhases("feature", id, upgraded))
          .toMatchObject([expectedPhase]);
        expect
          .soft(listProposals(id, upgraded))
          .toMatchObject([{ id: "alpha-proposal", project_id: canonical }]);
        expect.soft(getProposal("alpha-proposal", id, upgraded)).toMatchObject({
          target_phase_id: "phase",
          project_id: canonical,
        });
        expect
          .soft(listIssues("feature", id, upgraded))
          .toMatchObject([{ issue_number: 7, project_id: alias }]);
        expect
          .soft(getGateResult("feature", "phase", "T001", id, upgraded))
          .toMatchObject({ gate_script: "legacy.sh", project_id: alias });
      }
      expect(getPhase("phase", "beta", upgraded)).toMatchObject({
        name: "phase",
        status: "PLANNED",
      });
      expect(listProposals("beta", upgraded)).toMatchObject([
        { id: "beta-proposal" },
      ]);
      expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("backfills the local checkout owner when the first origin predates the upgrade", () => {
    const checkout = join(root, "first-origin");
    execFileSync("git", ["init", "--quiet", checkout], { stdio: "ignore" });
    const facts = discoverGitIdentityFacts(checkout);
    const localId = computeProjectId(facts);
    const upgraded = upgrade((legacy) => {
      legacy
        .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
        .run(localId, "Local", checkout);
      legacy
        .prepare(
          "INSERT INTO runs (project_id, feature_id, command) VALUES (?, ?, ?)",
        )
        .run(localId, "fixture", "ship");
      execFileSync("git", [
        "-C",
        checkout,
        "remote",
        "add",
        "origin",
        "git@github.com:example/first-origin.git",
      ]);
    });
    try {
      expect(listCheckoutRuns("fixture", checkout, upgraded)).toMatchObject([
        { project_id: localId, command: "ship" },
      ]);
      const getRoot = upgraded
        .prepare("SELECT local_root FROM projects WHERE id = ?")
        .pluck();
      const getAliases = upgraded
        .prepare(
          "SELECT alias_id FROM project_aliases WHERE project_id = ? ORDER BY alias_id",
        )
        .pluck();
      expect.soft(getRoot.get(localId)).toBe(checkout);
      expect(getAliases.all(localId)).toEqual(
        computeLegacyProjectIds(facts)
          .filter((alias) => alias !== localId)
          .sort(),
      );
    } finally {
      upgraded.close();
    }
  });

  it("links verified legacy runs when the canonical checkout moved", () => {
    const checkout = join(root, "current-checkout");
    execFileSync("git", ["init", "--quiet", checkout]);
    execFileSync("git", [
      "-C",
      checkout,
      "remote",
      "add",
      "origin",
      "git@github.com:example/alpha.git",
    ]);
    const facts = discoverGitIdentityFacts(checkout);
    const canonical = computeProjectId(facts);
    const [legacyId] = computeLegacyProjectIds(facts);
    const upgraded = upgrade((legacy) => {
      const insert = legacy.prepare(
        "INSERT INTO projects (id, name, path, github_repo) VALUES (?, ?, ?, ?)",
      );
      insert.run(
        canonical,
        "Alpha",
        join(root, "old-checkout"),
        "example/alpha",
      );
      insert.run(legacyId, "Alpha legacy", checkout, "example/alpha");
      legacy
        .prepare(
          "INSERT INTO runs (project_id, feature_id, command) VALUES (?, 'shared', 'ship')",
        )
        .run(legacyId);
    });
    try {
      expect(listRuns("shared", canonical, upgraded)).toMatchObject([
        { project_id: legacyId, command: "ship" },
      ]);
      expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("keeps a compression-only path hash out of a new checkout owner's scope", () => {
    const checkout = join(root, "compression-checkout");
    execFileSync("git", ["init", "--quiet", checkout], { stdio: "ignore" });
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", checkout, ...args], { stdio: "ignore" });
    git("remote", "add", "origin", "git@github.com:example/alpha.git");
    const [alphaHash] = computeLegacyProjectIds(
      discoverGitIdentityFacts(checkout),
    );
    const betaOrigin = "git@github.com:example/beta.git";
    const betaId = computeProjectId({
      projectRoot: checkout,
      remoteOriginUrl: betaOrigin,
    });
    const upgraded = upgrade((legacy) => {
      legacy
        .prepare(`
        INSERT INTO compression (
          feature_id, phase_id, project_id, estimated_hours, actual_coding_hours,
          estimated_days, actual_delivery_days, point_compression,
          total_compression, merge_timestamp
        ) VALUES ('shared', 'phase', ?, 8, 1, 1, 1, 8, 1, '2026-11-11')
      `)
        .run(alphaHash);
      git("remote", "set-url", "origin", betaOrigin);
      legacy
        .prepare(
          "INSERT INTO projects (id, name, path, github_repo) VALUES (?, ?, ?, ?)",
        )
        .run(betaId, "Beta", checkout, "example/beta");
    });
    try {
      expect(
        upgraded
          .prepare("SELECT local_root FROM projects WHERE id = ?")
          .pluck()
          .get(betaId),
      ).toBe(checkout);
      expect
        .soft(
          upgraded
            .prepare(
              "SELECT project_id FROM project_aliases WHERE alias_id = ?",
            )
            .get(alphaHash),
        )
        .toBeUndefined();
      expect(
        listCompressionRecords("shared", alphaHash, upgraded),
      ).toMatchObject([{ project_id: alphaHash, point_compression: 8 }]);
      expect(listCompressionRecords("shared", betaId, upgraded)).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("does not bind a legacy path hash after the checkout changes origin", () => {
    const checkout = join(root, "reused-checkout");
    execFileSync("git", ["init", "--quiet", checkout], { stdio: "ignore" });
    execFileSync("git", [
      "-C",
      checkout,
      "remote",
      "add",
      "origin",
      "git@github.com:Example/Beta.git",
    ]);
    const [id] = computeLegacyProjectIds(discoverGitIdentityFacts(checkout));
    const upgraded = upgrade((legacy) => {
      legacy
        .prepare(
          "INSERT INTO projects (id, name, path, github_repo) VALUES (?, ?, ?, ?)",
        )
        .run(id, "Alpha", checkout, "example/alpha");
    });
    try {
      expect
        .soft(
          upgraded
            .prepare("SELECT local_root FROM projects WHERE id = ?")
            .pluck()
            .get(id),
        )
        .toBeNull();
      expect(
        upgraded
          .prepare("SELECT alias_id FROM project_aliases WHERE project_id = ?")
          .all(id),
      ).toEqual([]);
    } finally {
      upgraded.close();
    }
  });
});

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
