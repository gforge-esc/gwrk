/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCredentialCryptoAdapter } from "../adapters/auth/credential-crypto.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import {
  createSqliteAuthStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";
import {
  createApiCredential,
  rotateApiCredential,
} from "../application/auth/manage-credentials.js";
import { runCli } from "../cli.js";
import { closeDb, openDatabase } from "../db/index.js";
import { parseOpaqueApiCredential } from "../domain/auth-policy.js";
import { computeProjectId } from "../domain/project-id.js";
import type { EnrolledProject } from "../domain/project-registry.js";
import { createAuthCommand } from "./auth.js";

const ORIGIN = "https://gwrk.gforge.ai";

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

function enrollTempProject(
  tempRoot: string,
  dbPath: string,
  slug: string,
  repoSlug: string,
): { project: EnrolledProject; repoDir: string } {
  const repoDir = path.join(tempRoot, `${slug}-repo`);
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

  const nowIso = new Date().toISOString();
  const project: EnrolledProject = {
    projectId: computeProjectId({
      projectRoot: repoDir,
      remoteOriginUrl: `git@github.com:${repoSlug}.git`,
      gitCommonDir: path.join(repoDir, ".git"),
    }),
    slug,
    name: `Project ${slug}`,
    repoSlug,
    trunkBranch: "main",
    localRoot: repoDir,
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["hosted", "local"] },
    slack: null,
    legacyProjectIds: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const registry = createSqliteProjectRegistryAdapter({ dbPath });
  try {
    registry.enrollProject(project);
  } finally {
    registry.close();
  }

  return { project, repoDir };
}

