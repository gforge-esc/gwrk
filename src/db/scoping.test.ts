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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoverGitIdentityFacts,
  resolveProjectId,
} from "../adapters/git/project-id.js";
import { createSqliteProjectRegistryAdapter } from "../adapters/sqlite/index.js";
import {
  computeLegacyProjectIds,
  computeProjectId,
} from "../domain/project-id.js";
import {
  type EnrolledProject,
  type SlackActionReceipt,
  buildActionReceiptKey,
} from "../domain/project-registry.js";
import {
  listRoutingDecisions,
  recordDecision,
} from "../server/routing-decisions.js";
import { getCompressionRecord } from "./compression.js";
import {
  getAllGateResults,
  getGateResult,
  getGateResults,
  recordGateResult,
} from "./gates.js";
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
import { listRuns, registerProject, startRun } from "./runs.js";

function initCheckout(parent: string, name: string, repoSlug: string): string {
  const checkout = join(parent, name);
  execFileSync("git", ["init", "--quiet", checkout], { stdio: "ignore" });
  execFileSync("git", [
    "-C",
    checkout,
    "remote",
    "add",
    "origin",
    `https://github.com/${repoSlug}.git`,
  ]);
  return checkout;
}

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
  let projectIds: string[];
  let root: string;
  const featureId = "001-shared-feature";
  const phaseId = "phase-01";
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
    const registry = createSqliteProjectRegistryAdapter({ db });
    root = mkdtempSync(join(tmpdir(), "gwrk-shared-ledger-"));
    projectIds = ["project-one", "project-two"].map((name) => {
      const repoSlug = `fixtures/${name}`;
      const localRoot = initCheckout(root, name, repoSlug);
      const id = resolveProjectId(localRoot);
      registry.enrollProject({
        projectId: id,
        slug: name,
        name,
        repoSlug,
        trunkBranch: "develop",
        localRoot,
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
      return id;
    });
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

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
  let root: string;
  let project: EnrolledProject;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gwrk-registry-fixtures-"));
    const repoSlug = "example/pilot";
    const localRoot = initCheckout(root, "pilot", repoSlug);
    project = {
      projectId: resolveProjectId(localRoot),
      slug: "pilot",
      name: "Pilot",
      repoSlug,
      trunkBranch: "develop",
      localRoot,
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local"] },
      slack: null,
      legacyProjectIds: ["legacy-project"],
      createdAt: now,
      updatedAt: now,
    };
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

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
          path: project.localRoot!,
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

  it("rejects a foreign Git ID before its checkout has any ledger records", () => {
    const root = mkdtempSync(join(tmpdir(), "gwrk-unclaimed-alias-"));
    const db = getTestDb();
    try {
      const registry = createSqliteProjectRegistryAdapter({ db });
      function checkout(name: string) {
        const localRoot = join(root, name);
        const repoSlug = `example/${name}`;
        execFileSync("git", ["init", "--quiet", localRoot], {
          stdio: "ignore",
        });
        execFileSync("git", [
          "-C",
          localRoot,
          "remote",
          "add",
          "origin",
          `https://github.com/${repoSlug}.git`,
        ]);
        return {
          ...project,
          projectId: resolveProjectId(localRoot),
          slug: name,
          localRoot,
          repoSlug,
          legacyProjectIds: [],
        };
      }
      const alpha = checkout("alpha");
      const beta = checkout("beta");
      expect
        .soft(() =>
          registry.enrollProject({
            ...alpha,
            legacyProjectIds: [beta.projectId],
          }),
        )
        .toThrow(/different repository or checkout/);
      expect.soft(registry.getProject(alpha.projectId)).toBeNull();
      expect.soft(registry.getProject(beta.projectId)).toBeNull();
      expect(registry.enrollProject(beta).projectId).toBe(beta.projectId);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a foreign local path even with a verified mirror", () => {
    const root = mkdtempSync(join(tmpdir(), "gwrk-mixed-enrollment-"));
    const db = getTestDb();
    try {
      const mirrorPath = join(root, "alpha.git");
      const beta = join(root, "beta");
      for (const [checkout, name, flags] of [
        [mirrorPath, "alpha", ["--bare"]],
        [beta, "beta", []],
      ] as const) {
        execFileSync("git", ["init", "--quiet", ...flags, checkout]);
        execFileSync("git", [
          "-C",
          checkout,
          "remote",
          "add",
          "origin",
          `https://github.com/example/${name}.git`,
        ]);
      }
      const localRoot = join(beta, "nested");
      mkdirSync(localRoot);
      const registry = createSqliteProjectRegistryAdapter({ db });
      const enrollment = {
        ...project,
        projectId: resolveProjectId(mirrorPath),
        repoSlug: "example/alpha",
        localRoot,
        mirrorPath,
        legacyProjectIds: [],
      };

      expect
        .soft(() => registry.enrollProject(enrollment))
        .toThrow(/different repository or checkout/);
      expect.soft(registry.findByLocalRoot(localRoot)).toBeNull();
      expect.soft(db.prepare("SELECT id FROM projects").all()).toEqual([]);
      expect
        .soft(db.prepare("SELECT alias_id FROM project_aliases").all())
        .toEqual([]);
      expect(
        registry.enrollProject({ ...enrollment, localRoot: null }).projectId,
      ).toBe(enrollment.projectId);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    {
      storedBinding: "localRoot",
      incomingBinding: "localRoot",
      symlink: false,
    },
    {
      storedBinding: "localRoot",
      incomingBinding: "mirrorPath",
      symlink: true,
    },
    {
      storedBinding: "mirrorPath",
      incomingBinding: "localRoot",
      symlink: true,
    },
    {
      storedBinding: "mirrorPath",
      incomingBinding: "mirrorPath",
      symlink: false,
    },
  ] as const)(
    "rejects a reused checkout from $storedBinding to $incomingBinding with symlink=$symlink",
    ({ storedBinding, incomingBinding, symlink }) => {
      const db = getTestDb();
      try {
        const checkout = initCheckout(root, "shared-checkout", "example/alpha");
        const alternatePath = join(root, "checkout-link");
        symlinkSync(checkout, alternatePath, "dir");
        const registry = createSqliteProjectRegistryAdapter({ db });
        const alpha = registry.enrollProject({
          ...project,
          projectId: resolveProjectId(checkout),
          slug: "alpha",
          repoSlug: "example/alpha",
          localRoot: null,
          mirrorPath: null,
          [storedBinding]: checkout,
          slack: { workspaceId: "W1", channelId: "C1", sharedChannel: false },
          legacyProjectIds: [],
        });

        execFileSync("git", [
          "-C",
          checkout,
          "remote",
          "set-url",
          "origin",
          "https://github.com/example/beta.git",
        ]);
        const betaId = resolveProjectId(checkout);
        expect
          .soft(() =>
            registry.enrollProject({
              ...alpha,
              projectId: betaId,
              slug: "beta",
              repoSlug: "example/beta",
              localRoot: null,
              mirrorPath: null,
              [incomingBinding]: symlink ? alternatePath : checkout,
              slack: {
                workspaceId: "W1",
                channelId: "C2",
                sharedChannel: false,
              },
            }),
          )
          .toThrow(/already bound/);

        expect.soft(registry.getProject(betaId)).toBeNull();
        expect.soft(registry.listBySlackChannel("W1", "C2")).toEqual([]);
        expect(registry.listBySlackChannel("W1", "C1")).toEqual([alpha]);
      } finally {
        db.close();
      }
    },
  );

  it("rejects a foreign canonical ID claimed from a missing checkout", () => {
    const root = mkdtempSync(join(tmpdir(), "gwrk-unverified-canonical-"));
    const db = getTestDb();
    try {
      const localRoot = join(root, "beta");
      execFileSync("git", ["init", "--quiet", localRoot], { stdio: "ignore" });
      execFileSync("git", [
        "-C",
        localRoot,
        "remote",
        "add",
        "origin",
        "https://github.com/example/beta.git",
      ]);
      const projectId = resolveProjectId(localRoot);
      const registry = createSqliteProjectRegistryAdapter({ db });

      expect
        .soft(() =>
          registry.enrollProject({
            ...project,
            projectId,
            localRoot: join(root, "missing"),
            legacyProjectIds: [],
          }),
        )
        .toThrow(/different repository or checkout/);
      expect.soft(registry.getProject(projectId)).toBeNull();
      expect.soft(db.prepare("SELECT id FROM projects").all()).toEqual([]);
      expect
        .soft(db.prepare("SELECT alias_id FROM project_aliases").all())
        .toEqual([]);
      expect(
        registry.enrollProject({
          ...project,
          projectId,
          localRoot,
          repoSlug: "example/beta",
          legacyProjectIds: [],
        }).projectId,
      ).toBe(projectId);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an occupied remote checkout hash without historical provenance", () => {
    const checkout = mkdtempSync(join(tmpdir(), "gwrk-unproven-path-hash-"));
    const db = getTestDb();
    try {
      execFileSync("git", ["init", "--quiet", checkout], { stdio: "ignore" });
      execFileSync("git", [
        "-C",
        checkout,
        "remote",
        "add",
        "origin",
        "https://github.com/example/pilot.git",
      ]);
      const [legacyId] = computeLegacyProjectIds({ projectRoot: checkout });
      registerProject(
        { id: legacyId, name: "Prior checkout", path: checkout },
        db,
      );
      insertFeature(
        { id: "shared", name: "Prior feature", status: "open", sp_total: 1 },
        legacyId,
        db,
      );
      const registry = createSqliteProjectRegistryAdapter({ db });
      const projectId = resolveProjectId(checkout);
      expect
        .soft(() =>
          registry.enrollProject({
            ...project,
            projectId,
            localRoot: checkout,
            legacyProjectIds: [legacyId],
          }),
        )
        .toThrow(/different repository or checkout/);
      expect.soft(registry.getProject(projectId)).toBeNull();
      expect.soft(getFeature("shared", projectId, db)).toBeUndefined();
      expect(getFeature("shared", legacyId, db)?.name).toBe("Prior feature");
    } finally {
      db.close();
      rmSync(checkout, { recursive: true, force: true });
    }
  });

  it.each([
    { enrolled: false, suffixed: false },
    { enrolled: false, suffixed: true },
    { enrolled: true, suffixed: true },
  ])("enrolls a pre-origin run with %j", ({ enrolled, suffixed }) => {
    const checkout = mkdtempSync(join(tmpdir(), "gwrk-pre-origin-run-"));
    const db = getTestDb();
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(checkout);
    try {
      execFileSync("git", ["init", "--quiet", checkout]);
      const localId = resolveProjectId(checkout);
      const registry = createSqliteProjectRegistryAdapter({ db });
      if (enrolled) {
        registry.enrollProject({
          ...project,
          projectId: localId,
          repoSlug: null,
          localRoot: checkout,
          legacyProjectIds: [],
        });
      }
      const runId = startRun({ feature_id: "shared", command: "local" }, db);
      if (suffixed) {
        db.prepare(
          "UPDATE projects SET path = ?, local_root = NULL WHERE id = ?",
        ).run(`${checkout}#${localId}`, localId);
      }
      expect(listRuns("shared", localId, db)).toMatchObject([{ id: runId }]);

      execFileSync("git", [
        "-C",
        checkout,
        "remote",
        "add",
        "origin",
        "https://github.com/example/pilot.git",
      ]);
      const remoteId = resolveProjectId(checkout);
      const enrollment = {
        ...project,
        projectId: remoteId,
        localRoot: checkout,
        legacyProjectIds: [localId],
      };
      const setRepository = db.prepare(
        "UPDATE projects SET github_repo = ? WHERE id = ?",
      );
      setRepository.run("example/other", localId);
      expect(() => registry.enrollProject(enrollment)).toThrow(
        /different repository or checkout|already owned/,
      );
      expect(registry.getProject(remoteId)).toBeNull();
      expect(listRuns("shared", localId, db)).toMatchObject([{ id: runId }]);
      setRepository.run(null, localId);

      expect(registry.enrollProject(enrollment).projectId).toBe(remoteId);
      for (const id of [localId, remoteId]) {
        expect(registry.getProject(id)?.projectId).toBe(remoteId);
        expect(listRuns("shared", id, db)).toMatchObject([
          { id: runId, project_id: localId },
        ]);
      }
    } finally {
      cwd.mockRestore();
      db.close();
      rmSync(checkout, { recursive: true, force: true });
    }
  });

  it("transitions a migrated path-hash owner through its verified local Git alias", () => {
    const checkout = realpathSync(
      mkdtempSync(join(tmpdir(), "gwrk-migrated-hash-")),
    );
    const migrationsDir = join(checkout, "migrations");
    const dbPath = join(checkout, "ledger.sqlite");
    const source = new URL("./migrations/", import.meta.url);
    const migration = "014-project-registry-and-composite-keys.sql";
    let upgraded: Database.Database | undefined;
    try {
      execFileSync("git", ["init", "--quiet", checkout]);
      const facts = discoverGitIdentityFacts(checkout);
      const localId = computeProjectId(facts);
      const [hashId] = computeLegacyProjectIds(facts);
      mkdirSync(migrationsDir);
      for (const file of readdirSync(source)) {
        if (file.endsWith(".sql") && file < migration) {
          copyFileSync(new URL(file, source), join(migrationsDir, file));
        }
      }
      const legacy = openDatabase({ dbPath, migrationsDir });
      let runId: number;
      try {
        legacy
          .prepare(
            "INSERT INTO projects (id, name, path) VALUES (?, 'Local', ?)",
          )
          .run(hashId, `${checkout}#${hashId}`);
        runId = Number(
          legacy
            .prepare(
              "INSERT INTO runs (project_id, feature_id, command) VALUES (?, 'shared', 'local')",
            )
            .run(hashId).lastInsertRowid,
        );
      } finally {
        legacy.close();
      }
      for (const file of readdirSync(source)) {
        if (file.endsWith(".sql") && file >= migration) {
          copyFileSync(new URL(file, source), join(migrationsDir, file));
        }
      }
      const ledger = openDatabase({ dbPath, migrationsDir });
      upgraded = ledger;
      expect(listRuns("shared", localId, ledger)).toMatchObject([
        { id: runId, project_id: hashId },
      ]);
      execFileSync("git", [
        "-C",
        checkout,
        "remote",
        "add",
        "origin",
        "https://github.com/example/pilot.git",
      ]);
      const remoteFacts = discoverGitIdentityFacts(checkout);
      const remoteId = computeProjectId(remoteFacts);
      const registry = createSqliteProjectRegistryAdapter({ db: ledger });
      const enrollment = {
        ...project,
        projectId: remoteId,
        localRoot: checkout,
        legacyProjectIds: computeLegacyProjectIds(remoteFacts),
      };
      const setRepository = ledger.prepare(
        "UPDATE projects SET github_repo = ? WHERE id = ?",
      );
      setRepository.run("example/other", hashId);
      expect(() => registry.enrollProject(enrollment)).toThrow(
        /different repository or checkout/,
      );
      expect(registry.getProject(remoteId)).toBeNull();
      expect(listRuns("shared", localId, ledger)).toMatchObject([
        { id: runId, project_id: hashId },
      ]);
      setRepository.run(null, hashId);

      expect(registry.enrollProject(enrollment).projectId).toBe(remoteId);
      for (const id of [hashId, localId, remoteId]) {
        expect(registry.getProject(id)?.projectId).toBe(remoteId);
        expect(listRuns("shared", id, ledger)).toMatchObject([
          { id: runId, project_id: hashId },
        ]);
      }
    } finally {
      upgraded?.close();
      rmSync(checkout, { recursive: true, force: true });
    }
  });

  it("serializes a role downgrade with enrollment on a second connection", () => {
    const checkout = join(root, "role-transition");
    const dbPath = join(root, "role-transition.sqlite");
    const db = openDatabase({ dbPath });
    const other = openDatabase({ dbPath });
    const registry = createSqliteProjectRegistryAdapter({ db });
    const remoteRegistry = createSqliteProjectRegistryAdapter({ db: other });
    try {
      execFileSync("git", ["init", "--quiet", checkout]);
      const localId = resolveProjectId(checkout);
      const local = {
        ...project,
        projectId: localId,
        localRoot: checkout,
        repoSlug: null,
        legacyProjectIds: [],
      };
      registry.enrollProject(local);
      const binding = {
        projectId: localId,
        principalId: "U1",
        principalType: "slack_user" as const,
        role: "maintainer" as const,
      };
      registry.setRoleBinding(binding);
      execFileSync("git", [
        "-C",
        checkout,
        "remote",
        "add",
        "origin",
        "git@github.com:example/alpha.git",
      ]);
      const remoteId = resolveProjectId(checkout);
      const enroll = () =>
        remoteRegistry.enrollProject({
          ...local,
          projectId: remoteId,
          repoSlug: "example/alpha",
        });
      other.pragma("busy_timeout = 0");
      let raced = false;
      let writerWasLocked = false;
      const prepare = db.prepare.bind(db);
      const spy = vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
        const statement = prepare(sql);
        if (
          sql.includes(
            "VALUES (@projectId, @principalType, @principalId, @role)",
          )
        ) {
          const run = statement.run.bind(statement);
          vi.spyOn(statement, "run").mockImplementation((...args) => {
            raced = true;
            try {
              enroll();
            } catch (error) {
              if ((error as Database.SqliteError).code !== "SQLITE_BUSY")
                throw error;
              writerWasLocked = true;
            }
            return run(...args);
          });
        }
        return statement;
      }) as typeof db.prepare);
      try {
        registry.setRoleBinding({ ...binding, role: "viewer" });
      } finally {
        spy.mockRestore();
      }
      expect.soft(raced).toBe(true);
      expect.soft(writerWasLocked).toBe(true);
      if (writerWasLocked) enroll();
      for (const id of [localId, remoteId]) {
        expect
          .soft(remoteRegistry.listRoleBindings(id))
          .toMatchObject([{ role: "viewer" }]);
      }
      remoteRegistry.setRoleBinding({ ...binding, projectId: remoteId });
      registry.setRoleBinding({ ...binding, role: "viewer" });
      for (const id of [localId, remoteId]) {
        expect(remoteRegistry.listRoleBindings(id)).toMatchObject([
          { role: "viewer" },
        ]);
      }
    } finally {
      other.close();
      db.close();
    }
  });

  it("serializes a feature thread write with enrollment on a second connection", () => {
    const checkout = join(root, "thread-transition");
    const dbPath = join(root, "thread-transition.sqlite");
    const db = openDatabase({ dbPath });
    const other = openDatabase({ dbPath });
    const registry = createSqliteProjectRegistryAdapter({ db });
    const remoteRegistry = createSqliteProjectRegistryAdapter({ db: other });
    try {
      execFileSync("git", ["init", "--quiet", checkout]);
      const localId = resolveProjectId(checkout);
      const local = {
        ...project,
        slack: { workspaceId: "T1", channelId: "C1", sharedChannel: false },
        projectId: localId,
        localRoot: checkout,
        repoSlug: null,
        legacyProjectIds: [],
      };
      registry.enrollProject(local);
      const thread = {
        projectId: localId,
        featureId: "shared",
        workspaceId: local.slack.workspaceId,
        channelId: local.slack.channelId,
        rootTs: "1.000",
        updatedAt: local.updatedAt,
      };
      execFileSync("git", [
        "-C",
        checkout,
        "remote",
        "add",
        "origin",
        "git@github.com:example/alpha.git",
      ]);
      const remoteId = resolveProjectId(checkout);
      const enroll = () =>
        remoteRegistry.enrollProject({
          ...local,
          projectId: remoteId,
          repoSlug: "example/alpha",
        });
      other.pragma("busy_timeout = 0");
      let raced = false;
      let writerWasLocked = false;
      const prepare = db.prepare.bind(db);
      const spy = vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
        const statement = prepare(sql);
        if (
          sql.includes("INSERT INTO slack_feature_threads") &&
          sql.includes("RETURNING")
        ) {
          const get = statement.get.bind(statement);
          vi.spyOn(statement, "get").mockImplementationOnce((...args) => {
            raced = true;
            try {
              enroll();
            } catch (error) {
              if ((error as Database.SqliteError).code !== "SQLITE_BUSY")
                throw error;
              writerWasLocked = true;
            }
            return get(...args);
          });
        }
        return statement;
      }) as typeof db.prepare);
      try {
        registry.bindFeatureThread(thread);
      } finally {
        spy.mockRestore();
      }
      expect.soft(raced).toBe(true);
      expect.soft(writerWasLocked).toBe(true);
      if (writerWasLocked) enroll();
      for (const id of [localId, remoteId]) {
        expect(
          remoteRegistry.getFeatureThread(id, thread.featureId)?.rootTs,
        ).toBe("1.000");
      }
      registry.bindFeatureThread({ ...thread, rootTs: "2.000" });
      for (const id of [localId, remoteId]) {
        expect(
          remoteRegistry.getFeatureThread(id, thread.featureId)?.rootTs,
        ).toBe("2.000");
      }
    } finally {
      other.close();
      db.close();
    }
  });

  it.each([false, true])(
    "reads the latest gate write with enrollment first = %s",
    (enrollmentFirst) => {
      const checkout = join(root, "gate-transition");
      const dbPath = join(root, "gate-transition.sqlite");
      const db = openDatabase({ dbPath });
      const other = openDatabase({ dbPath });
      const registry = createSqliteProjectRegistryAdapter({ db });
      const remoteRegistry = createSqliteProjectRegistryAdapter({ db: other });
      try {
        execFileSync("git", ["init", "--quiet", checkout]);
        const localId = resolveProjectId(checkout);
        const local = {
          ...project,
          projectId: localId,
          localRoot: checkout,
          repoSlug: null,
          legacyProjectIds: [],
        };
        registry.enrollProject(local);
        execFileSync("git", [
          "-C",
          checkout,
          "remote",
          "add",
          "origin",
          "git@github.com:example/alpha.git",
        ]);
        const remoteId = resolveProjectId(checkout);
        const pass = {
          feature_id: "shared",
          phase_id: "phase-01",
          task_id: "T001",
          gate_script: "check.sh",
          passed: 1,
          exit_code: 0,
          output: "passed",
        };
        const localPassId = recordGateResult(pass, localId, db);
        const remotePassId = recordGateResult(pass, remoteId, other);
        const failure = { ...pass, passed: 0, exit_code: 1, output: "failed" };
        const enroll = () =>
          remoteRegistry.enrollProject({
            ...local,
            projectId: remoteId,
            repoSlug: "example/alpha",
          });

        const prepare = db.prepare.bind(db);
        let raced = false;
        const spy = vi.spyOn(db, "prepare").mockImplementation(((
          sql: string,
        ) => {
          const statement = prepare(sql);
          if (sql.includes("INSERT INTO gate_results")) {
            const get = statement.get.bind(statement);
            vi.spyOn(statement, "get").mockImplementationOnce((...args) => {
              raced = true;
              if (enrollmentFirst) enroll();
              return get(...args);
            });
          }
          return statement;
        }) as typeof db.prepare);
        let failureId: number;
        try {
          failureId = recordGateResult(failure, localId, db);
        } finally {
          spy.mockRestore();
        }
        if (!enrollmentFirst) enroll();
        expect(raced).toBe(true);
        const expectedId = enrollmentFirst ? remotePassId : localPassId;
        expect(failureId).toBe(expectedId);
        db.exec("UPDATE gate_results SET recorded_at = '2026-01-01 00:00:00'");

        expect(remoteRegistry.getProject(localId)?.projectId).toBe(remoteId);
        for (const id of [localId, remoteId]) {
          const winner = getGateResult("shared", "phase-01", "T001", id, other);
          expect.soft(winner).toMatchObject({ ...failure, id: expectedId });
          expect
            .soft(getGateResults("shared", "phase-01", id, other))
            .toEqual([winner]);
          expect.soft(getAllGateResults("shared", id, other)).toEqual([winner]);
        }
      } finally {
        other.close();
        db.close();
      }
    },
  );

  it("transitions a verified local enrollment to its remote identity", () => {
    const checkout = mkdtempSync(join(tmpdir(), "gwrk-enrollment-"));
    const dbPath = join(root, "transition.sqlite");
    const db = openDatabase({ dbPath });
    const other = openDatabase({ dbPath });
    try {
      execFileSync("git", ["init", "--quiet", checkout], { stdio: "ignore" });
      const localId = resolveProjectId(checkout);
      const [legacyAlias] = computeLegacyProjectIds({ projectRoot: checkout });
      const slack = {
        workspaceId: "T1",
        channelId: "C1",
        sharedChannel: false,
      };
      const registry = createSqliteProjectRegistryAdapter({ db });
      registry.enrollProject({
        ...project,
        projectId: localId,
        repoSlug: null,
        localRoot: checkout,
        legacyProjectIds: [legacyAlias],
        slack: { ...slack, channelId: "C0" },
      });
      registry.bindFeatureThread({
        projectId: localId,
        featureId: "old-channel",
        workspaceId: slack.workspaceId,
        channelId: "C0",
        rootTs: "local-old-channel",
        updatedAt: now,
      });
      registry.enrollProject({
        ...project,
        projectId: localId,
        repoSlug: null,
        localRoot: checkout,
        legacyProjectIds: [legacyAlias],
        slack,
      });
      const unrelatedRoot = initCheckout(
        root,
        "unrelated",
        "example/unrelated",
      );
      const unrelatedId = resolveProjectId(unrelatedRoot);
      registry.enrollProject({
        ...project,
        projectId: unrelatedId,
        localRoot: unrelatedRoot,
        slug: "unrelated",
        repoSlug: "example/unrelated",
        legacyProjectIds: [],
      });
      const action = {
        actionId: "merge_pr",
        featureId: "001-pilot",
        phaseId: null,
        workspaceId: slack.workspaceId,
        channelId: slack.channelId,
        messageTs: "1731320500.000100",
      };
      const receipt = (
        projectId: string,
        messageTs = action.messageTs,
      ): SlackActionReceipt => ({
        ...action,
        messageTs,
        projectId,
        receiptKey: buildActionReceiptKey({ ...action, projectId, messageTs }),
        actorUserId: "U_MAINTAINER",
        outcome: "claimed",
        recordedAt: now,
      });
      const firstClaim = receipt(localId);
      const pendingClaim = receipt(localId, "1731320500.000200");
      expect(registry.claimActionReceipt(firstClaim)).toBe(true);
      expect(
        registry.completeActionReceipt(firstClaim.receiptKey, "executed"),
      ).toBe(true);
      expect(registry.claimActionReceipt(pendingClaim)).toBe(true);

      insertFeature(
        { id: "shared", name: "Local feature", status: "open", sp_total: 1 },
        localId,
        db,
      );

      for (const principalId of ["local-maintainer", "shared-user"]) {
        registry.setRoleBinding({
          projectId: localId,
          principalId,
          principalType: "slack_user",
          role: "maintainer",
        });
      }
      for (const featureId of ["shared", "same-channel", "stale-remote"]) {
        registry.bindFeatureThread({
          projectId: localId,
          featureId,
          workspaceId: slack.workspaceId,
          channelId: slack.channelId,
          rootTs: `local-${featureId}`,
          updatedAt: now,
        });
      }
      expect.soft(registry.getFeatureThread(localId, "old-channel")).toBeNull();

      execFileSync("git", [
        "-C",
        checkout,
        "remote",
        "add",
        "origin",
        "https://github.com/example/pilot.git",
      ]);
      const remoteId = resolveProjectId(checkout);
      registerProject({ id: remoteId, name: "Remote", path: "" }, db);
      db.prepare(`
        INSERT INTO project_role_bindings (project_id, principal_type, principal_id, role)
        VALUES (?, 'slack_user', 'shared-user', 'viewer')
      `).run(remoteId);
      db.prepare(`
        INSERT INTO slack_feature_threads (project_id, feature_id, workspace_id, channel_id, root_ts)
        VALUES (?, 'same-channel', 'T1', 'C1', 'remote-current'),
               (?, 'stale-remote', 'T1', 'C0', 'remote-stale')
      `).run(remoteId, remoteId);
      const remote = {
        ...project,
        projectId: remoteId,
        localRoot: checkout,
        legacyProjectIds: [localId],
        slack,
      };
      expect
        .soft(() =>
          registry.enrollProject({
            ...remote,
            legacyProjectIds: [localId, unrelatedId],
          }),
        )
        .toThrow(`already owned: ${unrelatedId}`);
      expect(registry.getProject(localId)?.projectId).toBe(localId);
      expect(registry.getProject(remoteId)).toBeNull();
      expect(registry.getProject(legacyAlias)?.projectId).toBe(localId);
      expect(registry.getProject(unrelatedId)?.projectId).toBe(unrelatedId);

      expect(registry.enrollProject(remote).projectId).toBe(remoteId);
      expect(registry.enrollProject(remote).projectId).toBe(remoteId);
      const replayRegistry = createSqliteProjectRegistryAdapter({ db: other });
      const replay = receipt(remoteId);
      expect
        .soft(replayRegistry.getActionReceipt(replay.receiptKey)?.outcome)
        .toBe("executed");
      expect.soft(replayRegistry.claimActionReceipt(replay)).toBe(false);
      expect
        .soft(
          replayRegistry.completeActionReceipt(
            receipt(remoteId, pendingClaim.messageTs).receiptKey,
            "executed",
          ),
        )
        .toBe(true);
      expect
        .soft(registry.getActionReceipt(pendingClaim.receiptKey)?.outcome)
        .toBe("executed");
      expect(registry.claimActionReceipt(receipt(unrelatedId))).toBe(true);
      for (const id of [localId, remoteId, legacyAlias]) {
        expect(registry.getProject(id)?.projectId).toBe(remoteId);
        expect(getFeature("shared", id, db)?.project_id).toBe(localId);
        expect.soft(registry.listRoleBindings(id)).toMatchObject([
          {
            projectId: remoteId,
            principalId: "local-maintainer",
            role: "maintainer",
          },
          { projectId: remoteId, principalId: "shared-user", role: "viewer" },
        ]);
        expect
          .soft(registry.getFeatureThread(id, "shared")?.rootTs)
          .toBe("local-shared");
        expect
          .soft(registry.getFeatureThread(id, "same-channel")?.rootTs)
          .toBe("remote-current");
        expect
          .soft(registry.getFeatureThread(id, "stale-remote")?.rootTs)
          .toBe("local-stale-remote");
        expect.soft(registry.getFeatureThread(id, "old-channel")).toBeNull();
      }
      expect(registry.findByLocalRoot(checkout)?.projectId).toBe(remoteId);
      expect(
        registry
          .listProjects()
          .map(({ projectId }) => projectId)
          .sort(),
      ).toEqual([remoteId, unrelatedId].sort());
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally {
      other.close();
      db.close();
      rmSync(checkout, { recursive: true, force: true });
    }
  });

  it.each([
    { samePath: false, repo: "example/other" },
    { samePath: true, repo: "example/other" },
    { samePath: false, repo: null },
    { samePath: true, repo: null },
  ])(
    "rejects a legacy alias with the same checkout path $samePath and provenance $repo",
    ({ samePath, repo }) => {
      const db = getTestDb();
      const path = samePath ? project.localRoot! : join(root, "missing");
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
      registry.enrollProject({ ...project, legacyProjectIds: [] });
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

  it("rejects first enrollment of another repository's existing run history", () => {
    const db = getTestDb();
    try {
      const registry = createSqliteProjectRegistryAdapter({ db });
      const { projectId, repoSlug, localRoot } = project;
      registerProject(
        {
          id: projectId,
          name: "Alpha",
          path: localRoot ?? "",
          github_repo: repoSlug,
        },
        db,
      );
      const run = startRun(
        {
          feature_id: "shared",
          command: "alpha-history",
          project_id: projectId,
        },
        db,
      );
      const getRow = db.prepare("SELECT * FROM projects WHERE id = ?");
      const prior = getRow.get(projectId);

      expect
        .soft(() =>
          registry.enrollProject({
            ...project,
            repoSlug: "example/beta",
            localRoot: "/fixtures/beta",
          }),
        )
        .toThrow(/different repository or checkout/);
      expect.soft(registry.getProject(projectId)).toBeNull();
      expect.soft(getRow.get(projectId)).toEqual(prior);
      expect(listRuns("shared", projectId, db)).toMatchObject([
        { id: run, command: "alpha-history" },
      ]);
      expect(() =>
        registry.enrollProject({
          ...project,
          localRoot: join(root, "unavailable"),
          legacyProjectIds: [],
        }),
      ).toThrow(/different repository or checkout/);
      expect(
        registry.enrollProject({ ...project, legacyProjectIds: [] }).repoSlug,
      ).toBe(repoSlug);
    } finally {
      db.close();
    }
  });

  it("checks the Git origin behind a suffixed canonical ledger path", () => {
    const checkout = mkdtempSync(join(tmpdir(), "gwrk-canonical-origin-"));
    const db = getTestDb();
    try {
      execFileSync("git", ["init", "--quiet", checkout], { stdio: "ignore" });
      execFileSync("git", [
        "-C",
        checkout,
        "remote",
        "add",
        "origin",
        "https://github.com/example/alpha.git",
      ]);
      const projectId = "legacy-ledger";
      registerProject(
        {
          id: projectId,
          name: "Alpha",
          path: `${checkout}#${projectId}`,
          github_repo: "example/beta",
        },
        db,
      );
      const run = startRun(
        {
          feature_id: "shared",
          command: "alpha-history",
          project_id: projectId,
        },
        db,
      );
      const registry = createSqliteProjectRegistryAdapter({ db });
      const getRow = db.prepare("SELECT * FROM projects WHERE id = ?");
      const prior = getRow.get(projectId);

      expect
        .soft(() =>
          registry.enrollProject({
            ...project,
            projectId,
            repoSlug: "example/beta",
            localRoot: "/fixtures/beta",
            legacyProjectIds: [],
          }),
        )
        .toThrow(/different repository or checkout/);
      expect.soft(registry.getProject(projectId)).toBeNull();
      expect.soft(getRow.get(projectId)).toEqual(prior);
      expect(listRuns("shared", projectId, db)).toMatchObject([
        { id: run, command: "alpha-history" },
      ]);
    } finally {
      db.close();
      rmSync(checkout, { recursive: true, force: true });
    }
  });

  it.each([true, false])(
    "rejects ambiguous alias and slug lookup when the alias is enrolled first: %s",
    (aliasFirst) => {
      const db = getTestDb();
      try {
        const registry = createSqliteProjectRegistryAdapter({ db });
        const alpha = { ...project, legacyProjectIds: ["route"] };
        registerProject(
          {
            id: "route",
            name: "Previous Alpha",
            path: "",
            github_repo: alpha.repoSlug,
          },
          db,
        );
        const localRoot = initCheckout(root, "gamma", "example/gamma");
        const gamma = {
          ...project,
          projectId: resolveProjectId(localRoot),
          slug: "route",
          repoSlug: "example/gamma",
          localRoot,
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
    {
      mirror: false,
      storedOrigin: "https://github.com/example/beta.git",
      suffixedPath: true,
    },
    {
      mirror: false,
      storedOrigin: "https://github.com/example/beta.git",
      suffixedPath: true,
      hasLocalRoot: true,
    },
  ])(
    "rejects a legacy claim with conflicting Git origin: %j",
    ({ mirror, storedOrigin, suffixedPath, hasLocalRoot }) => {
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
            path: suffixedPath ? `${storedPath}#beta-legacy` : storedPath,
            github_repo: claimedRepo,
          },
          db,
        );
        if (hasLocalRoot) {
          db.prepare(
            "UPDATE projects SET local_root = ? WHERE id = 'beta-legacy'",
          ).run(storedPath);
        }
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

  it("accepts a legacy hash with matching provenance from another checkout", () => {
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
      registerProject(
        {
          id: legacyId,
          name: "Previous",
          path: previous,
          github_repo: project.repoSlug,
        },
        db,
      );
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

  it("rejects feature thread writes for stale Slack bindings", () => {
    const db = getTestDb();
    try {
      const registry = createSqliteProjectRegistryAdapter({ db });
      const slack = {
        workspaceId: "T1",
        channelId: "C-OLD",
        sharedChannel: false,
      };
      const enrollment = { ...project, legacyProjectIds: [], slack };
      const thread = {
        projectId: project.projectId,
        featureId: "shared",
        workspaceId: slack.workspaceId,
        channelId: slack.channelId,
        rootTs: "1.000",
        updatedAt: now,
      };
      registry.enrollProject(enrollment);
      registry.bindFeatureThread(thread);
      registry.enrollProject({
        ...enrollment,
        slack: { ...slack, channelId: "C-NEW" },
      });
      const current = { ...thread, channelId: "C-NEW", rootTs: "2.000" };
      registry.bindFeatureThread(current);

      expect
        .soft(() => registry.bindFeatureThread(thread))
        .toThrow(/Slack binding mismatch/);
      expect
        .soft(registry.getFeatureThread(project.projectId, thread.featureId))
        .toEqual(current);
      expect
        .soft(() =>
          registry.bindFeatureThread({ ...current, workspaceId: "T2" }),
        )
        .toThrow(/Slack binding mismatch/);
      expect(
        registry.getFeatureThread(project.projectId, thread.featureId),
      ).toEqual(current);
    } finally {
      db.close();
    }
  });

  it("keeps roles, feature threads and routing decisions in project scope", () => {
    const db = getTestDb();
    try {
      const registry = createSqliteProjectRegistryAdapter({ db });
      const slack = { workspaceId: "T1", channelId: "C1", sharedChannel: true };
      registerProject(
        {
          id: "legacy-project",
          name: "Previous Pilot",
          path: "",
          github_repo: project.repoSlug,
        },
        db,
      );
      const first = registry.enrollProject({ ...project, slack });
      const localRoot = initCheckout(root, "second", "example/second");
      const second = registry.enrollProject({
        ...project,
        projectId: resolveProjectId(localRoot),
        slug: "second",
        repoSlug: "example/second",
        localRoot,
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
      owner.enrollProject({ ...project, legacyProjectIds: [] });
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
      const writeOrder = "015-ledger-write-order.sql";
      copyFileSync(
        new URL(writeOrder, source),
        join(migrationsDir, writeOrder),
      );
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

        const checkout = initCheckout(root, "legacy", "fixtures/legacy");
        const projectId = resolveProjectId(checkout);
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
          projectId,
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
        expect(registry.getProject(pathAlias)?.projectId).toBe(projectId);
        expect(listRuns("feature", projectId, upgraded)).toHaveLength(1);
        expect(
          getCompressionRecord("feature", "phase", projectId, upgraded)
            ?.point_compression,
        ).toBe(8);
        expect(
          getGateResult("feature", "phase", "T001", projectId, upgraded)
            ?.gate_script,
        ).toBe("verify.sh");
        expect(listRoutingDecisions(projectId, "1", upgraded)).toHaveLength(1);
        expect(listIssues("unattributed", projectId, upgraded)).toEqual([]);
      } finally {
        upgraded.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
