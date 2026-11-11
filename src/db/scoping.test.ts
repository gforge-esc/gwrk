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
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveProjectId } from "../adapters/git/project-id.js";
import { createSqliteProjectRegistryAdapter } from "../adapters/sqlite/index.js";
import { computeLegacyProjectIds } from "../domain/project-id.js";
import type {
  EnrolledProject,
  SlackActionReceipt,
} from "../domain/project-registry.js";
import {
  listRoutingDecisions,
  recordDecision,
} from "../server/routing-decisions.js";
import { getCompressionRecord } from "./compression.js";
import { getGateResult, recordGateResult } from "./gates.js";
import { getTestDb, openDatabase } from "./index.js";
import { listIssues, upsertIssue } from "./issues.js";
import {
  type PlanFeature,
  deleteFeature,
  getEdgesForFeature,
  getFeature,
  getPhase,
  getProposal,
  insertEdge,
  insertFeature,
  insertPhase,
  insertProposal,
  listFeatures,
} from "./plan.js";
import { listRuns, registerProject } from "./runs.js";

describe("Database Scoping (US-030 / FR-037 / FR-038 / TR-036)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should scope feature insertion and retrieval by projectId", () => {
    const f1: PlanFeature = {
      id: "F1",
      name: "Feat 1",
      status: "open",
      sp_total: 5,
    };
    const p1 = "proj-1";
    const p2 = "proj-2";

    insertFeature(f1, p1, db);
    insertFeature({ ...f1, id: "F2" }, p2, db);

    // Verify retrieval is scoped
    const result1 = getFeature("F1", p1, db);
    expect(result1).toBeDefined();
    expect(result1?.id).toBe("F1");

    const result2 = getFeature("F1", p2, db);
    expect(result2).toBeUndefined();
  });

  it("should scope listFeatures by projectId", () => {
    const p1 = "proj-1";
    const p2 = "proj-2";

    insertFeature(
      { id: "F1", name: "F1", status: "open", sp_total: 1 },
      p1,
      db,
    );
    insertFeature(
      { id: "F2", name: "F2", status: "open", sp_total: 1 },
      p2,
      db,
    );

    const list1 = listFeatures(p1, db);
    expect(list1).toHaveLength(1);
    expect(list1[0].id).toBe("F1");

    const list2 = listFeatures(p2, db);
    expect(list2).toHaveLength(1);
    expect(list2[0].id).toBe("F2");
  });
});

