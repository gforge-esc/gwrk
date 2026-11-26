/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../db/index.js";
import { computeProjectId } from "../../domain/project-id.js";
import type {
  EnrolledProject,
  ProjectRole,
} from "../../domain/project-registry.js";
import type {
  AuthStorePort,
  CredentialGrantAdminPort,
} from "../../ports/auth-port.js";
import { repositoryGitEnv } from "../git/process-env.js";
import { createSqliteAuthStoreAdapter } from "./auth-store.js";
import {
  createSqliteAuthStoreAdapter as createSqliteAuthStoreFromBarrel,
  createSqliteProjectRegistryAdapter,
} from "./index.js";

// The parent controls SQLite commit boundaries. The child never retries an operation.
const SQLITE_CONTENDER_SOURCE = String.raw`
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(process.env.FIXTURE_PACKAGE);
const Database = require("better-sqlite3");
const db = new Database(process.env.FIXTURE_DB);
let store;
if (process.env.FIXTURE_ADAPTER) {
  const module = await import(pathToFileURL(process.env.FIXTURE_ADAPTER).href);
  store = module.createSqliteAuthStoreAdapter({ db });
} else {
  // Independent harness proof uses the same database, IPC and lock protocol.
  store = { observeGoogleSession(input) {
    return db.transaction(() => {
      const old = db.prepare("SELECT * FROM google_sessions WHERE token_digest_sha256 = ?").get(input.tokenDigestSha256);
      if (old) return { ok: !old.revoked_at, created: false, cap: old.session_cap_at };
      db.prepare("INSERT INTO google_sessions (token_digest_sha256, principal_id, issued_at, expires_at, session_cap_at) VALUES (?, ?, ?, ?, ?)").run(input.tokenDigestSha256, input.principalId, input.issuedAt, input.expiresAt, input.sessionCapAt);
      return { ok: true, created: true };
    })();
  } };
}
db.pragma("busy_timeout = 100");
process.on("message", (message) => {
  if (message.kind === "close") { db.close(); process.disconnect(); return; }
  if (message.kind !== "observe") return;
  try {
    process.send({ kind: "result", id: message.id, value: store.observeGoogleSession(message.input) });
  } catch (error) {
    process.send({ kind: "result", id: message.id, errorCode: error.code ?? "UNEXPECTED_ERROR" });
  }
});
process.send({ kind: "ready" });
`;

interface ContenderReply {
  kind: string;
  id?: number;
  value?: ReturnType<AuthStorePort["observeGoogleSession"]>;
  errorCode?: string;
}
function childReply(
  child: ChildProcess,
  predicate: (message: ContenderReply) => boolean,
): Promise<ContenderReply> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("SQLite contender IPC deadline exceeded"));
    }, 5000);
    const receive = (value: unknown) => {
      if (
        typeof value !== "object" ||
        value === null ||
        !predicate(value as ContenderReply)
      )
        return;
      cleanup();
      resolve(value as ContenderReply);
    };
    const exited = () => {
      cleanup();
      reject(new Error("SQLite contender exited before its reply"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", receive);
      child.off("exit", exited);
      child.off("error", exited);
    };
    child.on("message", receive);
    child.once("exit", exited);
    child.once("error", exited);
  });
}
async function stopContender(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
    }, 1000);
    child.once("exit", () => {
      clearTimeout(deadline);
      resolve();
    });
    if (child.connected) child.send({ kind: "close" });
    else child.kill("SIGKILL");
  });
}

const ORIGIN = "https://gwrk.gforge.ai";
const CREATED_AT = "2026-11-23T18:00:00.000Z";
const EXPIRES_AT = "2026-12-20T18:00:00.000Z";
const ROTATED_AT = "2026-11-24T18:00:00.000Z";
const ROTATED_EXPIRES_AT = "2026-12-22T18:00:00.000Z";
const VERIFIER_A = "a".repeat(64);
const VERIFIER_B = "b".repeat(64);
const VERIFIER_C = "c".repeat(64);

function runGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...repositoryGitEnv(cwd),
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Gwrk Test",
      GIT_AUTHOR_EMAIL: "gwrk-test@example.invalid",
      GIT_COMMITTER_NAME: "Gwrk Test",
      GIT_COMMITTER_EMAIL: "gwrk-test@example.invalid",
      GIT_TERMINAL_PROMPT: "0",
    },
  }).trim();
}