async function execRootCli(
  args: string[],
  options: { agentMode?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(args, {
    agentMode: options.agentMode ?? false,
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
  });
  return { stdout, stderr, exitCode };
}

describe("FR-006 local private-host key administration CLI (gwrk auth key)", () => {
  let oldCwd: string;
  let tempRoot: string;
  let gwrkHome: string;
  let dbPath: string;
  let outsideSecretsDir: string;
  let nonProjectDir: string;
  let alphaProject: EnrolledProject;
  let betaProject: EnrolledProject;
  let alphaRepoDir: string;
  let validExpiresAt: string;
  let laterExpiresAt: string;

  beforeEach(() => {
    oldCwd = process.cwd();
    closeDb();
    tempRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-auth-cli-")),
    );
    gwrkHome = path.join(tempRoot, "gwrk-home");
    dbPath = path.join(gwrkHome, "gwrk.db");
    outsideSecretsDir = path.join(tempRoot, "outside-secrets");
    nonProjectDir = path.join(tempRoot, "no-config-dir");
    fs.mkdirSync(gwrkHome, { recursive: true });
    fs.mkdirSync(outsideSecretsDir, { recursive: true });
    fs.mkdirSync(nonProjectDir, { recursive: true });

    vi.stubEnv("GWRK_HOME", gwrkHome);
    vi.stubEnv("GWRK_DIR", "");
    vi.stubEnv("GWRK_DB_PATH", dbPath);
    vi.stubEnv("GWRK_RUNTIME_DIR", "");
    vi.stubEnv("GWRK_AUTH_PUBLIC_ORIGIN", ORIGIN);

    const alpha = enrollTempProject(tempRoot, dbPath, "alpha", "org/alpha");
    const beta = enrollTempProject(tempRoot, dbPath, "beta", "org/beta");
    alphaProject = alpha.project;
    betaProject = beta.project;
    alphaRepoDir = alpha.repoDir;

    validExpiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    laterExpiresAt = new Date(
      Date.now() + 14 * 24 * 60 * 60 * 1000,
    ).toISOString();

    process.chdir(alphaRepoDir);
  });

  afterEach(() => {
    process.chdir(oldCwd);
    closeDb();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("US-004 exposes create, list, revoke, and rotate subcommands under gwrk auth key", () => {
    const authCmd = createAuthCommand();
    expect(authCmd.name()).toBe("auth");
    const keyCmd = authCmd.commands.find((c) => c.name() === "key");
    expect(keyCmd).toBeDefined();
    const subcommands = keyCmd?.commands.map((c) => c.name()) ?? [];
    expect(subcommands).toEqual(
      expect.arrayContaining(["create", "list", "revoke", "rotate"]),
    );
  });

  it("TR-010 AUTH-10: creates secret file 0600 without stdout secret", async () => {
    const secretOut = path.join(outsideSecretsDir, "pilot-key.secret");

    const res = await execRootCli([
      "auth",
      "key",
      "create",
      "--grant",
      `${alphaProject.slug}=operator`,
      "--grant",
      `${betaProject.projectId}=viewer`,
      "--expires-at",
      validExpiresAt,
      "--label",
      "Pilot Automation",
      "--secret-out",
      secretOut,
      "--format",
      "json",
    ]);

    expect(res.exitCode, res.stderr).toBe(0);
    expect(res.stderr).toMatch(/\[exit:0 \| /);

    // File must exist with owner-only 0600 permissions and valid gwrk_v1 key.
    const stat = fs.lstatSync(secretOut);
    expect(stat.isFile()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.mode & 0o777).toBe(0o600);

    const rawSecret = fs.readFileSync(secretOut, "utf-8").trim();
    const parsedKey = parseOpaqueApiCredential(rawSecret);
    expect(parsedKey.ok).toBe(true);
    if (!parsedKey.ok) {
      throw new Error("Expected secret file to contain a valid gwrk_v1 key");
    }

    // Stdout and stderr MUST NEVER contain the raw credential or its 32-byte secret segment.
    expect(res.stdout).not.toContain(rawSecret);
    expect(res.stdout).not.toContain(parsedKey.secret);
    expect(res.stderr).not.toContain(rawSecret);
    expect(res.stderr).not.toContain(parsedKey.secret);

    const payload = JSON.parse(res.stdout) as {
      credential: {
        credentialId: string;
        label: string;
        audienceOrigin: string;
        expiresAt: string;
        revokedAt: string | null;
      };
      grants: Array<{
        projectId: string;
        principalType: string;
        principalId: string;
        role: string;
      }>;
      secretOut: string;
    };

    expect(payload.credential.credentialId).toBe(parsedKey.credentialId);
    expect(payload.credential.label).toBe("Pilot Automation");
    expect(payload.credential.audienceOrigin).toBe(ORIGIN);
    expect(payload.credential.expiresAt).toBe(validExpiresAt);
    expect(payload.credential.revokedAt).toBeNull();
    expect("verifierSha256" in (payload.credential as object)).toBe(false);
    expect(payload.secretOut).toBe(secretOut);
    expect(payload.grants).toEqual(
      expect.arrayContaining([
        {
          projectId: alphaProject.projectId,
          principalType: "cli_token",
          principalId: parsedKey.credentialId,
          role: "operator",
        },
        {
          projectId: betaProject.projectId,
          principalType: "cli_token",
          principalId: parsedKey.credentialId,
          role: "viewer",
        },
      ]),
    );

    // SQLite store must hold the SHA-256 verifier matching the delivered secret file.
    const crypto = createCredentialCryptoAdapter();
    const store = createSqliteAuthStoreAdapter({ dbPath });
    try {
      const stored = store.findApiCredentialById(parsedKey.credentialId);
      expect(stored).not.toBeNull();
      expect(stored?.verifierSha256).toBe(crypto.hashCredential(rawSecret));
      expect(res.stdout).not.toContain(stored?.verifierSha256 ?? "");
    } finally {
      store.close();
    }
  });

  it("TR-010 AUTH-10: revokes orphan key on delivery failure and rejects unsafe secret-out paths", async () => {
    // 1. Inside checkout path MUST be refused with exit 2 and zero credentials persisted.
    const insideCheckoutPath = path.join(alphaRepoDir, "leaked.key");
    const insideRes = await execRootCli([
      "auth",
      "key",
      "create",
      "--grant",
      `${alphaProject.slug}=viewer`,
      "--expires-at",
      validExpiresAt,
      "--label",
      "Inside Checkout",
      "--secret-out",
      insideCheckoutPath,
    ]);
    expect(insideRes.exitCode).toBe(2);
    expect(insideRes.stderr).toMatch(/\[exit:2 \| /);
    expect(fs.existsSync(insideCheckoutPath)).toBe(false);

    // 2. Existing file MUST NOT be overwritten (exit 2).
    const existingFile = path.join(outsideSecretsDir, "existing.key");
    fs.writeFileSync(existingFile, "DO-NOT-OVERWRITE\n", { mode: 0o600 });
    const existingRes = await execRootCli([
      "auth",
      "key",
      "create",
      "--grant",
      `${alphaProject.slug}=viewer`,
      "--expires-at",
      validExpiresAt,
      "--label",
      "Existing File",
      "--secret-out",
      existingFile,
    ]);
    expect(existingRes.exitCode).toBe(2);
    expect(existingRes.stderr).toMatch(/\[exit:2 \| /);
    expect(fs.readFileSync(existingFile, "utf-8")).toBe("DO-NOT-OVERWRITE\n");

    // 3. Symlink path (both existing target and dangling symlink) MUST be refused (exit 2).
    const symlinkTarget = path.join(outsideSecretsDir, "real-target.txt");
    fs.writeFileSync(symlinkTarget, "TARGET-INTACT\n", { mode: 0o600 });
    const symlinkPath = path.join(outsideSecretsDir, "link.key");
    fs.symlinkSync(symlinkTarget, symlinkPath);

    const symlinkRes = await execRootCli([
      "auth",
      "key",
      "create",
      "--grant",
      `${alphaProject.slug}=viewer`,
      "--expires-at",
      validExpiresAt,
      "--label",
      "Symlink File",
      "--secret-out",
      symlinkPath,
    ]);
    expect(symlinkRes.exitCode).toBe(2);
    expect(symlinkRes.stderr).toMatch(/\[exit:2 \| /);
    expect(fs.readFileSync(symlinkTarget, "utf-8")).toBe("TARGET-INTACT\n");

    const danglingSymlink = path.join(outsideSecretsDir, "dangling.key");
    fs.symlinkSync(
      path.join(outsideSecretsDir, "never-created.key"),
      danglingSymlink,
    );
    const danglingRes = await execRootCli([
      "auth",
      "key",
      "create",
      "--grant",
      `${alphaProject.slug}=viewer`,
      "--expires-at",
      validExpiresAt,
      "--label",
      "Dangling Symlink",
      "--secret-out",
      danglingSymlink,
    ]);
    expect(danglingRes.exitCode).toBe(2);
    expect(danglingRes.stderr).toMatch(/\[exit:2 \| /);
    expect(
      fs.existsSync(path.join(outsideSecretsDir, "never-created.key")),
    ).toBe(false);

    // 4. Unenrolled project or permanent/invalid expiry fails with navigation hints and zero credentials.
    const unenrolledRes = await execRootCli([
      "auth",
      "key",
      "create",
      "--grant",
      "ghost-project=operator",
      "--expires-at",
      validExpiresAt,
      "--label",
      "Unenrolled",
      "--secret-out",
      path.join(outsideSecretsDir, "ghost.key"),
    ]);
    expect([1, 2]).toContain(unenrolledRes.exitCode);
    expect(unenrolledRes.stderr).toContain("gwrk project list");

    const tooLongExpiry = new Date(
      Date.now() + 31 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const permanentRes = await execRootCli([
      "auth",
      "key",
      "create",
      "--grant",
      `${alphaProject.slug}=viewer`,
      "--expires-at",
      tooLongExpiry,
      "--label",
      "Exceeds 30d",
      "--secret-out",
      path.join(outsideSecretsDir, "too-long.key"),
    ]);
    expect(permanentRes.exitCode).toBe(2);
    expect(permanentRes.stderr).toMatch(/\[exit:2 \| /);

    // Confirm zero credentials exist after all pre-commit rejections.
    let store = createSqliteAuthStoreAdapter({ dbPath });
    try {
      expect(store.listApiCredentials()).toEqual([]);
    } finally {
      store.close();
    }

    // 5. Post-commit secret delivery failure via CLI (unwritable parent dir) leaves zero active keys and zero stdout secrets.
    const readOnlyDir = path.join(outsideSecretsDir, "readonly-parent");
    fs.mkdirSync(readOnlyDir, { mode: 0o500 });
    try {
      const failWriteRes = await execRootCli([
        "auth",
        "key",
        "create",
        "--grant",
        `${alphaProject.slug}=operator`,
        "--expires-at",
        validExpiresAt,
        "--label",
        "ReadOnly Dir",
        "--secret-out",
        path.join(readOnlyDir, "cannot-write.key"),
      ]);
      expect(failWriteRes.exitCode).toBe(1);
      expect(failWriteRes.stderr).toMatch(/\[exit:1 \| /);
      expect(failWriteRes.stdout).not.toContain("gwrk_v1.");
      expect(failWriteRes.stderr).not.toContain("gwrk_v1.");
    } finally {
      fs.chmodSync(readOnlyDir, 0o700);
    }

    store = createSqliteAuthStoreAdapter({ dbPath });
    try {
      const activeAfterCliFail = store
        .listApiCredentials()
        .filter((cred) => cred.revokedAt === null);
      expect(activeAfterCliFail).toEqual([]);
    } finally {
      store.close();
    }

    // 6. Direct use-case delivery failure after SQLite commit MUST revoke the newly committed orphan credential.
    const db = openDatabase({ dbPath });
    try {
      const authStore = createSqliteAuthStoreAdapter({ db });
      const projectRegistry = createSqliteProjectRegistryAdapter({ db });
      const crypto = createCredentialCryptoAdapter();
      const fixedNowMs = Date.parse("2026-11-23T18:00:00.000Z");
      const clock = {
        nowMs: () => fixedNowMs,
        nowIso: () => new Date(fixedNowMs).toISOString(),
      };
      const fixedExpiry = new Date(
        fixedNowMs + 7 * 24 * 60 * 60 * 1000,
      ).toISOString();

      let deliveredRaw = "";
      await expect(
        createApiCredential(
          {
            authStore,
            grantAdmin: authStore,
            crypto,
            clock,
            projectRegistry,
            deliverSecret: async (rawCredential) => {
              deliveredRaw = rawCredential;
              throw new Error("ENOSPC: simulated secret file delivery failure");
            },
          },
          {
            label: "Orphan Create",
            issuer: "local-admin",
            audienceOrigin: ORIGIN,
            expiresAt: fixedExpiry,
            grants: [{ projectId: alphaProject.projectId, role: "operator" }],
          },
        ),
      ).rejects.toThrow(/ENOSPC/);

      const parsedOrphan = parseOpaqueApiCredential(deliveredRaw);
      expect(parsedOrphan.ok).toBe(true);
      if (!parsedOrphan.ok) {
        throw new Error("Expected raw credential before delivery failure");
      }

      const orphan = authStore.findApiCredentialById(parsedOrphan.credentialId);
      expect(orphan).not.toBeNull();
      expect(orphan?.revokedAt).not.toBeNull();
      expect(orphan?.revokedReason).toMatch(/deliver|secret/i);

      // Also verify rotateApiCredential revokes its newly created orphan if delivery fails.
      const healthy = await createApiCredential(
        {
          authStore,
          grantAdmin: authStore,
          crypto,
          clock,
          projectRegistry,
          deliverSecret: async () => {},
        },
        {
          label: "Healthy Before Rotate",
          issuer: "local-admin",
          audienceOrigin: ORIGIN,
          expiresAt: fixedExpiry,
          grants: [{ projectId: alphaProject.projectId, role: "operator" }],
        },
      );

      let rotatedRaw = "";
      await expect(
        rotateApiCredential(
          {
            authStore,
            grantAdmin: authStore,
            crypto,
            clock,
            deliverSecret: async (rawCredential) => {
              rotatedRaw = rawCredential;
              throw new Error("ENOSPC: simulated rotate delivery failure");
            },
          },
          {
            targetCredentialId: healthy.credential.credentialId,
            issuer: "local-admin",
            audienceOrigin: ORIGIN,
            expiresAt: new Date(
              fixedNowMs + 14 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            reason: "rotate_test",
          },
        ),
      ).rejects.toThrow(/ENOSPC/);

      const parsedRotated = parseOpaqueApiCredential(rotatedRaw);
      expect(parsedRotated.ok).toBe(true);
      if (!parsedRotated.ok) {
        throw new Error("Expected rotated credential before delivery failure");
      }
      const orphanRotated = authStore.findApiCredentialById(
        parsedRotated.credentialId,
      );
      expect(orphanRotated?.revokedAt).not.toBeNull();
    } finally {
      db.close();
    }
  });

  it("TR-010 FR-006: emits ADR-004 signal and public metadata only across non-interactive list, rotate, and revoke outside .gwrkrc.json", async () => {
    // Run from a directory with NO .gwrkrc.json to prove src/cli.ts exempts `gwrk auth key` from cwd preflight.
    process.chdir(nonProjectDir);

    const firstSecretPath = path.join(outsideSecretsDir, "first.key");
    const createRes = await execRootCli(
      [
        "auth",
        "key",
        "create",
        "--grant",
        `${alphaProject.slug}=operator`,
        "--expires-at",
        validExpiresAt,
        "--label",
        "Ops Key v1",
        "--secret-out",
        firstSecretPath,
        "--format",
        "json",
      ],
      { agentMode: true },
    );
    expect(createRes.exitCode, createRes.stderr).toBe(0);
    expect(createRes.stderr).toMatch(/\[exit:0 \| /);

    const firstRaw = fs.readFileSync(firstSecretPath, "utf-8").trim();
    const firstParsed = parseOpaqueApiCredential(firstRaw);
    if (!firstParsed.ok) throw new Error("Expected valid first key");
    const firstId = firstParsed.credentialId;

    // `gwrk auth key list --format json` returns public metadata only and emits ADR-004 signal.
    const listRes = await execRootCli(
      ["auth", "key", "list", "--format", "json"],
      { agentMode: true },
    );
    expect(listRes.exitCode, listRes.stderr).toBe(0);
    expect(listRes.stderr).toMatch(/\[exit:0 \| /);
    expect(listRes.stdout).not.toContain(firstRaw);
    expect(listRes.stdout).not.toContain(firstParsed.secret);
    const listJson = JSON.parse(listRes.stdout) as {
      credentials: Array<Record<string, unknown>>;
    };
    expect(listJson.credentials).toHaveLength(1);
    expect(listJson.credentials[0]?.credentialId).toBe(firstId);
    expect("verifierSha256" in (listJson.credentials[0] ?? {})).toBe(false);

    // Passing a raw credential instead of a public credential ID to rotate or revoke MUST fail with exit 2 and never echo the secret.
    const rawRotateRes = await execRootCli([
      "auth",
      "key",
      "rotate",
      firstRaw,
      "--expires-at",
      laterExpiresAt,
      "--secret-out",
      path.join(outsideSecretsDir, "should-not-exist.key"),
    ]);
    expect(rawRotateRes.exitCode).toBe(2);
    expect(rawRotateRes.stderr).toMatch(/\[exit:2 \| /);
    expect(rawRotateRes.stderr).not.toContain(firstParsed.secret);
    expect(rawRotateRes.stdout).not.toContain(firstParsed.secret);

    const rawRevokeRes = await execRootCli(["auth", "key", "revoke", firstRaw]);
    expect(rawRevokeRes.exitCode).toBe(2);
    expect(rawRevokeRes.stderr).toMatch(/\[exit:2 \| /);
    expect(rawRevokeRes.stderr).not.toContain(firstParsed.secret);

    // `gwrk auth key rotate <id> --expires-at ... --secret-out ... --format json`
    const rotatedSecretPath = path.join(outsideSecretsDir, "second.key");
    const rotateRes = await execRootCli([
      "auth",
      "key",
      "rotate",
      firstId,
      "--expires-at",
      laterExpiresAt,
      "--secret-out",
      rotatedSecretPath,
      "--format",
      "json",
    ]);
    expect(rotateRes.exitCode, rotateRes.stderr).toBe(0);
    expect(rotateRes.stderr).toMatch(/\[exit:0 \| /);
    expect(fs.lstatSync(rotatedSecretPath).mode & 0o777).toBe(0o600);

    const secondRaw = fs.readFileSync(rotatedSecretPath, "utf-8").trim();
    const secondParsed = parseOpaqueApiCredential(secondRaw);
    if (!secondParsed.ok) throw new Error("Expected valid rotated key");
    expect(secondParsed.credentialId).not.toBe(firstId);
    expect(rotateRes.stdout).not.toContain(secondRaw);
    expect(rotateRes.stdout).not.toContain(secondParsed.secret);
    expect(rotateRes.stderr).not.toContain(secondParsed.secret);

    const rotateJson = JSON.parse(rotateRes.stdout) as {
      created: { credentialId: string; rotatedFromId: string | null };
      revokedCredentialId: string | null;
      copiedGrants: Array<{ projectId: string; role: string }>;
      secretOut: string;
    };
    expect(rotateJson.created.credentialId).toBe(secondParsed.credentialId);
    expect(rotateJson.created.rotatedFromId).toBe(firstId);
    expect(rotateJson.revokedCredentialId).toBe(firstId);
    expect(rotateJson.secretOut).toBe(rotatedSecretPath);
    expect(rotateJson.copiedGrants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: alphaProject.projectId,
          role: "operator",
        }),
      ]),
    );

    // `gwrk auth key revoke <id> --format json` revokes the rotated key and persists audit trail.
    const revokeRes = await execRootCli([
      "auth",
      "key",
      "revoke",
      secondParsed.credentialId,
      "--format",
      "json",
    ]);
    expect(revokeRes.exitCode, revokeRes.stderr).toBe(0);
    expect(revokeRes.stderr).toMatch(/\[exit:0 \| /);
    const revokeJson = JSON.parse(revokeRes.stdout) as {
      credentialId: string;
      revoked: boolean;
    };
    expect(revokeJson.credentialId).toBe(secondParsed.credentialId);
    expect(revokeJson.revoked).toBe(true);

    // Revoking an unknown credential ID exits 1 with corrective navigation hint.
    const unknownRevoke = await execRootCli([
      "auth",
      "key",
      "revoke",
      "cred_does_not_exist",
    ]);
    expect(unknownRevoke.exitCode).toBe(1);
    expect(unknownRevoke.stderr).toMatch(/\[exit:1 \| /);
    expect(unknownRevoke.stderr).toContain("gwrk auth key list");

    // Reopen SQLite to verify both keys are revoked and neither raw key exists anywhere in the DB.
    const reopened = openDatabase({ dbPath });
    try {
      const store = createSqliteAuthStoreAdapter({ db: reopened });
      expect(store.findApiCredentialById(firstId)?.revokedAt).not.toBeNull();
      expect(
        store.findApiCredentialById(secondParsed.credentialId)?.revokedAt,
      ).not.toBeNull();
      const allCreds = JSON.stringify(
        reopened.prepare("SELECT * FROM api_credentials").all(),
      );
      expect(allCreds).not.toContain(firstParsed.secret);
      expect(allCreds).not.toContain(secondParsed.secret);
    } finally {
      reopened.close();
    }
  });

  it("TR-010 US-004: gwrk auth key list text output displays full untruncated credential IDs usable with revoke", async () => {
    process.chdir(nonProjectDir);

    const secretPath = path.join(outsideSecretsDir, "text-list.key");
    const createRes = await execRootCli([
      "auth",
      "key",
      "create",
      "--grant",
      `${alphaProject.slug}=operator`,
      "--expires-at",
      validExpiresAt,
      "--label",
      "Text List Key",
      "--secret-out",
      secretPath,
      "--format",
      "json",
    ]);
    expect(createRes.exitCode, createRes.stderr).toBe(0);

    const created = JSON.parse(createRes.stdout) as {
      credential: { credentialId: string };
    };
    const fullCredentialId = created.credential.credentialId;
    expect(fullCredentialId.length).toBeGreaterThan(28);

    const listTextRes = await execRootCli(["auth", "key", "list"]);
    expect(listTextRes.exitCode, listTextRes.stderr).toBe(0);
    expect(listTextRes.stderr).toMatch(/\[exit:0 \| /);
    expect(listTextRes.stdout).toContain(fullCredentialId);

    const idRow = listTextRes.stdout
      .split("\n")
      .find((line) => line.startsWith("cred_"));
    expect(idRow).toBeDefined();
    const displayedId = idRow?.trim().split(/\s+/)[0] ?? "";
    expect(displayedId).toBe(fullCredentialId);

    const revokeUsingListedId = await execRootCli([
      "auth",
      "key",
      "revoke",
      displayedId,
    ]);
    expect(revokeUsingListedId.exitCode, revokeUsingListedId.stderr).toBe(0);
    expect(revokeUsingListedId.stderr).toMatch(/\[exit:0 \| /);
  });
});