describe("Shared ledger project isolation", () => {
  const projectIds = ["project-one", "project-two"];
  const featureId = "001-shared-feature";
  const phaseId = "phase-01";
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
    const registry = createSqliteProjectRegistryAdapter({ db });
    for (const id of projectIds) {
      registry.enrollProject({
        projectId: id,
        slug: id,
        name: id,
        repoSlug: `fixtures/${id}`,
        trunkBranch: "develop",
        localRoot: `/fixtures/${id}`,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local"] },
        slack: null,
        legacyProjectIds: [],
        createdAt: "2026-11-11T12:00:00.000Z",
        updatedAt: "2026-11-11T12:00:00.000Z",
      });
      insertFeature(
        { id: featureId, name: id, status: "open", sp_total: 1 },
        id,
        db,
      );
    }
  });

  afterEach(() => db.close());

  it("keeps identical feature and phase IDs in both projects", () => {
    for (const id of projectIds) {
      insertPhase(
        {
          id: phaseId,
          feature_id: featureId,
          name: id,
          status: "open",
          health: "green",
          sp_estimate: 1,
          seq: 1,
        },
        id,
        db,
      );
      insertProposal(
        {
          id: "same-proposal",
          target_phase_id: phaseId,
          proposal_type: "UPDATE",
          detail: id,
          status: "PENDING",
        },
        id,
        db,
      );
      insertEdge(
        { from_id: "dependency", to_id: featureId, edge_type: "DEPENDS_ON" },
        id,
        db,
      );
      insertFeature(
        { id: featureId, name: id, status: "open", sp_total: 2 },
        id,
        db,
      );
      insertPhase({ ...getPhase(phaseId, id, db)!, name: id }, id, db);
    }
    for (const id of projectIds) {
      expect(getFeature(featureId, id, db)?.name).toBe(id);
      expect(getPhase(phaseId, id, db)?.name).toBe(id);
      expect(getProposal("same-proposal", id, db)?.detail).toBe(id);
      expect(getEdgesForFeature(featureId, id, db)).toHaveLength(1);
    }
    deleteFeature(featureId, projectIds[0], db);
    expect(getProposal("same-proposal", projectIds[0], db)).toBeUndefined();
    expect(getProposal("same-proposal", projectIds[1], db)?.detail).toBe(
      projectIds[1],
    );
    expect(getEdgesForFeature(featureId, projectIds[1], db)).toHaveLength(1);
  });

  it("keeps identical gate IDs in both projects", () => {
    for (const id of projectIds) {
      recordGateResult(
        {
          feature_id: featureId,
          phase_id: phaseId,
          task_id: "T001",
          gate_script: "verify.sh",
          passed: 1,
          exit_code: 0,
          output: id,
        },
        id,
        db,
      );
    }
    for (const id of projectIds) {
      expect(getGateResult(featureId, phaseId, "T001", id, db)?.output).toBe(
        id,
      );
    }
  });

  it("keeps identical issue numbers in both projects", () => {
    for (const id of projectIds) {
      upsertIssue(
        {
          issue_number: 1,
          feature_id: featureId,
          title: id,
          body: null,
          state: "open",
          created_at: "2026-11-11T12:00:00Z",
          author: "fixture",
        },
        id,
        db,
      );
    }
    for (const id of projectIds) {
      expect(listIssues(featureId, id, db).map(({ title }) => title)).toEqual([
        id,
      ]);
    }
  });
});

