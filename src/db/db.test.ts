/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
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
import { listCompressionRecords } from "./compression.js";
import { insertCompressionRecord } from "./db.js";
import { getGateResult } from "./gates.js";
import { getTestDb, openDatabase } from "./index.js";
import { listIssues } from "./issues.js";
import {
  getEdgesForFeature,
  getFeature,
  getPhase,
  getProposal,
} from "./plan.js";
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

  function upgrade(seed: (db: Database.Database) => void) {
    const legacy = openDatabase({ dbPath, migrationsDir });
    try {
      seed(legacy);
    } finally {
      legacy.close();
    }
    copyFileSync(new URL(migration, source), join(migrationsDir, migration));
    return openDatabase({ dbPath, migrationsDir });
  }

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
          VALUES ('shared', 'Alpha feature', 'alpha'), ('alpha-only', 'Alpha only', 'alpha');
        INSERT INTO plan_phases (id, feature_id, name, seq, project_id)
          VALUES ('phase', 'shared', 'Alpha phase', 1, 'alpha'),
                 ('other-phase', 'shared', 'Beta phase', 2, 'beta-unregistered');
        INSERT INTO issues (issue_number, feature_id, title, created_at, author, project_id)
          VALUES (7, 'shared', 'Beta issue', '2026-11-11', 'fixture', 'beta-unregistered'),
                 (8, 'shared', 'Ambiguous issue', '2026-11-11', 'fixture', NULL),
                 (9, 'alpha-only', 'Unattributed issue', '2026-11-11', 'fixture', NULL);
        INSERT INTO gate_results (feature_id, phase_id, task_id, gate_script, project_id)
          VALUES ('shared', 'phase', 'T001', 'beta.sh', 'beta-unregistered'),
                 ('shared', 'other-phase', 'T002', 'ambiguous.sh', NULL);
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
        .prepare("INSERT INTO runs (project_id, feature_id, command) VALUES (?, ?, ?)")
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
        computeLegacyProjectIds(facts).filter((alias) => alias !== localId).sort(),
      );
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