function createEnrolledRepo(
  root: string,
  slug: string,
  repoSlug: string,
): EnrolledProject {
  const repoDir = path.join(root, slug);
  fs.mkdirSync(repoDir, { recursive: true });
  runGit(repoDir, "init", "--template=", "--initial-branch=main");
  runGit(
    repoDir,
    "commit",
    "--no-gpg-sign",
    "--allow-empty",
    "-m",
    `init ${slug}`,
  );
  runGit(repoDir, "remote", "add", "origin", `git@github.com:${repoSlug}.git`);

  const projectId = computeProjectId({
    projectRoot: repoDir,
    remoteOriginUrl: `git@github.com:${repoSlug}.git`,
    gitCommonDir: path.join(repoDir, ".git"),
  });

  return {
    projectId,
    slug,
    name: `Project ${slug}`,
    repoSlug,
    trunkBranch: "main",
    localRoot: repoDir,
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["hosted", "local"] },
    slack: null,
    legacyProjectIds: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

describe("FR-003 FR-004 FR-005 SQLite production auth store and migration 020", () => {
  let tempRoot: string;
  let dbPath: string;
  let projectA: EnrolledProject;
  let projectB: EnrolledProject;

  beforeEach(() => {
    tempRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-auth-store-")),
    );
    dbPath = path.join(tempRoot, "gwrk.db");
    projectA = createEnrolledRepo(tempRoot, "alpha", "org/alpha");
    projectB = createEnrolledRepo(tempRoot, "beta", "org/beta");
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("TC-005 applies migration 020 cleanly on upgrade and exports the adapter from src/adapters/sqlite/index.ts", () => {
    expect(createSqliteAuthStoreFromBarrel).toBe(createSqliteAuthStoreAdapter);

    // Upgrade from pre-020 migrations to prove backward-compatible schema migration.
    const previousMigrations = path.join(tempRoot, "pre-020-migrations");
    fs.mkdirSync(previousMigrations, { recursive: true });
    const migrationsSource = fileURLToPath(
      new URL("../../db/migrations/", import.meta.url),
    );
    fs.cpSync(migrationsSource, previousMigrations, {
      recursive: true,
      filter: (source) =>
        !path.basename(source).endsWith(".sql") ||
        path.basename(source) < "020-production-auth.sql",
    });

    const preDb = openDatabase({ dbPath, migrationsDir: previousMigrations });
    try {
      const registry = createSqliteProjectRegistryAdapter({ db: preDb });
      registry.enrollProject(projectA);
    } finally {
      preDb.close();
    }

    const db = openDatabase({ dbPath });
    try {
      expect(db.pragma("foreign_key_check")).toEqual([]);
      const migrationRow = db
        .prepare("SELECT name, sha256 FROM _migrations WHERE name = ?")
        .get("020-production-auth.sql") as
        | { name: string; sha256: string | null }
        | undefined;
      expect(migrationRow?.name).toBe("020-production-auth.sql");
      expect(migrationRow?.sha256).toMatch(/^[0-9a-f]{64}$/);

      const tableNames = (
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('api_credentials', 'google_sessions', 'auth_audit_events')",
          )
          .all() as { name: string }[]
      ).map((row) => row.name);
      expect(tableNames.sort()).toEqual([
        "api_credentials",
        "auth_audit_events",
        "google_sessions",
      ]);

      // Enrolled project persisted before migration 020 remains intact.
      const registry = createSqliteProjectRegistryAdapter({ db });
      expect(registry.getProject(projectA.projectId)?.slug).toBe("alpha");

      // Operational tables must never declare raw secret columns.
      const credentialCols = (
        db
          .prepare("SELECT name FROM pragma_table_info('api_credentials')")
          .all() as {
          name: string;
        }[]
      ).map((col) => col.name);
      expect(credentialCols).toEqual(
        expect.arrayContaining([
          "credential_id",
          "verifier_sha256",
          "label",
          "issuer",
          "audience_origin",
          "created_at",
          "expires_at",
          "revoked_at",
          "revoked_reason",
          "rotated_from_id",
          "overlap_until",
        ]),
      );
      expect(credentialCols.join(",")).not.toMatch(
        /raw_key|raw_secret|raw_credential/i,
      );

      const sessionCols = (
        db
          .prepare("SELECT name FROM pragma_table_info('google_sessions')")
          .all() as {
          name: string;
        }[]
      ).map((col) => col.name);
      expect(sessionCols).toEqual(
        expect.arrayContaining([
          "token_digest_sha256",
          "principal_id",
          "issued_at",
          "expires_at",
          "session_cap_at",
          "revoked_at",
          "revoked_reason",
        ]),
      );
      expect(sessionCols.join(",")).not.toMatch(
        /raw_token|id_token|refresh_token/i,
      );
    } finally {
      db.close();
    }
  });

  it("FR-003: stores digest only without raw Google tokens and preserves sequential two-connection observations and revocations", () => {
    const conn1 = openDatabase({ dbPath });
    const conn2 = openDatabase({ dbPath });
    const store1: AuthStorePort = createSqliteAuthStoreAdapter({ db: conn1 });
    const store2: AuthStorePort = createSqliteAuthStoreAdapter({ db: conn2 });

    const digest1 = "1".repeat(64);
    const digest2 = "2".repeat(64);
    const principal = "https://accounts.google.com:109876543210";
    const issuedAt = "2026-11-23T18:00:00.000Z";
    const expiresAt = "2026-11-23T20:00:00.000Z";
    const originalCapAt = "2026-11-23T19:00:00.000Z";
    const extendedCapAt = "2026-11-23T19:45:00.000Z";

    try {
      // First observation inserts atomically.
      const first = store1.observeGoogleSession({
        tokenDigestSha256: digest1,
        principalId: principal,
        issuedAt,
        expiresAt,
        sessionCapAt: originalCapAt,
      });
      expect(first).toEqual({
        ok: true,
        created: true,
        session: {
          tokenDigestSha256: digest1,
          principalId: principal,
          issuedAt,
          expiresAt,
          sessionCapAt: originalCapAt,
          revokedAt: null,
          revokedReason: null,
        },
      });

      // Second connection observes the same digest with a later cap: original cap MUST NOT extend.
      const second = store2.observeGoogleSession({
        tokenDigestSha256: digest1,
        principalId: principal,
        issuedAt,
        expiresAt,
        sessionCapAt: extendedCapAt,
      });
      expect(second).toEqual({
        ok: true,
        created: false,
        session: {
          tokenDigestSha256: digest1,
          principalId: principal,
          issuedAt,
          expiresAt,
          sessionCapAt: originalCapAt,
          revokedAt: null,
          revokedReason: null,
        },
      });

      // Conflicting principal or token lifetime metadata MUST return SESSION_METADATA_CONFLICT.
      expect(
        store2.observeGoogleSession({
          tokenDigestSha256: digest1,
          principalId: "https://accounts.google.com:different-subject",
          issuedAt,
          expiresAt,
          sessionCapAt: originalCapAt,
        }),
      ).toEqual({ ok: false, code: "SESSION_METADATA_CONFLICT" });

      expect(
        store2.observeGoogleSession({
          tokenDigestSha256: digest1,
          principalId: principal,
          issuedAt: "2026-11-23T18:05:00.000Z",
          expiresAt,
          sessionCapAt: originalCapAt,
        }),
      ).toEqual({ ok: false, code: "SESSION_METADATA_CONFLICT" });

      expect(
        store2.observeGoogleSession({
          tokenDigestSha256: digest1,
          principalId: principal,
          issuedAt,
          expiresAt: "2026-11-23T21:00:00.000Z",
          sessionCapAt: originalCapAt,
        }),
      ).toEqual({ ok: false, code: "SESSION_METADATA_CONFLICT" });

      // Revocation on connection 1 commits immediately and denies subsequent observation on connection 2.
      const revoked = store1.revokeGoogleSession({
        tokenDigestSha256: digest1,
        revokedAt: "2026-11-23T18:10:00.000Z",
        reason: "user_logout",
      });
      expect(revoked).toBe(true);

      // Re-revoking an already revoked session returns false (idempotent without losing original marker).
      expect(
        store2.revokeGoogleSession({
          tokenDigestSha256: digest1,
          revokedAt: "2026-11-23T18:11:00.000Z",
          reason: "duplicate_logout",
        }),
      ).toBe(false);

      expect(
        store2.observeGoogleSession({
          tokenDigestSha256: digest1,
          principalId: principal,
          issuedAt,
          expiresAt,
          sessionCapAt: extendedCapAt,
        }),
      ).toEqual({ ok: false, code: "SESSION_REVOKED" });

      // Fresh login with a new token digest succeeds independently.
      const freshLogin = store2.observeGoogleSession({
        tokenDigestSha256: digest2,
        principalId: principal,
        issuedAt: "2026-11-23T18:12:00.000Z",
        expiresAt: "2026-11-23T20:12:00.000Z",
        sessionCapAt: "2026-11-23T19:12:00.000Z",
      });
      expect(freshLogin).toMatchObject({ ok: true, created: true });
    } finally {
      store1.close();
      store2.close();
      conn1.close();
      conn2.close();
    }

    // Reopen fresh connection to confirm persisted revocation and digest-only storage.
    const reopened = openDatabase({ dbPath });
    try {
      const store3 = createSqliteAuthStoreAdapter({ db: reopened });
      const stored = store3.getGoogleSession(digest1);
      expect(stored).toMatchObject({
        tokenDigestSha256: digest1,
        principalId: principal,
        sessionCapAt: originalCapAt,
        revokedAt: "2026-11-23T18:10:00.000Z",
        revokedReason: "user_logout",
      });
      expect(
        store3.observeGoogleSession({
          tokenDigestSha256: digest1,
          principalId: principal,
          issuedAt,
          expiresAt,
          sessionCapAt: originalCapAt,
        }),
      ).toEqual({ ok: false, code: "SESSION_REVOKED" });

      // Inspect raw SQLite rows: only digests exist, never JWT segments ("eyJ").
      const rawRows = reopened
        .prepare("SELECT * FROM google_sessions")
        .all() as Record<string, unknown>[];
      expect(rawRows).toHaveLength(2);
      expect(JSON.stringify(rawRows)).not.toContain("eyJ");
    } finally {
      reopened.close();
    }
  });

  it("FR-004 FR-005 commits API credentials and enrolled-project role bindings atomically and hides verifiers from metadata listings", () => {
    const db = openDatabase({ dbPath });
    try {
      const registry = createSqliteProjectRegistryAdapter({ db });
      registry.enrollProject(projectA);
      registry.enrollProject(projectB);

      const store: AuthStorePort & CredentialGrantAdminPort =
        createSqliteAuthStoreAdapter({ db });

      const created = store.createCredentialWithGrants({
        credentialId: "cred_alpha_01",
        verifierSha256: VERIFIER_A,
        label: "CI Pilot Key",
        issuer: "local-admin",
        audienceOrigin: ORIGIN,
        createdAt: CREATED_AT,
        expiresAt: EXPIRES_AT,
        grants: [
          { projectId: projectA.projectId, role: "operator" },
          { projectId: projectB.projectId, role: "viewer" },
        ],
      });

      expect(created.credential).toEqual({
        credentialId: "cred_alpha_01",
        label: "CI Pilot Key",
        issuer: "local-admin",
        audienceOrigin: ORIGIN,
        createdAt: CREATED_AT,
        expiresAt: EXPIRES_AT,
        revokedAt: null,
        revokedReason: null,
        rotatedFromId: null,
        overlapUntil: null,
      });
      // Metadata return MUST NOT include verifierSha256.
      expect("verifierSha256" in created.credential).toBe(false);

      expect(created.grants).toEqual(
        expect.arrayContaining([
          {
            projectId: projectA.projectId,
            principalType: "cli_token",
            principalId: "cred_alpha_01",
            role: "operator",
          },
          {
            projectId: projectB.projectId,
            principalType: "cli_token",
            principalId: "cred_alpha_01",
            role: "viewer",
          },
        ]),
      );

      // Lookup returns stored verifier; list returns public metadata only.
      const found = store.findApiCredentialById("cred_alpha_01");
      expect(found?.verifierSha256).toBe(VERIFIER_A);

      const listed = store.listApiCredentials();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.credentialId).toBe("cred_alpha_01");
      expect("verifierSha256" in (listed[0] as object)).toBe(false);
      expect(JSON.stringify(listed)).not.toContain(VERIFIER_A);

      // Existing ProjectRegistryPort sees the exact cli_token role bindings.
      expect(registry.listRoleBindings(projectA.projectId)).toContainEqual({
        projectId: projectA.projectId,
        principalType: "cli_token",
        principalId: "cred_alpha_01",
        role: "operator",
      });
      expect(registry.listRoleBindings(projectB.projectId)).toContainEqual({
        projectId: projectB.projectId,
        principalType: "cli_token",
        principalId: "cred_alpha_01",
        role: "viewer",
      });

      // Negative atomicity: one valid project + one unenrolled project rolls back ALL writes.
      expect(() =>
        store.createCredentialWithGrants({
          credentialId: "cred_partial_fail",
          verifierSha256: VERIFIER_B,
          label: "Partial Fail",
          issuer: "local-admin",
          audienceOrigin: ORIGIN,
          createdAt: CREATED_AT,
          expiresAt: EXPIRES_AT,
          grants: [
            { projectId: projectA.projectId, role: "maintainer" },
            { projectId: "unenrolled-project-id", role: "viewer" },
          ],
        }),
      ).toThrow();

      expect(store.findApiCredentialById("cred_partial_fail")).toBeNull();
      expect(
        registry
          .listRoleBindings(projectA.projectId)
          .filter((b) => b.principalId === "cred_partial_fail"),
      ).toEqual([]);

      // Negative: wildcard project grant and invalid roles are rejected with zero rows.
      expect(() =>
        store.createCredentialWithGrants({
          credentialId: "cred_wildcard_fail",
          verifierSha256: VERIFIER_B,
          label: "Wildcard",
          issuer: "local-admin",
          audienceOrigin: ORIGIN,
          createdAt: CREATED_AT,
          expiresAt: EXPIRES_AT,
          grants: [{ projectId: "*", role: "viewer" }],
        }),
      ).toThrow();
      expect(store.findApiCredentialById("cred_wildcard_fail")).toBeNull();

      expect(() =>
        store.createCredentialWithGrants({
          credentialId: "cred_bad_role",
          verifierSha256: VERIFIER_B,
          label: "Bad Role",
          issuer: "local-admin",
          audienceOrigin: ORIGIN,
          createdAt: CREATED_AT,
          expiresAt: EXPIRES_AT,
          grants: [
            {
              projectId: projectA.projectId,
              role: "superadmin" as ProjectRole,
            },
          ],
        }),
      ).toThrow();
      expect(store.findApiCredentialById("cred_bad_role")).toBeNull();
    } finally {
      db.close();
    }
  });

  it("TR-009 AUTH-09 rolls back creation when a valid enrolled grant insert fails after a prior grant write", () => {
    const id = "cred_creation_fault";
    const db = openDatabase({ dbPath });
    try {
      const registry = createSqliteProjectRegistryAdapter({ db });
      registry.enrollProject(projectA);
      registry.enrollProject(projectB);
      const store = createSqliteAuthStoreAdapter({ db });
      // Reject whichever grant is second, without requiring a particular insertion order.
      db.exec(`CREATE TRIGGER fail_second_creation_grant
        BEFORE INSERT ON project_role_bindings
        WHEN NEW.principal_id = 'cred_creation_fault'
          AND EXISTS (SELECT 1 FROM project_role_bindings WHERE principal_id = NEW.principal_id AND principal_type = 'cli_token')
        BEGIN SELECT RAISE(ABORT, 'injected_creation_grant_failure'); END;`);
      expect(() =>
        store.createCredentialWithGrants({
          credentialId: id,
          verifierSha256: VERIFIER_A,
          label: "Faulted creation",
          issuer: "local-admin",
          audienceOrigin: ORIGIN,
          createdAt: CREATED_AT,
          expiresAt: EXPIRES_AT,
          grants: [
            { projectId: projectA.projectId, role: "operator" },
            { projectId: projectB.projectId, role: "viewer" },
          ],
        }),
      ).toThrow(/injected_creation_grant_failure/);
    } finally {
      db.close();
    }
    const reopened = openDatabase({ dbPath });
    try {
      const store = createSqliteAuthStoreAdapter({ db: reopened });
      expect(store.findApiCredentialById(id)).toBeNull();
      expect(
        reopened
          .prepare(
            "SELECT * FROM project_role_bindings WHERE principal_type = 'cli_token' AND principal_id = ?",
          )
          .all(id),
      ).toEqual([]);
      expect(
        reopened
          .prepare("SELECT * FROM api_credentials WHERE credential_id = ?")
          .all(id),
      ).toEqual([]);
      const registry = createSqliteProjectRegistryAdapter({ db: reopened });
      expect(registry.getProject(projectA.projectId)).not.toBeNull();
      expect(registry.getProject(projectB.projectId)).not.toBeNull();
    } finally {
      reopened.close();
    }
  });

  it("TR-009 serializes independently scheduled session observation with uncommitted insert and revocation writers", async () => {
    const db = openDatabase({ dbPath });
    const script = path.join(tempRoot, "sqlite-contender.mjs");
    fs.writeFileSync(script, SQLITE_CONTENDER_SOURCE);
    const child = spawn(
      process.execPath,
      ["--import", createRequire(import.meta.url).resolve("tsx"), script],
      {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: {
          ...process.env,
          NODE_OPTIONS: "",
          FIXTURE_PACKAGE: path.resolve("package.json"),
          FIXTURE_DB: dbPath,
          FIXTURE_ADAPTER: fileURLToPath(
            new URL("./auth-store.ts", import.meta.url),
          ),
        },
      },
    );
    let requestId = 0;
    const input = {
      tokenDigestSha256: "d".repeat(64),
      principalId: "https://accounts.google.com:contended",
      issuedAt: CREATED_AT,
      expiresAt: "2026-11-23T20:00:00.000Z",
      sessionCapAt: "2026-11-23T19:00:00.000Z",
    };
    const observe = () => {
      const id = ++requestId;
      const result = childReply(
        child,
        (message) => message.kind === "result" && message.id === id,
      );
      child.send({
        kind: "observe",
        id,
        input: { ...input, sessionCapAt: "2026-11-23T19:45:00.000Z" },
      });
      return result;
    };
    try {
      await childReply(child, (message) => message.kind === "ready");
      db.exec("BEGIN IMMEDIATE");
      db.prepare(
        "INSERT INTO google_sessions (token_digest_sha256, principal_id, issued_at, expires_at, session_cap_at) VALUES (?, ?, ?, ?, ?)",
      ).run(
        input.tokenDigestSha256,
        input.principalId,
        input.issuedAt,
        input.expiresAt,
        input.sessionCapAt,
      );
      // Child is ready before this write. The transaction stays open until its reply.
      const insertionContention = await observe();
      expect(insertionContention.errorCode).toMatch(/^SQLITE_(BUSY|LOCKED)/);
      db.exec("COMMIT");
      // A new operation after commit must observe the original cap, without requiring an automatic retry.
      expect((await observe()).value).toMatchObject({
        ok: true,
        created: false,
        session: { sessionCapAt: input.sessionCapAt },
      });
      db.exec("BEGIN IMMEDIATE");
      db.prepare(
        "UPDATE google_sessions SET revoked_at = ?, revoked_reason = ? WHERE token_digest_sha256 = ?",
      ).run(
        "2026-11-23T18:10:00.000Z",
        "controlled_logout",
        input.tokenDigestSha256,
      );
      const revocationContention = await observe();
      if (revocationContention.errorCode)
        expect(revocationContention.errorCode).toMatch(/^SQLITE_(BUSY|LOCKED)/);
      else
        expect(revocationContention.value).toMatchObject({
          ok: true,
          created: false,
          session: { sessionCapAt: input.sessionCapAt, revokedAt: null },
        });
      // Authentication completed before this commit may remain valid under the frozen boundary.
      db.exec("COMMIT");
      expect((await observe()).value).toEqual({
        ok: false,
        code: "SESSION_REVOKED",
      });
    } finally {
      if (db.inTransaction) db.exec("ROLLBACK");
      await stopContender(child);
      db.close();
    }
    const reopened = openDatabase({ dbPath });
    try {
      const store = createSqliteAuthStoreAdapter({ db: reopened });
      expect(store.getGoogleSession(input.tokenDigestSha256)).toMatchObject({
        sessionCapAt: input.sessionCapAt,
        revokedAt: "2026-11-23T18:10:00.000Z",
      });
      expect(store.observeGoogleSession(input)).toEqual({
        ok: false,
        code: "SESSION_REVOKED",
      });
      expect(
        reopened
          .prepare(
            "SELECT COUNT(*) AS count FROM google_sessions WHERE token_digest_sha256 = ?",
          )
          .get(input.tokenDigestSha256),
      ).toEqual({ count: 1 });
    } finally {
      reopened.close();
    }
  }, 15000);

  it("TR-009 AUTH-09 rolls back failed mid-rotation grant copy and old-key revocation atomically and persists committed rotation across reopen", () => {
    const db = openDatabase({ dbPath });
    try {
      const registry = createSqliteProjectRegistryAdapter({ db });
      registry.enrollProject(projectA);
      registry.enrollProject(projectB);
      const store = createSqliteAuthStoreAdapter({ db });

      store.createCredentialWithGrants({
        credentialId: "cred_rot_v1",
        verifierSha256: VERIFIER_A,
        label: "Rotatable Key",
        issuer: "local-admin",
        audienceOrigin: ORIGIN,
        createdAt: CREATED_AT,
        expiresAt: EXPIRES_AT,
        grants: [
          { projectId: projectA.projectId, role: "operator" },
          { projectId: projectB.projectId, role: "viewer" },
        ],
      });

      // Fault injection 1: crash during grant copy inside rotateCredential transaction.
      db.exec(`
        CREATE TRIGGER fail_rotation_grant_copy
        BEFORE INSERT ON project_role_bindings
        WHEN NEW.principal_id = 'cred_rot_crash_grants'
        BEGIN
          SELECT RAISE(ABORT, 'simulated_grant_copy_crash');
        END;
      `);

      expect(() =>
        store.rotateCredential({
          targetCredentialId: "cred_rot_v1",
          newCredentialId: "cred_rot_crash_grants",
          newVerifierSha256: VERIFIER_B,
          issuer: "local-admin",
          audienceOrigin: ORIGIN,
          createdAt: ROTATED_AT,
          expiresAt: ROTATED_EXPIRES_AT,
          reason: "scheduled_rotation",
        }),
      ).toThrow(/simulated_grant_copy_crash/);
      db.exec("DROP TRIGGER fail_rotation_grant_copy;");

      // Fault injection 2: crash during old-key revocation AFTER new key + copied grants inserted.
      db.exec(`
        CREATE TRIGGER fail_rotation_old_revoke
        BEFORE UPDATE ON api_credentials
        WHEN OLD.credential_id = 'cred_rot_v1' AND NEW.revoked_at IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'simulated_revoke_crash');
        END;
      `);

      expect(() =>
        store.rotateCredential({
          targetCredentialId: "cred_rot_v1",
          newCredentialId: "cred_rot_crash_revoke",
          newVerifierSha256: VERIFIER_B,
          issuer: "local-admin",
          audienceOrigin: ORIGIN,
          createdAt: ROTATED_AT,
          expiresAt: ROTATED_EXPIRES_AT,
          reason: "scheduled_rotation",
        }),
      ).toThrow(/simulated_revoke_crash/);
      db.exec("DROP TRIGGER fail_rotation_old_revoke;");
    } finally {
      db.close();
    }

    // Reopen DB after both crashes: zero partial credentials or bindings, original key still active!
    const afterCrashDb = openDatabase({ dbPath });
    try {
      const registry = createSqliteProjectRegistryAdapter({ db: afterCrashDb });
      const store = createSqliteAuthStoreAdapter({ db: afterCrashDb });

      expect(store.findApiCredentialById("cred_rot_crash_grants")).toBeNull();
      expect(store.findApiCredentialById("cred_rot_crash_revoke")).toBeNull();
      expect(
        registry
          .listRoleBindings(projectA.projectId)
          .filter((b) =>
            ["cred_rot_crash_grants", "cred_rot_crash_revoke"].includes(
              b.principalId,
            ),
          ),
      ).toEqual([]);

      const original = store.findApiCredentialById("cred_rot_v1");
      expect(original).not.toBeNull();
      expect(original?.revokedAt).toBeNull();

      // Now perform a clean atomic rotation: copies grants and revokes old key in one transaction.
      const rotated = store.rotateCredential({
        targetCredentialId: "cred_rot_v1",
        newCredentialId: "cred_rot_v2",
        newVerifierSha256: VERIFIER_B,
        issuer: "local-admin",
        audienceOrigin: ORIGIN,
        createdAt: ROTATED_AT,
        expiresAt: ROTATED_EXPIRES_AT,
        reason: "scheduled_rotation",
      });

      expect(rotated.created).toMatchObject({
        credentialId: "cred_rot_v2",
        rotatedFromId: "cred_rot_v1",
        audienceOrigin: ORIGIN,
        expiresAt: ROTATED_EXPIRES_AT,
        revokedAt: null,
      });
      expect(rotated.revokedCredentialId).toBe("cred_rot_v1");
      expect(rotated.overlapUntil).toBeNull();
      expect(rotated.copiedGrants).toEqual(
        expect.arrayContaining([
          {
            projectId: projectA.projectId,
            principalType: "cli_token",
            principalId: "cred_rot_v2",
            role: "operator",
          },
          {
            projectId: projectB.projectId,
            principalType: "cli_token",
            principalId: "cred_rot_v2",
            role: "viewer",
          },
        ]),
      );

      // Rotating an already-revoked or unknown credential MUST fail with zero new rows.
      expect(() =>
        store.rotateCredential({
          targetCredentialId: "cred_rot_v1",
          newCredentialId: "cred_rot_from_revoked",
          newVerifierSha256: VERIFIER_C,
          issuer: "local-admin",
          audienceOrigin: ORIGIN,
          createdAt: ROTATED_AT,
          expiresAt: ROTATED_EXPIRES_AT,
          reason: "invalid_retry",
        }),
      ).toThrow();
      expect(store.findApiCredentialById("cred_rot_from_revoked")).toBeNull();

      // Overlap rotation keeps old key active until overlapUntil and records audit trail.
      const overlapUntil = "2026-11-25T18:00:00.000Z";
      const overlapped = store.rotateCredential({
        targetCredentialId: "cred_rot_v2",
        newCredentialId: "cred_rot_v3",
        newVerifierSha256: VERIFIER_C,
        issuer: "local-admin",
        audienceOrigin: ORIGIN,
        createdAt: ROTATED_AT,
        expiresAt: ROTATED_EXPIRES_AT,
        overlapUntil,
        reason: "zero_downtime_cutover",
      });
      expect(overlapped.revokedCredentialId).toBeNull();
      expect(overlapped.overlapUntil).toBe(overlapUntil);
      expect(store.findApiCredentialById("cred_rot_v2")?.revokedAt).toBeNull();
      expect(store.findApiCredentialById("cred_rot_v2")?.overlapUntil).toBe(
        overlapUntil,
      );
    } finally {
      afterCrashDb.close();
    }

    // Final reopen confirms committed revocations, copied grants, and overlap persist on disk.
    const persistedDb = openDatabase({ dbPath });
    try {
      const store = createSqliteAuthStoreAdapter({ db: persistedDb });
      const registry = createSqliteProjectRegistryAdapter({ db: persistedDb });

      const v1 = store.findApiCredentialById("cred_rot_v1");
      expect(v1?.revokedAt).toBe(ROTATED_AT);
      expect(v1?.revokedReason).toContain("scheduled_rotation");

      const v2 = store.findApiCredentialById("cred_rot_v2");
      expect(v2?.revokedAt).toBeNull();
      expect(v2?.overlapUntil).toBe("2026-11-25T18:00:00.000Z");

      const v3 = store.findApiCredentialById("cred_rot_v3");
      expect(v3?.rotatedFromId).toBe("cred_rot_v2");
      expect(v3?.revokedAt).toBeNull();

      expect(registry.listRoleBindings(projectA.projectId)).toContainEqual({
        projectId: projectA.projectId,
        principalType: "cli_token",
        principalId: "cred_rot_v3",
        role: "operator",
      });

      const auditRows = persistedDb
        .prepare(
          "SELECT event_type, outcome, credential_id FROM auth_audit_events",
        )
        .all() as {
        event_type: string;
        outcome: string;
        credential_id: string | null;
      }[];
      expect(auditRows.length).toBeGreaterThan(0);
    } finally {
      persistedDb.close();
    }
  });

  it("FR-013 records public-identifier audit events via appendAuditEvent", () => {
    const db = openDatabase({ dbPath });
    try {
      const store = createSqliteAuthStoreAdapter({ db });
      store.appendAuditEvent({
        occurredAt: CREATED_AT,
        eventType: "api_credential.revoked",
        outcome: "allowed",
        principalType: "cli_token",
        principalId: "cred_audit_01",
        credentialId: "cred_audit_01",
        requestId: "req-audit-1",
        detailCode: "MANUAL_REVOKE",
        metadata: { actor: "local-admin", count: 1, forced: false },
      });

      const rows = db
        .prepare("SELECT * FROM auth_audit_events")
        .all() as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        occurred_at: CREATED_AT,
        event_type: "api_credential.revoked",
        outcome: "allowed",
        principal_type: "cli_token",
        principal_id: "cred_audit_01",
        credential_id: "cred_audit_01",
        request_id: "req-audit-1",
        detail_code: "MANUAL_REVOKE",
      });
    } finally {
      db.close();
    }
  });
});