describe("Project registry storage", () => {
  const now = "2026-11-11T12:00:00.000Z";
  const project: EnrolledProject = {
    projectId: "canonical-project",
    slug: "pilot",
    name: "Pilot",
    repoSlug: "example/pilot",
    trunkBranch: "develop",
    localRoot: "/fixtures/pilot",
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["local"] },
    slack: null,
    legacyProjectIds: ["legacy-project"],
    createdAt: now,
    updatedAt: now,
  };

  it("reads a legacy feature through the canonical enrollment", async () => {
    const { createSqliteProjectRegistryAdapter } = await import(
      "../adapters/sqlite/index.js"
    );
    const db = getTestDb();
    try {
      registerProject(
        {
          id: "legacy-project",
          name: "Pilot",
          path: "/fixtures/pilot",
          github_repo: project.repoSlug,
        },
        db,
      );
      insertFeature(
        {
          id: "001-pilot",
          name: "Legacy feature",
          status: "open",
          sp_total: 1,
        },
        "legacy-project",
        db,
      );
      const registry = createSqliteProjectRegistryAdapter({ db });

      expect(registry.enrollProject(project).projectId).toBe(project.projectId);
      expect(registry.getProject("legacy-project")?.projectId).toBe(
        project.projectId,
      );
      expect(
        listFeatures(project.projectId, db).map(({ name }) => name),
      ).toEqual(["Legacy feature"]);
    } finally {
      db.close();
    }
  });

  it("transitions a verified local enrollment to its remote identity", () => {
    const checkout = mkdtempSync(join(tmpdir(), "gwrk-enrollment-"));
    const db = getTestDb();
    try {
      execFileSync("git", ["init", "--quiet", checkout], { stdio: "ignore" });
      const localId = resolveProjectId(checkout);
      const registry = createSqliteProjectRegistryAdapter({ db });
      registry.enrollProject({
        ...project,
        projectId: localId,
        repoSlug: null,
        localRoot: checkout,
      });
      registry.enrollProject({
        ...project,
        projectId: "unrelated",
        slug: "unrelated",
        repoSlug: "example/unrelated",
        legacyProjectIds: [],
      });
      insertFeature(
        { id: "shared", name: "Local feature", status: "open", sp_total: 1 },
        localId,
        db,
      );

      execFileSync("git", [
        "-C",
        checkout,
        "remote",
        "add",
        "origin",
        "https://github.com/example/pilot.git",
      ]);
      const remoteId = resolveProjectId(checkout);
      const remote = {
        ...project,
        projectId: remoteId,
        localRoot: checkout,
        legacyProjectIds: [localId],
      };
      expect(() =>
        registry.enrollProject({
          ...remote,
          legacyProjectIds: [localId, "unrelated"],
        }),
      ).toThrow(/already owned: unrelated/);
      expect(registry.getProject(localId)?.projectId).toBe(localId);
      expect(registry.getProject(remoteId)).toBeNull();
      expect(registry.getProject("legacy-project")?.projectId).toBe(localId);
      expect(registry.getProject("unrelated")?.projectId).toBe("unrelated");

      expect(registry.enrollProject(remote).projectId).toBe(remoteId);
      expect(registry.enrollProject(remote).projectId).toBe(remoteId);
      for (const id of [localId, remoteId, "legacy-project"]) {
        expect(registry.getProject(id)?.projectId).toBe(remoteId);
        expect(getFeature("shared", id, db)?.project_id).toBe(localId);
      }
      expect(registry.findByLocalRoot(checkout)?.projectId).toBe(remoteId);
      expect(
        registry
          .listProjects()
          .map(({ projectId }) => projectId)
          .sort(),
      ).toEqual([remoteId, "unrelated"].sort());
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally {
      db.close();
      rmSync(checkout, { recursive: true, force: true });
    }
  });

  it.each([
    { path: "/fixtures/other", repo: "example/other" },
    { path: "/fixtures/pilot", repo: "example/other" },
    { path: "/fixtures/other", repo: null },
    { path: "/fixtures/pilot", repo: null },
  ])(
    "rejects a legacy alias owned by another checkout at $path",
    ({ path, repo }) => {
      const db = getTestDb();
      try {
        registerProject(
          { id: "legacy-project", name: "Other", path, github_repo: repo },
          db,
        );
        insertFeature(
          {
            id: "001-pilot",
            name: "Other feature",
            status: "open",
            sp_total: 1,
          },
          "legacy-project",
          db,
        );
        const registry = createSqliteProjectRegistryAdapter({ db });

        expect(() => registry.enrollProject(project)).toThrow(
          /different repository or checkout/,
        );
        expect(registry.getProject(project.projectId)).toBeNull();
        expect(listFeatures(project.projectId, db)).toEqual([]);
        expect(
          listFeatures("legacy-project", db).map(({ name }) => name),
        ).toEqual(["Other feature"]);
      } finally {
        db.close();
      }
    },
  );

  it("rejects an alias claim over a gate without a project row", () => {
    const db = getTestDb();
    try {
      const registry = createSqliteProjectRegistryAdapter({ db });
      recordGateResult(
        {
          feature_id: "shared",
          phase_id: "phase",
          task_id: "task",
          gate_script: "beta.sh",
          passed: 1,
          exit_code: 0,
          output: "",
        },
        "beta",
        db,
      );

      expect(
        db.prepare("SELECT id FROM projects WHERE id = 'beta'").get(),
      ).toBeUndefined();
      expect
        .soft(() =>
          registry.enrollProject({ ...project, legacyProjectIds: ["beta"] }),
        )
        .toThrow(/different repository or checkout/);
      expect.soft(registry.getProject(project.projectId)).toBeNull();
      expect
        .soft(getGateResult("shared", "phase", "task", project.projectId, db))
        .toBeFalsy();
      expect(
        getGateResult("shared", "phase", "task", "beta", db)?.gate_script,
      ).toBe("beta.sh");
    } finally {
      db.close();
    }
  });

  it("rejects a canonical ID rebind and preserves its maintainer", () => {
    const db = getTestDb();
    try {
      const registry = createSqliteProjectRegistryAdapter({ db });
      registry.enrollProject(project);
      const binding = {
        projectId: project.projectId,
        principalType: "slack_user",
        principalId: "U123",
        role: "maintainer",
      } as const;
      registry.setRoleBinding(binding);

      expect
        .soft(() =>
          registry.enrollProject({
            ...project,
            repoSlug: "example/beta",
            localRoot: "/fixtures/beta",
          }),
        )
        .toThrow(/different repository or checkout/);
      expect.soft(registry.getProject(project.projectId)).toMatchObject({
        repoSlug: project.repoSlug,
        localRoot: project.localRoot,
      });
      expect(registry.listRoleBindings(project.projectId)).toEqual([binding]);
    } finally {
      db.close();
    }
  });

  it.each([true, false])(
    "rejects ambiguous alias and slug lookup when the alias is enrolled first: %s",
    (aliasFirst) => {
      const db = getTestDb();
      try {
        const registry = createSqliteProjectRegistryAdapter({ db });
        const alpha = { ...project, legacyProjectIds: ["route"] };
        const gamma = {
          ...project,
          projectId: "gamma",
          slug: "route",
          repoSlug: "example/gamma",
          localRoot: "/fixtures/gamma",
          legacyProjectIds: [],
        };
        for (const item of aliasFirst ? [alpha, gamma] : [gamma, alpha]) {
          registry.enrollProject(item);
        }

        expect(registry.getProject("route")).toBeNull();
        expect(registry.getProject(alpha.projectId)?.projectId).toBe(
          alpha.projectId,
        );
        expect(registry.getProject(gamma.projectId)?.projectId).toBe(
          gamma.projectId,
        );
      } finally {
        db.close();
      }
    },
  );

  it.each([
    { mirror: false, storedOrigin: null },
    { mirror: true, storedOrigin: null },
    { mirror: false, storedOrigin: "https://github.com/example/beta.git" },
  ])(
    "rejects a legacy claim with conflicting Git origin: %j",
    ({ mirror, storedOrigin }) => {
      const checkout = mkdtempSync(join(tmpdir(), "gwrk-alias-origin-"));
      const db = getTestDb();
      try {
        const init = ["init", "--quiet"];
        if (mirror) init.push("--bare");
        execFileSync("git", [...init, checkout], { stdio: "ignore" });
        execFileSync("git", [
          "-C",
          checkout,
          "remote",
          "add",
          "origin",
          "https://github.com/example/alpha.git",
        ]);
        let storedPath = "/fixtures/beta";
        const claimedRepo = storedOrigin ? "example/alpha" : "example/beta";
        if (storedOrigin) {
          storedPath = join(checkout, "stored");
          execFileSync("git", ["init", "--quiet", storedPath], {
            stdio: "ignore",
          });
          execFileSync("git", [
            "-C",
            storedPath,
            "remote",
            "add",
            "origin",
            storedOrigin,
          ]);
        }
        registerProject(
          {
            id: "beta-legacy",
            name: "Beta",
            path: storedPath,
            github_repo: claimedRepo,
          },
          db,
        );
        insertFeature(
          { id: "shared", name: "Beta feature", status: "open", sp_total: 1 },
          "beta-legacy",
          db,
        );
        const registry = createSqliteProjectRegistryAdapter({ db });
        const alphaId = resolveProjectId(checkout);

        expect
          .soft(() =>
            registry.enrollProject({
              ...project,
              projectId: alphaId,
              localRoot: mirror ? null : checkout,
              mirrorPath: mirror ? checkout : null,
              repoSlug: claimedRepo,
              legacyProjectIds: ["beta-legacy"],
            }),
          )
          .toThrow(/different repository or checkout/);
        expect.soft(registry.getProject(alphaId)).toBeNull();
        expect.soft(listFeatures(alphaId, db)).toEqual([]);
        expect(getFeature("shared", "beta-legacy", db)?.name).toBe(
          "Beta feature",
        );
      } finally {
        db.close();
        rmSync(checkout, { recursive: true, force: true });
      }
    },
  );

  it("accepts a legacy alias from a moved checkout of the same repository", () => {
    const db = getTestDb();
    try {
      registerProject(
        {
          id: "legacy-project",
          name: "Pilot",
          path: "/fixtures/previous",
          github_repo: "example/pilot",
        },
        db,
      );
      const registry = createSqliteProjectRegistryAdapter({ db });
      expect(registry.enrollProject(project).legacyProjectIds).toContain(
        "legacy-project",
      );
    } finally {
      db.close();
    }
  });

  it("accepts a verified legacy hash from another checkout of the same origin", () => {
    const root = mkdtempSync(join(tmpdir(), "gwrk-moved-checkout-"));
    const db = getTestDb();
    try {
      const previous = join(root, "previous");
      const checkout = join(root, "current");
      for (const path of [previous, checkout]) {
        execFileSync("git", ["init", "--quiet", path], { stdio: "ignore" });
        execFileSync("git", [
          "-C",
          path,
          "remote",
          "add",
          "origin",
          "https://github.com/example/pilot.git",
        ]);
      }
      const [legacyId] = computeLegacyProjectIds({ projectRoot: previous });
      registerProject({ id: legacyId, name: "Previous", path: previous }, db);
      insertFeature(
        { id: "shared", name: "Previous feature", status: "open", sp_total: 1 },
        legacyId,
        db,
      );

      const projectId = resolveProjectId(checkout);
      const registry = createSqliteProjectRegistryAdapter({ db });
      registry.enrollProject({
        ...project,
        projectId,
        localRoot: checkout,
        legacyProjectIds: [legacyId],
      });
      expect(registry.getProject(legacyId)?.projectId).toBe(projectId);
      expect(getFeature("shared", projectId, db)?.name).toBe(
        "Previous feature",
      );
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps roles, feature threads and routing decisions in project scope", () => {
    const db = getTestDb();
    try {
      const registry = createSqliteProjectRegistryAdapter({ db });
      const slack = { workspaceId: "T1", channelId: "C1", sharedChannel: true };
      const first = registry.enrollProject({ ...project, slack });
      const second = registry.enrollProject({
        ...project,
        projectId: "second",
        slug: "second",
        repoSlug: "example/second",
        localRoot: "/fixtures/second",
        legacyProjectIds: [],
        slack: { ...slack, workspaceId: "T2" },
      });
      expect(registry.getProject(project.slug)).toEqual(first);
      expect(registry.findByRepoSlug(project.repoSlug!)).toEqual(first);
      expect(registry.findByLocalRoot(project.localRoot!)).toEqual(first);
      expect(registry.listBySlackChannel("T1", "C1")).toEqual([first]);

      expect(() =>
        registry.enrollProject({
          ...second,
          legacyProjectIds: project.legacyProjectIds,
        }),
      ).toThrow("already owned");
      expect(registry.getProject(project.legacyProjectIds[0])).toEqual(first);

      for (const item of [first, second]) {
        const id = item.projectId;
        registry.setRoleBinding({
          projectId: id,
          principalType: "slack_user",
          principalId: "fixture",
          role: id === first.projectId ? "maintainer" : "viewer",
        });
        registry.bindFeatureThread({
          projectId: id,
          featureId: "001-pilot",
          workspaceId: item.slack!.workspaceId,
          channelId: "C1",
          rootTs: id,
          updatedAt: now,
        });
        recordDecision(
          {
            projectId: id,
            runId: "shared-run",
            feature: "001-pilot",
            phase: "phase-01",
            reason: id,
            selectedBackend: "fixture",
            probeStatus: "fresh",
          },
          db,
        );
      }
      const alias = project.legacyProjectIds[0];
      expect(registry.listRoleBindings(alias)[0]?.role).toBe("maintainer");
      expect(registry.listRoleBindings(second.projectId)[0]?.role).toBe(
        "viewer",
      );
      expect(registry.getFeatureThread(alias, "001-pilot")?.rootTs).toBe(
        first.projectId,
      );
      expect(
        registry.getFeatureThread(second.projectId, "001-pilot")?.rootTs,
      ).toBe(second.projectId);
      expect(
        listRoutingDecisions(alias, "shared-run", db).map(
          ({ reason }) => reason,
        ),
      ).toEqual([first.projectId]);
      expect(
        listRoutingDecisions(second.projectId, "shared-run", db).map(
          ({ reason }) => reason,
        ),
      ).toEqual([second.projectId]);
      registry.close();
      expect(db.open).toBe(true);
    } finally {
      db.close();
    }
  });

  it("grants one receipt claim across two database connections", async () => {
    const { createSqliteProjectRegistryAdapter } = await import(
      "../adapters/sqlite/index.js"
    );
    const root = mkdtempSync(join(tmpdir(), "gwrk-action-receipts-"));
    const dbPath = join(root, "registry.sqlite");
    const first = openDatabase({ dbPath });
    const second = openDatabase({ dbPath });
    try {
      const owner = createSqliteProjectRegistryAdapter({ db: first });
      const duplicate = createSqliteProjectRegistryAdapter({ db: second });
      owner.enrollProject(project);
      const receipt: SlackActionReceipt = {
        receiptKey: "verified-action",
        projectId: project.projectId,
        actionId: "merge_pr",
        featureId: "001-pilot",
        phaseId: null,
        messageTs: "1731320500.000100",
        actorUserId: "U_MAINTAINER",
        outcome: "claimed",
        recordedAt: now,
      };
      expect(owner.claimActionReceipt(receipt)).toBe(true);
      expect(duplicate.claimActionReceipt(receipt)).toBe(false);
      expect(duplicate.getActionReceipt(receipt.receiptKey)?.outcome).toBe(
        "claimed",
      );
      expect(owner.completeActionReceipt(receipt.receiptKey, "executed")).toBe(
        true,
      );
      expect(duplicate.claimActionReceipt(receipt)).toBe(false);
      expect(duplicate.getActionReceipt(receipt.receiptKey)?.outcome).toBe(
        "executed",
      );
    } finally {
      first.close();
      second.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Migration 014", () => {
  it("rolls back a failed upgrade and preserves legacy rows when retried", () => {
    const root = mkdtempSync(join(tmpdir(), "gwrk-registry-migration-"));
    const dbPath = join(root, "ledger.sqlite");
    const migrationsDir = join(root, "migrations");
    const source = new URL("./migrations/", import.meta.url);
    const migration = "014-project-registry-and-composite-keys.sql";
    try {
      mkdirSync(migrationsDir);
      for (const file of readdirSync(source)) {
        if (file.endsWith(".sql") && file < migration) {
          copyFileSync(new URL(file, source), join(migrationsDir, file));
        }
      }
      const old = openDatabase({ dbPath, migrationsDir });
      try {
        old.exec(`
          INSERT INTO projects (id, name, path, github_repo) VALUES ('local', 'Legacy checkout', '/fixtures/legacy', 'fixtures/legacy');
          INSERT INTO runs (id, feature_id, phase_id, project_id, command)
            VALUES (1, 'feature', 'phase', 'local', 'ship');
          INSERT INTO history (project_id, feature_id, run_id) VALUES ('local', 'feature', 1);
          INSERT INTO plan_features (id, name, project_id) VALUES ('feature', 'Legacy feature', 'local');
          INSERT INTO plan_phases (id, feature_id, name, seq) VALUES ('phase', 'feature', 'Legacy phase', 1);
          INSERT INTO plan_proposals (id, target_phase_id, proposal_type) VALUES ('proposal', 'phase', 'UPDATE');
          INSERT INTO plan_edges (from_id, to_id, edge_type) VALUES ('dependency', 'feature', 'DEPENDS_ON');
          INSERT INTO gate_results (feature_id, phase_id, task_id, gate_script)
            VALUES ('feature', 'phase', 'T001', 'verify.sh');
          INSERT INTO issues (issue_number, feature_id, title, created_at, author)
            VALUES (1, 'unattributed', 'Unattributed issue', '2026-11-11', 'fixture');
          INSERT INTO compression (
            feature_id, phase_id, project_id, estimated_hours, actual_coding_hours,
            estimated_days, actual_delivery_days, point_compression, total_compression, merge_timestamp
          ) VALUES ('feature', 'phase', 'local', 8, 1, 1, 1, 8, 1, '2026-11-11');
          INSERT INTO routing_decisions (run_id, feature, phase, selected_backend, reason, probe_status)
            VALUES ('1', 'feature', 'phase', 'fixture', 'legacy routing', 'fresh');
        `);
      } finally {
        old.close();
      }

      const file = join(migrationsDir, migration);
      const sql = readFileSync(new URL(migration, source), "utf8");
      writeFileSync(
        file,
        sql.replace("COMMIT;", "SELECT * FROM injected_failure; COMMIT;"),
      );
      expect(() => openDatabase({ dbPath, migrationsDir })).toThrow(
        "injected_failure",
      );

      const unchanged = new Database(dbPath, { readonly: true });
      try {
        expect(
          unchanged.prepare("SELECT project_id FROM plan_phases").pluck().get(),
        ).toBeNull();
        expect(
          unchanged
            .prepare(
              "SELECT name FROM sqlite_master WHERE name = 'project_aliases'",
            )
            .get(),
        ).toBeUndefined();
      } finally {
        unchanged.close();
      }

      writeFileSync(file, sql);
      const upgraded = openDatabase({ dbPath, migrationsDir });
      try {
        expect(upgraded.pragma("foreign_keys", { simple: true })).toBe(1);
        expect(upgraded.pragma("foreign_key_check")).toEqual([]);
        expect(listRuns("feature", "local", upgraded)).toHaveLength(1);
        expect(getPhase("phase", "local", upgraded)?.name).toBe("Legacy phase");
        expect(
          getProposal("proposal", "local", upgraded)?.target_phase_id,
        ).toBe("phase");
        expect(getEdgesForFeature("feature", "local", upgraded)).toHaveLength(
          1,
        );
        expect(
          getGateResult("feature", "phase", "T001", "local", upgraded)
            ?.gate_script,
        ).toBe("verify.sh");
        expect(
          listIssues("unattributed", "legacy-local", upgraded),
        ).toHaveLength(1);
        expect(listRoutingDecisions("local", "1", upgraded)).toHaveLength(1);

        const checkout = "/fixtures/legacy";
        const [pathAlias] = computeLegacyProjectIds({ projectRoot: checkout });
        registerProject(
          {
            id: pathAlias,
            name: "Legacy path key",
            path: checkout,
            github_repo: "fixtures/legacy",
          },
          upgraded,
        );
        const registry = createSqliteProjectRegistryAdapter({ db: upgraded });
        registry.enrollProject({
          projectId: "remote",
          slug: "legacy",
          name: "Legacy checkout",
          repoSlug: "fixtures/legacy",
          trunkBranch: "develop",
          localRoot: checkout,
          mirrorPath: null,
          runnerPolicy: { allowedKinds: ["local"] },
          slack: null,
          legacyProjectIds: ["local", pathAlias],
          createdAt: "2026-11-11T12:00:00.000Z",
          updatedAt: "2026-11-11T12:00:00.000Z",
        });
        expect(registry.getProject(pathAlias)?.projectId).toBe("remote");
        expect(listRuns("feature", "remote", upgraded)).toHaveLength(1);
        expect(
          getCompressionRecord("feature", "phase", "remote", upgraded)
            ?.point_compression,
        ).toBe(8);
        expect(
          getGateResult("feature", "phase", "T001", "remote", upgraded)
            ?.gate_script,
        ).toBe("verify.sh");
        expect(listRoutingDecisions("remote", "1", upgraded)).toHaveLength(1);
        expect(listIssues("unattributed", "remote", upgraded)).toEqual([]);
      } finally {
        upgraded.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
