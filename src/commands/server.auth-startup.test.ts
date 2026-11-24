/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCredentialCryptoAdapter } from "../adapters/auth/credential-crypto.js";
import * as protectedFiles from "../adapters/auth/protected-hosted-auth-files.js";
import * as gwrkPaths from "../adapters/config/paths.js";
import * as instanceLock from "../adapters/server/instance-lock.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import {
  createSqliteAuthStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";
import { runCli } from "../cli.js";
import { closeDb, openDatabase } from "../db/index.js";
import { computeProjectId } from "../domain/project-id.js";
import { HarvestWatcher } from "../server/harvest-watcher.js";
import * as serverModule from "../server/index.js";
import { SystemMonitor } from "../server/monitor.js";
import * as pidUtils from "../server/pid.js";
import { SandboxManager } from "../server/sandbox.js";
import * as slackModule from "../server/slack.js";
import { loadConfig } from "../utils/config.js";

const ORIGIN = "https://gwrk.gforge.ai";
const SECRETS_ROOT = "/etc/gwrk/secrets";
const ALLOWLIST_FILE = `${SECRETS_ROOT}/google-account-allowlist`;
const HMAC_FILE = `${SECRETS_ROOT}/csrf-hmac-key`;
const CLIENT_ID = "pilot-startup-client.apps.googleusercontent.com";
const HMAC_KEY = Buffer.alloc(32, 31);
const CANARY = "CANARY_SECRET_VALUE_051";

const HOSTED_AUTH = Object.freeze({
  mode: "hosted" as const,
  publicOrigin: ORIGIN,
  googleClientId: CLIENT_ID,
  googleAllowlistFile: ALLOWLIST_FILE,
  csrfHmacKeyFile: HMAC_FILE,
});

const HOSTED_ENV = Object.freeze({
  GWRK_AUTH_MODE: "hosted",
  GWRK_AUTH_PUBLIC_ORIGIN: ORIGIN,
  GWRK_AUTH_GOOGLE_CLIENT_ID: CLIENT_ID,
  GWRK_AUTH_GOOGLE_ALLOWLIST_FILE: ALLOWLIST_FILE,
  GWRK_AUTH_CSRF_HMAC_FILE: HMAC_FILE,
  GWRK_SECRETS_DIR: SECRETS_ROOT,
});

let jwks: { keys: Record<string, unknown>[] };
let validGoogleToken: string;

beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "startup-k1",
    alg: "RS256",
    use: "sig",
  };
  jwks = { keys: [jwk] };
  const nowSec = Math.floor(Date.now() / 1000);
  validGoogleToken = await new SignJWT({
    email: "operator@example.test",
    email_verified: true,
  })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer("https://accounts.google.com")
    .setAudience(CLIENT_ID)
    .setSubject("startup-op-sub")
    .setIssuedAt(nowSec - 10)
    .setExpirationTime(nowSec + 3600)
    .sign(keys.privateKey);
});

function initGitRepo(repoDir: string, remoteUrl: string): string {
  fs.mkdirSync(repoDir, { recursive: true });
  const env = {
    ...repositoryGitEnv(repoDir),
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  execFileSync("git", ["init", "--template=", "--initial-branch=main"], {
    cwd: repoDir,
    env,
    stdio: "ignore",
  });
  execFileSync("git", ["remote", "add", "origin", remoteUrl], {
    cwd: repoDir,
    env,
    stdio: "ignore",
  });
  return computeProjectId({
    projectRoot: repoDir,
    remoteOriginUrl: remoteUrl,
    gitCommonDir: path.join(repoDir, ".git"),
  });
}

async function listenHttp(
  handler: http.RequestListener,
): Promise<{ server: http.Server; port: number; url: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("Expected numeric port");
  }
  return { server, port: addr.port, url: `http://127.0.0.1:${addr.port}` };
}

const AUTH_ENV_KEYS = [
  "GWRK_SECRETS_DIR",
  "GWRK_AUTH_MODE",
  "GWRK_AUTH_PUBLIC_ORIGIN",
  "GWRK_AUTH_GOOGLE_CLIENT_ID",
  "GWRK_AUTH_GOOGLE_ALLOWLIST_FILE",
  "GWRK_AUTH_CSRF_HMAC_FILE",
] as const;

describe("FR-008 / TR-017: hosted server startup composition and local liveness split", () => {
  let tmpDir: string;
  let projectDir: string;
  let gwrkHomeDir: string;
  let runtimeDir: string;
  let oldCwd: string;
  const savedAuthEnv = new Map<string, string | undefined>();
  const activeServers: FastifyInstance[] = [];
  const activeHttpServers: http.Server[] = [];

  beforeEach(() => {
    oldCwd = process.cwd();
    tmpDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-startup-auth-")),
    );
    projectDir = path.join(tmpDir, "project");
    gwrkHomeDir = path.join(tmpDir, "home");
    runtimeDir = path.join(tmpDir, "runtime");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(gwrkHomeDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    process.chdir(projectDir);

    savedAuthEnv.clear();
    for (const key of AUTH_ENV_KEYS) {
      savedAuthEnv.set(key, process.env[key]);
      delete process.env[key];
    }

    vi.stubEnv("GWRK_HOME", gwrkHomeDir);
    vi.stubEnv("GWRK_DIR", "");
    vi.stubEnv("GWRK_DB_PATH", path.join(gwrkHomeDir, "gwrk.db"));
    vi.stubEnv("GWRK_RUNTIME_DIR", "");
    vi.stubEnv("GWRK_PROJECT_ROOT", "");

    vi.spyOn(HarvestWatcher.prototype, "start").mockImplementation(() => {});
    vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(true);
    vi.spyOn(slackModule, "getSlackApp").mockReturnValue(null);
    vi.spyOn(slackModule, "startSlackApp").mockResolvedValue(undefined);
    vi.spyOn(slackModule, "stopSlackApp").mockResolvedValue(undefined);
  });

  afterEach(async () => {
    for (const s of activeServers.splice(0)) {
      await s.close().catch(() => {});
    }
    for (const s of activeHttpServers.splice(0)) {
      s.closeAllConnections();
      if (s.listening) {
        await new Promise<void>((resolve) => s.close(() => resolve()));
      }
    }
    closeDb();
    process.chdir(oldCwd);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    for (const [key, value] of savedAuthEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeProjectConfig(serverBlock: Record<string, unknown> = {}) {
    fs.writeFileSync(
      path.join(projectDir, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: "startup-pilot" },
        server: { host: "127.0.0.1", port: 0, ...serverBlock },
      }),
    );
  }

  function enrollAlphaProject(): string {
    const repoDir = path.join(tmpDir, "enrolled-alpha");
    const projectId = initGitRepo(repoDir, "git@github.com:org/alpha.git");
    const registry = createSqliteProjectRegistryAdapter();
    try {
      registry.enrollProject({
        projectId,
        slug: "alpha",
        name: "Alpha Pilot",
        repoSlug: "org/alpha",
        trunkBranch: "main",
        localRoot: repoDir,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local", "hosted"] },
        slack: null,
        legacyProjectIds: [],
        createdAt: "2026-11-24T00:00:00.000Z",
        updatedAt: "2026-11-24T00:00:00.000Z",
      });
    } finally {
      registry.close();
    }
    return projectId;
  }

  function wrapRealStartServer() {
    const realStart = serverModule.startServer;
    const calls: serverModule.ServerStartOptions[] = [];
    vi.spyOn(serverModule, "startServer").mockImplementation(
      async (cfg, opts) => {
        calls.push(opts ?? {});
        const instance = await realStart(cfg, {
          ...opts,
          handleSignals: false,
        });
        activeServers.push(instance);
        return instance;
      },
    );
    return calls;
  }

  async function runServerCli(args: string[]) {
    let stdout = "";
    let stderr = "";
    const exitCode = await runCli(["server", ...args], {
      stdout: (c) => {
        stdout += c;
      },
      stderr: (c) => {
        stderr += c;
      },
    });
    return { exitCode, stdout, stderr };
  }

  it("AUTH-17: loadConfig preserves partial typed server.auth across layers without injecting env or stripping invalid fields", () => {
    writeProjectConfig({
      auth: { googleClientId: CLIENT_ID },
    });
    fs.writeFileSync(
      path.join(gwrkHomeDir, "config.json"),
      JSON.stringify({ server: { auth: { publicOrigin: ORIGIN } } }),
    );
    vi.stubEnv("GWRK_AUTH_MODE", "hosted");
    vi.stubEnv("GWRK_AUTH_GOOGLE_CLIENT_ID", "env-conflict-client");

    const parsed = loadConfig(projectDir);
    const typedAuth = Reflect.get(parsed.server, "auth") as
      | Record<string, unknown>
      | undefined;
    expect(typedAuth).toEqual({
      googleClientId: CLIENT_ID,
      publicOrigin: ORIGIN,
    });
    expect(typedAuth?.mode).toBeUndefined();

    writeProjectConfig({ auth: { mode: "" } });
    expect(() => loadConfig(projectDir)).toThrow();
  });

  it.each([
    { name: "start --foreground", args: ["start", "--foreground"] },
    { name: "_run", args: ["_run"] },
  ])(
    "AUTH-17: $name fails closed before listening when hosted auth is missing on a hosted runner or incomplete",
    async ({ args }) => {
      writeProjectConfig();
      const listenSpy = vi.spyOn(net.Server.prototype, "listen");
      const writePidSpy = vi.spyOn(pidUtils, "writePid");
      const pruneSpy = vi.spyOn(SandboxManager.prototype, "pruneSandboxes");
      wrapRealStartServer();

      // 1. Hosted runner missing explicit GWRK_AUTH_MODE must never fall back to trusted_local.
      vi.spyOn(gwrkPaths, "usesHostedRuntime").mockReturnValue(true);
      vi.stubEnv("GWRK_RUNTIME_DIR", runtimeDir);
      const releaseInstance = vi.fn();
      const releaseLedger = vi.fn();
      vi.spyOn(instanceLock, "acquireInstanceLock").mockReturnValue({
        pid: process.pid,
        lockPath: path.join(runtimeDir, "server.lock"),
        release: releaseInstance,
      });
      vi.spyOn(instanceLock, "acquireLedgerLock").mockReturnValue({
        pid: process.pid,
        lockPath: path.join(gwrkHomeDir, ".gwrk.db.lock"),
        release: releaseLedger,
      });
      const missingMode = await runServerCli(args);
      expect(missingMode.exitCode).toBe(1);
      expect(missingMode.stderr).toMatch(/\[exit:1 \| /);
      expect(missingMode.stderr).not.toContain("Could not acquire");
      expect(activeServers).toHaveLength(0);
      expect(listenSpy).not.toHaveBeenCalled();
      expect(writePidSpy).not.toHaveBeenCalled();
      expect(pruneSpy).not.toHaveBeenCalled();

      // 2. Explicit trusted_local on hosted runner must also deny.
      process.env.GWRK_AUTH_MODE = "trusted_local";
      const localOnHosted = await runServerCli(args);
      expect(localOnHosted.exitCode).toBe(1);
      expect(activeServers).toHaveLength(0);
      expect(listenSpy).not.toHaveBeenCalled();

      // 3. Partial hosted config outside hosted runner must deny before listening.
      vi.spyOn(gwrkPaths, "usesHostedRuntime").mockReturnValue(false);
      vi.stubEnv("GWRK_RUNTIME_DIR", "");
      process.env.GWRK_AUTH_MODE = "hosted";
      const partial = await runServerCli(args);
      expect(partial.exitCode).toBe(1);
      expect(activeServers).toHaveLength(0);
      expect(listenSpy).not.toHaveBeenCalled();
      expect(writePidSpy).not.toHaveBeenCalled();
    },
  );

  it.each([
    { name: "project config", useRegistryFallback: false },
    { name: "registry fallback", useRegistryFallback: true },
  ])(
    "AUTH-17: rejects typed vs environment auth conflicts and malformed global overlay in $name path",
    async ({ useRegistryFallback }) => {
      const listenSpy = vi.spyOn(net.Server.prototype, "listen");
      wrapRealStartServer();

      if (useRegistryFallback) {
        enrollAlphaProject();
        fs.writeFileSync(
          path.join(gwrkHomeDir, "config.json"),
          JSON.stringify({
            server: {
              host: "127.0.0.1",
              port: 0,
              auth: { ...HOSTED_AUTH, googleClientId: "typed-client" },
            },
          }),
        );
      } else {
        writeProjectConfig({
          auth: { ...HOSTED_AUTH, googleClientId: "typed-client" },
        });
      }
      process.env.GWRK_AUTH_GOOGLE_CLIENT_ID = "env-different-client";
      process.env.GWRK_SECRETS_DIR = SECRETS_ROOT;

      for (const args of [["start", "--foreground"], ["_run"]]) {
        const conflict = await runServerCli(args);
        expect(conflict.exitCode).toBe(1);
        expect(activeServers).toHaveLength(0);
        expect(listenSpy).not.toHaveBeenCalled();
      }

      if (useRegistryFallback) {
        delete process.env.GWRK_AUTH_GOOGLE_CLIENT_ID;
        fs.writeFileSync(
          path.join(gwrkHomeDir, "config.json"),
          `{"server":{"auth":{"mode":"hosted","secret":"${CANARY}"`,
        );
        const malformed = await runServerCli(["start", "--foreground"]);
        expect(malformed.exitCode).toBe(1);
        expect(malformed.stdout + malformed.stderr).not.toContain(CANARY);
        expect(activeServers).toHaveLength(0);
        expect(listenSpy).not.toHaveBeenCalled();
      }
    },
  );

  it("AUTH-17: denies hosted startup before listening when protected inbound files fail without leaking secret contents", async () => {
    writeProjectConfig();
    for (const [k, v] of Object.entries(HOSTED_ENV)) vi.stubEnv(k, v);
    const listenSpy = vi.spyOn(net.Server.prototype, "listen");
    const writePidSpy = vi.spyOn(pidUtils, "writePid");
    wrapRealStartServer();

    vi.spyOn(protectedFiles, "resolveTrustedGwrkGroupId").mockResolvedValue(
      1479,
    );
    // Inject a reader failure to test caller denial before listening.
    // Native Linux file ownership is verified in protected-auth-files-native.mjs.
    const readAllowlist = vi.fn().mockRejectedValue(new Error(CANARY));
    const readCsrfHmacKey = vi.fn().mockResolvedValue(Buffer.from(HMAC_KEY));
    vi.spyOn(protectedFiles, "createProtectedHostedAuthFiles").mockReturnValue({
      readAllowlist,
      readCsrfHmacKey,
    });

    const badAllowlist = await runServerCli(["start", "--foreground"]);
    expect(badAllowlist.exitCode).toBe(1);
    expect(badAllowlist.stdout + badAllowlist.stderr).not.toContain(CANARY);
    expect(activeServers).toHaveLength(0);
    expect(listenSpy).not.toHaveBeenCalled();
    expect(writePidSpy).not.toHaveBeenCalled();

    readAllowlist.mockResolvedValue(["operator@example.test"]);
    readCsrfHmacKey.mockRejectedValue(new Error(`hmac-${CANARY}`));
    const badHmac = await runServerCli(["_run"]);
    expect(badHmac.exitCode).toBe(1);
    expect(badHmac.stdout + badHmac.stderr).not.toContain(CANARY);
    expect(activeServers).toHaveLength(0);
    expect(listenSpy).not.toHaveBeenCalled();
  });

  it.each([
    { name: "start --foreground", args: ["start", "--foreground"] },
    { name: "_run", args: ["_run"] },
  ])(
    "AUTH-17: $name explicitly selects hosted transport on loopback, shares the auth ledger, and rechecks live allowlist",
    async ({ args }) => {
      writeProjectConfig();
      const projectId = enrollAlphaProject();
      for (const [k, v] of Object.entries(HOSTED_ENV)) vi.stubEnv(k, v);

      let accounts: readonly string[] = ["operator@example.test"];
      // Mocked group/file seams test caller wiring only; native Linux root:gwrk 0640
      // ownership is proven separately by tests/hosted-pilot/protected-auth-files-native.mjs.
      vi.spyOn(protectedFiles, "resolveTrustedGwrkGroupId").mockResolvedValue(
        1479,
      );
      vi.spyOn(protectedFiles, "createProtectedHostedAuthFiles").mockReturnValue(
        {
          readAllowlist: vi.fn(async () => accounts),
          readCsrfHmacKey: vi.fn(async () => Buffer.from(HMAC_KEY)),
        },
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL) => {
          if (String(input) === "https://www.googleapis.com/oauth2/v3/certs") {
            return Response.json(jwks);
          }
          throw new Error(`Unexpected network call: ${String(input)}`);
        }),
      );

      // Seed one opaque API credential in the shared SQLite ledger before startup.
      const crypto = createCredentialCryptoAdapter();
      const generated = crypto.generateApiCredential("startup-api-key");
      const seedDb = openDatabase();
      try {
        const authStore = createSqliteAuthStoreAdapter({ db: seedDb });
        authStore.createCredentialWithGrants({
          credentialId: "startup-api-key",
          verifierSha256: generated.verifierSha256,
          label: "startup-probe",
          issuer: "local-admin",
          audienceOrigin: ORIGIN,
          createdAt: new Date(Date.now() - 1_000).toISOString(),
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          grants: [{ projectId, role: "viewer" }],
        });
      } finally {
        seedDb.close();
      }

      wrapRealStartServer();
      const result = await runServerCli(args);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(activeServers).toHaveLength(1);

      const server = activeServers[0];
      // Unauthenticated & forged-header requests fail closed on loopback hosted server,
      // proving loopback startup explicitly selected hosted transport with the real factory.
      const forged = await server.inject({
        method: "GET",
        url: `/api/status?projectId=${encodeURIComponent(projectId)}`,
        headers: {
          "x-forwarded-email": "operator@example.test",
          "x-gwrk-auth-mode": "google_id_token",
        },
      });
      expect(forged.statusCode).toBe(401);

      // Minimal /health returns private liveness without project readiness metadata.
      const minimalHealth = await server.inject({
        method: "GET",
        url: "/health",
      });
      expect(minimalHealth.statusCode).toBe(200);
      expect(minimalHealth.json()).toEqual({
        status: expect.stringMatching(/^(ok|degraded)$/),
        daemonLiveness: "alive",
      });

      // Valid opaque API credential from the shared ledger authenticates scoped status.
      const authed = await server.inject({
        method: "GET",
        url: `/api/status?projectId=${encodeURIComponent(projectId)}`,
        headers: { authorization: `Bearer ${generated.rawCredential}` },
      });
      expect(authed.statusCode).toBe(200);

      // Live allowlist change denies the next Google auth decision without restarting.
      const firstGoogle = await server.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: {
          "x-gwrk-auth-mode": "google_id_token",
          authorization: `Bearer ${validGoogleToken}`,
        },
      });
      expect(firstGoogle.statusCode).toBe(200);

      accounts = ["someone-else@example.test"];
      const afterRemoval = await server.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: {
          "x-gwrk-auth-mode": "google_id_token",
          authorization: `Bearer ${validGoogleToken}`,
        },
      });
      expect(afterRemoval.statusCode).toBe(403);
    },
  );

  it("FR-014: separates local liveness from authenticated readiness in gwrk server status", async () => {
    const requests: { url: string; auth?: string }[] = [];
    let redirectTo = "";
    let redirectMode = false;
    let trapHits = 0;

    const trap = await listenHttp((_req, res) => {
      trapHits++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", daemonLiveness: "alive" }));
    });
    activeHttpServers.push(trap.server);
    redirectTo = `${trap.url}/health?secret=${CANARY}`;

    const daemon = await listenHttp((req, res) => {
      requests.push({
        url: req.url ?? "",
        auth: req.headers.authorization,
      });
      if (redirectMode) {
        res.writeHead(302, { Location: redirectTo });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          daemonLiveness: "alive",
          // Even if a local endpoint returned readiness/Slack fields, server status
          // must report minimal liveness only and make no project-readiness claim.
          projectReadiness: { status: "ready", readyCount: 1, totalCount: 1 },
          slackDelivery: { mode: "socket_connected", connected: true },
        }),
      );
    });
    activeHttpServers.push(daemon.server);

    writeProjectConfig({ host: "127.0.0.1", port: daemon.port });
    vi.spyOn(pidUtils, "readPid").mockReturnValue(process.pid);
    vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(true);
    vi.stubEnv("GWRK_API_KEY", CANARY);
    vi.stubEnv("GWRK_SERVER_API_KEY", CANARY);

    const okResult = await runServerCli(["status"]);
    expect(okResult.exitCode, okResult.stderr).toBe(0);
    expect(okResult.stderr).toMatch(/\[exit:0 \| /);
    expect(requests).toEqual([{ url: "/health", auth: undefined }]);
    expect(okResult.stdout).toContain("Server: running");
    expect(okResult.stdout).toContain("Health: ok");
    expect(okResult.stdout).toContain("Daemon: alive");
    expect(okResult.stdout).not.toContain("Projects:");
    expect(okResult.stdout).not.toContain("Slack:");
    expect(okResult.stdout + okResult.stderr).not.toContain(CANARY);

    // Redirect on /health must be denied without following Location or leaking secrets.
    requests.length = 0;
    redirectMode = true;
    const redirectResult = await runServerCli(["status"]);
    expect(redirectResult.exitCode).toBe(1);
    expect(redirectResult.stderr).toMatch(/\[exit:1 \| /);
    expect(requests).toHaveLength(1);
    expect(trapHits).toBe(0);
    expect(redirectResult.stdout + redirectResult.stderr).not.toContain(CANARY);
  });

  it("AUTH-17 regression: non-loopback bind without hosted auth never falls back to trusted_local", async () => {
    writeProjectConfig({ host: "0.0.0.0", port: 0 });
    const projectId = enrollAlphaProject();
    const listenSpy = vi.spyOn(net.Server.prototype, "listen");
    wrapRealStartServer();

    for (const args of [["start", "--foreground"], ["_run"]]) {
      const result = await runServerCli(args);
      if (result.exitCode === 0 && activeServers.length > 0) {
        const srv = activeServers[activeServers.length - 1];
        const unauth = await srv.inject({
          method: "GET",
          url: `/api/status?projectId=${encodeURIComponent(projectId)}`,
        });
        expect(unauth.statusCode).toBe(401);
      } else {
        expect(result.exitCode).toBe(1);
        expect(listenSpy).not.toHaveBeenCalled();
      }
    }
  });

  it("AUTH-17 regression: incomplete hosted auth config fails before creating gwrk.db", async () => {
    const dbPath = path.join(gwrkHomeDir, "gwrk.db");
    writeProjectConfig();
    const listenSpy = vi.spyOn(net.Server.prototype, "listen");
    wrapRealStartServer();

    process.env.GWRK_AUTH_MODE = "hosted";
    const incomplete = await runServerCli(["start", "--foreground"]);
    expect(incomplete.exitCode).toBe(1);
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(listenSpy).not.toHaveBeenCalled();
  });

  it("AUTH-17 regression: hosted startup failure inside startServer does not leak an open SQLite handle", async () => {
    const blocker = await listenHttp((_req, res) => {
      res.writeHead(200);
      res.end();
    });
    activeHttpServers.push(blocker.server);
    writeProjectConfig({ host: "127.0.0.1", port: blocker.port });
    for (const [k, v] of Object.entries(HOSTED_ENV)) vi.stubEnv(k, v);
    vi.spyOn(protectedFiles, "resolveTrustedGwrkGroupId").mockResolvedValue(
      1479,
    );
    vi.spyOn(protectedFiles, "createProtectedHostedAuthFiles").mockReturnValue({
      readAllowlist: vi.fn(async () => ["operator@example.test"]),
      readCsrfHmacKey: vi.fn(async () => Buffer.from(HMAC_KEY)),
    });

    const dbModule = await import("../db/index.js");
    const realOpen = dbModule.openDatabase;
    const openedHandles: ReturnType<typeof realOpen>[] = [];
    vi.spyOn(dbModule, "openDatabase").mockImplementation((opts) => {
      const handle = realOpen(opts);
      openedHandles.push(handle);
      return handle;
    });

    wrapRealStartServer();
    try {
      const failedStart = await runServerCli(["start", "--foreground"]);
      expect(failedStart.exitCode).toBe(1);
      for (const handle of openedHandles) {
        expect(handle.open).toBe(false);
      }
    } finally {
      for (const handle of openedHandles) {
        if (handle.open) handle.close();
      }
    }
  });

  it("AUTH-17 regression: hosted startup with .restore-pending fails before opening or migrating gwrk.db", async () => {
    const dbPath = path.join(gwrkHomeDir, "gwrk.db");
    writeProjectConfig();
    for (const [k, v] of Object.entries(HOSTED_ENV)) vi.stubEnv(k, v);
    fs.writeFileSync(path.join(gwrkHomeDir, ".restore-pending"), "pending\n");

    vi.spyOn(protectedFiles, "resolveTrustedGwrkGroupId").mockResolvedValue(
      1479,
    );
    vi.spyOn(protectedFiles, "createProtectedHostedAuthFiles").mockReturnValue({
      readAllowlist: vi.fn(async () => ["operator@example.test"]),
      readCsrfHmacKey: vi.fn(async () => Buffer.from(HMAC_KEY)),
    });
    vi.spyOn(gwrkPaths, "usesHostedRuntime").mockReturnValue(true);
    vi.stubEnv("GWRK_RUNTIME_DIR", runtimeDir);
    vi.spyOn(instanceLock, "acquireInstanceLock").mockReturnValue({
      pid: process.pid,
      lockPath: path.join(runtimeDir, "server.lock"),
      release: vi.fn(),
    });
    vi.spyOn(instanceLock, "acquireLedgerLock").mockReturnValue({
      pid: process.pid,
      lockPath: path.join(gwrkHomeDir, ".gwrk.db.lock"),
      release: vi.fn(),
    });

    const dbModule = await import("../db/index.js");
    const openSpy = vi.spyOn(dbModule, "openDatabase");
    wrapRealStartServer();

    const pendingRestore = await runServerCli(["start", "--foreground"]);
    expect(pendingRestore.exitCode).toBe(1);
    expect(openSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("AUTH-17 regression: registry fallback does not swallow validateTypedAuthSource denial on unicode-escaped auth key", async () => {
    enrollAlphaProject();
    const listenSpy = vi.spyOn(net.Server.prototype, "listen");
    wrapRealStartServer();

    fs.writeFileSync(
      path.join(gwrkHomeDir, "config.json"),
      `{"server":{"host":"127.0.0.1","port":0,"\\u0061uth":{"mode":"${CANARY}"}}}`,
    );

    const result = await runServerCli(["start", "--foreground"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(CANARY);
    expect(activeServers).toHaveLength(0);
    expect(listenSpy).not.toHaveBeenCalled();
  });

  it("AUTH-17 regression: startup auth failure names failing setting without echoing secret values", async () => {
    writeProjectConfig();
    for (const [k, v] of Object.entries(HOSTED_ENV)) vi.stubEnv(k, v);
    wrapRealStartServer();

    vi.spyOn(protectedFiles, "resolveTrustedGwrkGroupId").mockResolvedValue(
      1479,
    );
    vi.spyOn(protectedFiles, "createProtectedHostedAuthFiles").mockReturnValue({
      readAllowlist: vi.fn(async () => ["operator@example.test"]),
      readCsrfHmacKey: vi.fn().mockRejectedValue(new Error(CANARY)),
    });

    const result = await runServerCli(["start", "--foreground"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("csrfHmacKeyFile");
    expect(result.stdout + result.stderr).not.toContain(CANARY);
  });
});
