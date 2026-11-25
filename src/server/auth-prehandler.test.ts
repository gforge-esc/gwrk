/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import fastify from "fastify";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createBrowserCsrfAdapter } from "../adapters/auth/browser-csrf.js";
import { createCredentialCryptoAdapter } from "../adapters/auth/credential-crypto.js";
import { createGoogleIdentityVerifier } from "../adapters/auth/google-id-token.js";
import * as gwrkPaths from "../adapters/config/paths.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import {
  createSqliteAuthStoreAdapter,
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";
import { createRequestAuthenticator } from "../application/auth/authenticate-request.js";
import { createBrowserSessionService } from "../application/auth/browser-session.js";
import { openDatabase } from "../db/index.js";
import type {
  StoredApiCredential,
  StoredGoogleSession,
} from "../domain/auth-policy.js";
import { computeProjectId } from "../domain/project-id.js";
import type {
  AuthStorePort,
  BrowserCsrfPort,
  CredentialCryptoPort,
  ProxySessionLogoutPort,
} from "../ports/auth-port.js";
import type { NotificationPort } from "../ports/notification-port.js";
import type {
  GitHubHarvestPort,
  WorkerExecutionPort,
} from "../ports/operations-port.js";
import { GwrkConfigSchema } from "../utils/config.js";
import {
  readVerifiedAuthContext,
  registerHostedAuthGuard,
  resolveVerifiedPrincipal,
} from "./auth-guard.js";
import { HarvestWatcher } from "./harvest-watcher.js";
import { startServer } from "./index.js";
import { SystemMonitor } from "./monitor.js";
import type { SandboxManager } from "./sandbox.js";

vi.mock("./slack.js", () => ({
  getSlackApp: vi.fn().mockReturnValue(null),
  isSlackConnected: vi.fn().mockResolvedValue(false),
  startSlackApp: vi.fn().mockResolvedValue(undefined),
  stopSlackApp: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./slack-notify.js", () => ({
  notifySlack: vi.fn().mockResolvedValue(undefined),
}));

const ORIGIN = "https://gwrk.gforge.ai";
const NOW = Date.parse("2026-11-23T18:00:00Z");
const KEY = `gwrk_v1.test-id.${"a".repeat(43)}`;
const iso = (time: number) => new Date(time).toISOString();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let forgedKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: { keys: object[] };
let googleToken: string;
let forgedToken: string;
const cleanup: (() => Promise<void>)[] = [];

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  forgedKeys = await generateKeyPair("RS256");
  jwks = {
    keys: [
      { ...(await exportJWK(keys.publicKey)), kid: "synthetic", alg: "RS256" },
    ],
  };
  const sign = (privateKey: typeof keys.privateKey) =>
    new SignJWT({ email: "operator@example.test", email_verified: true })
      .setProtectedHeader({ alg: "RS256", kid: "synthetic" })
      .setIssuer("https://accounts.google.com")
      .setAudience("synthetic-client")
      .setSubject("operator")
      .setIssuedAt(NOW / 1000 - 1)
      .setExpirationTime(NOW / 1000 + 600)
      .sign(privateKey);
  googleToken = await sign(keys.privateKey);
  forgedToken = await sign(forgedKeys.privateKey);
});
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

async function fixture(
  options: {
    configureGuard?: boolean;
    fetchGate?: Promise<void>;
    credential?: Partial<StoredApiCredential>;
    dependencyFailure?: boolean;
    csrf?: BrowserCsrfPort;
    expectedOrigin?: string;
  } = {},
) {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE operations (principal TEXT NOT NULL)");
  const app = fastify({ logger: false });
  cleanup.push(async () => {
    await app.close();
    db.close();
  });
  const sessions = new Map<string, StoredGoogleSession>();
  const record: StoredApiCredential = {
    credentialId: "test-id",
    label: "synthetic",
    issuer: "local",
    audienceOrigin: ORIGIN,
    createdAt: iso(NOW - 1000),
    expiresAt: iso(NOW + 600_000),
    revokedAt: null,
    revokedReason: null,
    rotatedFromId: null,
    overlapUntil: null,
    verifierSha256: hash(KEY),
    ...options.credential,
  };
  const store: AuthStorePort = {
    findApiCredentialById: (id) => (id === record.credentialId ? record : null),
    listApiCredentials: () => [],
    revokeApiCredential: () => false,
    observeGoogleSession: (input) => {
      const old = sessions.get(input.tokenDigestSha256);
      if (old?.revokedAt) return { ok: false, code: "SESSION_REVOKED" };
      const session = old ?? { ...input, revokedAt: null, revokedReason: null };
      sessions.set(input.tokenDigestSha256, session);
      return { ok: true, session, created: !old };
    },
    getGoogleSession: (digest) => sessions.get(digest) ?? null,
    revokeGoogleSession: () => false,
    appendAuditEvent: () => {},
    close: () => {},
  };
  const crypto: CredentialCryptoPort = {
    generateApiCredential: () => {
      throw new Error("Issuance forbidden");
    },
    hashCredential: hash,
    hashTokenDigest: hash,
    verifySha256Equal: (expected, candidate) =>
      timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(candidate, "hex"),
      ),
  };
  let validationStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    validationStarted = resolve;
  });
  const google = createGoogleIdentityVerifier({
    clientId: "synthetic-client",
    readAllowlist: async () => ["operator@example.test"],
    fetch: async () => {
      validationStarted();
      await options.fetchGate;
      return Response.json(jwks);
    },
  });
  const authenticate = createRequestAuthenticator({
    store,
    crypto,
    google,
    clock: { nowMs: () => NOW, nowIso: () => iso(NOW) },
    expectedOrigin: ORIGIN,
  });
  registerHostedAuthGuard(
    app,
    options.configureGuard === false
      ? {}
      : {
          authenticate: options.dependencyFailure
            ? async () => {
                throw new Error(`upstream ${KEY}`);
              }
            : authenticate,
          csrf: options.csrf,
          expectedOrigin: options.expectedOrigin,
        },
  );
  const handler = vi.fn(async (request) => {
    const context = readVerifiedAuthContext(request);
    const principal = resolveVerifiedPrincipal(request);
    db.prepare("INSERT INTO operations VALUES (?)").run(
      principal?.principalId ?? "none",
    );
    return { context: context ?? null, principal: principal ?? null };
  });
  app.post("/api/dispatch", handler);
  app.get("/api/status", handler);
  app.get("/health", handler);
  app.get("/unclassified", handler);
  app.put("/api/status", handler);
  await app.ready();
  return {
    app,
    handler,
    sessions,
    started,
    rows: () =>
      (
        db.prepare("SELECT COUNT(*) AS count FROM operations").get() as {
          count: number;
        }
      ).count,
  };
}

describe("hosted asynchronous authentication guard", () => {
  it.each([
    {
      "x-forwarded-user": "admin",
      "x-forwarded-email": "operator@example.test",
      "x-forwarded-groups": "maintainer",
      "x-forwarded-preferred-username": "admin",
      "x-forwarded-access-token": "forged",
      "x-auth-request-email": "operator@example.test",
      "x-auth-request-access-token": "forged",
      "x-auth-request-user": "admin",
    },
    {
      "x-gwrk-auth-mode": "trusted_local",
      "x-gwrk-principal-id": "admin",
      "x-gwrk-role": "maintainer",
    },
    {
      "x-gwrk-auth-mode": "google_id_token",
      "x-auth-request-email": "operator@example.test",
    },
    { "x-gwrk-auth-mode": "api_key", "x-forwarded-for": "127.0.0.1" },
  ])(
    "AUTH-04: forged headers cannot create a principal or operation %#",
    async (headers) => {
      const f = await fixture();
      const response = await f.app.inject({
        method: "POST",
        url: "/api/dispatch",
        headers,
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        ok: false,
        requestId: expect.any(String),
      });
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.rows()).toBe(0);
      expect(f.sessions.size).toBe(0);
    },
  );
  it.each([
    undefined,
    "Basic forbidden",
    "Bearer bad",
    `Bearer gwrk_v1.test-id.${"b".repeat(43)}`,
    "Bearer gwrk_v2.test-id.bad",
  ])(
    "AUTH-07: rejects invalid opaque credentials %#",
    async (authorization) => {
      const f = await fixture();
      const response = await f.app.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: authorization ? { authorization } : {},
      });
      expect(response.statusCode).toBe(401);
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.rows()).toBe(0);
    },
  );
  it.each([
    { expiresAt: iso(NOW) },
    { revokedAt: iso(NOW - 1) },
    { audienceOrigin: "https://other.example.test" },
  ])(
    "AUTH-07: denies inactive or wrong-origin credentials %#",
    async (credential) => {
      const f = await fixture({ credential });
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: "/api/dispatch",
            headers: { authorization: `Bearer ${KEY}` },
          })
        ).statusCode,
      ).toBe(401);
      expect(f.rows()).toBe(0);
    },
  );
  it("reads a verified API principal synchronously and excludes secret material", async () => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: { authorization: `Bearer ${KEY}`, "x-forwarded-user": "forged" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      context: {
        principalType: "cli_token",
        principalId: "test-id",
        credentialId: "test-id",
        expiresAt: iso(NOW + 600_000),
        authMethod: "api_key",
      },
      principal: { principalType: "cli_token", principalId: "test-id" },
    });
    expect(response.body).not.toContain(KEY);
    expect(f.rows()).toBe(1);
  });
  it("denies an absent authenticator instead of selecting local trust", async () => {
    const f = await fixture({ configureGuard: false });
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/dispatch",
          headers: { authorization: `Bearer ${KEY}` },
        })
      ).statusCode,
    ).toBe(503);
    expect(f.rows()).toBe(0);
  });
  it.each([
    { method: "GET", url: "/unclassified", status: 404 },
    { method: "PUT", url: "/api/status", status: 405 },
  ])(
    "default-denies routes and methods %#",
    async ({ method, url, status }) => {
      const f = await fixture();
      const response = await f.app.inject({
        method: method as "GET" | "PUT",
        url,
        headers: { authorization: `Bearer ${KEY}` },
      });
      expect(response.statusCode).toBe(status);
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.rows()).toBe(0);
    },
  );
  it("AUTH-04: request payload cannot populate the verified decoration", async () => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "POST",
      url: "/api/dispatch",
      payload: {
        verifiedAuth: {
          principalType: "cli_token",
          principalId: "admin",
          authMethod: "api_key",
        },
        gwrkVerifiedAuth: { principalType: "google_sub", principalId: "admin" },
      },
    });
    expect(response.statusCode).toBe(401);
    expect(f.handler).not.toHaveBeenCalled();
    expect(f.rows()).toBe(0);
  });
  it("sanitizes thrown dependency failures and accepts no work", async () => {
    const f = await fixture({ dependencyFailure: true });
    const response = await f.app.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: { authorization: `Bearer ${KEY}` },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ok: false,
      code: "AUTH_DEPENDENCY_UNAVAILABLE",
      requestId: expect.any(String),
    });
    expect(response.body).not.toContain(KEY);
    expect(response.body).not.toContain("upstream");
    expect(f.rows()).toBe(0);
  });
  it("does not reuse a previous request's principal", async () => {
    const f = await fixture();
    expect(
      (
        await f.app.inject({
          method: "GET",
          url: "/api/status",
          headers: { authorization: `Bearer ${KEY}` },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await f.app.inject({ method: "POST", url: "/api/dispatch" })).statusCode,
    ).toBe(401);
    expect(f.handler).toHaveBeenCalledTimes(1);
    expect(f.rows()).toBe(1);
  });
  it("local servers without the hosted guard retain their independent route behavior", async () => {
    const app = fastify();
    cleanup.push(async () => {
      await app.close();
    });
    app.post("/local-only", async () => ({ mode: "local" }));
    const response = await app.inject({ method: "POST", url: "/local-only" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ mode: "local" });
  });
  it("AUTH-04: a forged Google signature cannot create a session or work", async () => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: {
        authorization: `Bearer ${forgedToken}`,
        "x-gwrk-auth-mode": "google_id_token",
        "x-forwarded-user": "admin",
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("AUTH_TOKEN_INVALID");
    expect(f.rows()).toBe(0);
    expect(f.sessions.size).toBe(0);
  });
  it("finishes cryptographic verification before calling the handler or inserting an operation", async () => {
    let release!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await fixture({ fetchGate });
    const pending = f.app.inject({
      method: "GET",
      url: "/api/status",
      headers: {
        authorization: `Bearer ${googleToken}`,
        "x-gwrk-auth-mode": "google_id_token",
      },
    });
    const responsePromise = Promise.resolve(pending);
    try {
      await Promise.race([
        f.started,
        responsePromise.then(() => {
          throw new Error(
            "Handler completed before cryptographic verification started",
          );
        }),
      ]);
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.rows()).toBe(0);
      expect(f.sessions.size).toBe(0);
    } finally {
      release();
    }
    const response = await responsePromise;
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      context: {
        authMethod: "google_id_token",
        principalId: "https://accounts.google.com:operator",
        sessionDigest: hash(googleToken),
      },
    });
    expect(f.rows()).toBe(1);
  });
  it.each([
    undefined,
    "api_key",
    "webhook",
    "trusted_local",
    "google_id_token, api_key",
  ])("Google tokens require the exact Google parser hint %#", async (hint) => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "GET",
      url: "/api/status",
      headers: {
        authorization: `Bearer ${googleToken}`,
        ...(hint ? { "x-gwrk-auth-mode": hint } : {}),
      },
    });
    expect(response.statusCode).toBe(401);
    expect(f.rows()).toBe(0);
    expect(f.sessions.size).toBe(0);
  });
  it.each([undefined, "api_key"])(
    "API keys work with absent or API parser hints %#",
    async (hint) => {
      const f = await fixture();
      const response = await f.app.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: {
          authorization: `Bearer ${KEY}`,
          ...(hint ? { "x-gwrk-auth-mode": hint } : {}),
          cookie: "unrelated=present",
        },
      });
      expect(response.statusCode).toBe(200);
      expect(f.rows()).toBe(1);
    },
  );
  it.each(["__Host-gwrk_session=proxy", "__Host-gwrk_session_0=chunk"])(
    "API key with a browser session denies without cookie fallback %#",
    async (cookie) => {
      const f = await fixture();
      const response = await f.app.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: {
          authorization: `Bearer ${KEY}`,
          cookie,
          "x-gwrk-auth-mode": "api_key",
        },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe("AUTH_CONFLICTING_CREDENTIALS");
      expect(f.rows()).toBe(0);
      expect(f.sessions.size).toBe(0);
    },
  );
  it.each([{}, { expectedOrigin: ORIGIN }])(
    "Google mutations deny without the required CSRF dependencies %#",
    async (options) => {
      const f = await fixture(options);
      const response = await f.app.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: {
          authorization: `Bearer ${googleToken}`,
          "x-gwrk-auth-mode": "google_id_token",
          origin: ORIGIN,
          "x-gwrk-csrf-token": "token",
        },
      });
      expect(response.statusCode).toBe(403);
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.rows()).toBe(0);
    },
  );
  it.each([
    {
      origin: undefined,
      token: "token",
      cookie: "__Host-gwrk_csrf=secret",
      url: "/api/dispatch",
    },
    {
      origin: "https://other.example.test",
      token: "token",
      cookie: "__Host-gwrk_csrf=secret",
      url: "/api/dispatch",
    },
    {
      origin: ORIGIN,
      token: undefined,
      cookie: "__Host-gwrk_csrf=secret",
      url: "/api/dispatch",
    },
    {
      origin: ORIGIN,
      token: "token",
      cookie: "__Host-gwrk_csrf=secret",
      url: "/api/dispatch?csrf_token=query",
    },
    {
      origin: ORIGIN,
      token: "token",
      cookie: "__Host-gwrk_csrf=other",
      url: "/api/dispatch",
    },
  ])(
    "AUTH-11: origin and session-bound header CSRF checks precede operation effects %#",
    async ({ origin, token, cookie, url }) => {
      const csrf: BrowserCsrfPort = {
        issueToken: async () => ({ token: "token", cookieHeader: "cookie" }),
        clearCookieHeader: () => "clear",
        verifyToken: vi.fn(
          async ({ cookieValue, sessionDigest }) =>
            cookieValue === "secret" && sessionDigest === hash(googleToken),
        ),
      };
      const f = await fixture({ csrf, expectedOrigin: ORIGIN });
      const response = await f.app.inject({
        method: "POST",
        url,
        headers: {
          authorization: `Bearer ${googleToken}`,
          "x-gwrk-auth-mode": "google_id_token",
          cookie,
          ...(origin ? { origin } : {}),
          ...(token ? { "x-gwrk-csrf-token": token } : {}),
        },
      });
      expect(response.statusCode).toBe(403);
      expect(f.rows()).toBe(0);
      expect(f.handler).not.toHaveBeenCalled();
    },
  );
  it("binds a permitted browser mutation to the verified digest", async () => {
    const csrf: BrowserCsrfPort = {
      issueToken: async () => ({ token: "token", cookieHeader: "cookie" }),
      clearCookieHeader: () => "clear",
      verifyToken: vi.fn(async () => true),
    };
    const f = await fixture({ csrf, expectedOrigin: ORIGIN });
    const response = await f.app.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: {
        authorization: `Bearer ${googleToken}`,
        "x-gwrk-auth-mode": "google_id_token",
        origin: ORIGIN,
        "x-gwrk-csrf-token": "header-token",
        cookie: "unrelated=value; __Host-gwrk_csrf=secret",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(csrf.verifyToken).toHaveBeenCalledWith({
      sessionDigest: hash(googleToken),
      headerToken: "header-token",
      cookieValue: "secret",
    });
    expect(f.rows()).toBe(1);
  });
  it("HEAD follows authenticated read policy", async () => {
    const f = await fixture();
    expect(
      (await f.app.inject({ method: "HEAD", url: "/api/status" })).statusCode,
    ).toBe(401);
    expect(
      (
        await f.app.inject({
          method: "HEAD",
          url: "/api/status",
          headers: { authorization: `Bearer ${KEY}` },
        })
      ).statusCode,
    ).toBe(200);
    expect(f.rows()).toBe(1);
  });
  it("private liveness cannot manufacture a principal from headers", async () => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "GET",
      url: "/health",
      headers: { authorization: `Bearer ${KEY}`, "x-forwarded-user": "admin" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ context: null, principal: null });
  });
});

function initHostedGuardRepo(repoDir: string, remoteUrl: string): string {
  fs.mkdirSync(repoDir, { recursive: true });
  const gitEnv = {
    ...repositoryGitEnv(repoDir),
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Gwrk Test",
    GIT_AUTHOR_EMAIL: "gwrk-test@example.invalid",
    GIT_COMMITTER_NAME: "Gwrk Test",
    GIT_COMMITTER_EMAIL: "gwrk-test@example.invalid",
    GIT_TERMINAL_PROMPT: "0",
  };
  execFileSync("git", ["init", "--template=", "--initial-branch=main"], {
    cwd: repoDir,
    env: gitEnv,
    stdio: "ignore",
  });
  execFileSync("git", ["remote", "add", "origin", remoteUrl], {
    cwd: repoDir,
    env: gitEnv,
    stdio: "ignore",
  });
  return computeProjectId({
    projectRoot: repoDir,
    remoteOriginUrl: remoteUrl,
    gitCommonDir: path.join(repoDir, ".git"),
  });
}

async function createFullServerGuardFixture(
  options: {
    transport?: "hosted" | "trusted_local";
    includeHostedAuth?: boolean;
    bindGoogleRole?: "viewer" | "operator" | "maintainer";
    bindPrincipal?: {
      principalType: "cli_token" | "google_sub";
      principalId: string;
      role: "viewer" | "operator" | "maintainer";
    };
    resolvePrincipal?: () => {
      principalType: "cli_token" | "google_sub";
      principalId: string;
    };
  } = {},
) {
  const transport = options.transport ?? "hosted";
  const includeHostedAuth = options.includeHostedAuth ?? transport === "hosted";
  vi.spyOn(gwrkPaths, "usesHostedRuntime").mockReturnValue(false);
  vi.spyOn(HarvestWatcher.prototype, "start").mockImplementation(() => {});
  vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(true);

  const tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-full-guard-")),
  );
  const repoDir = path.join(tmpDir, "pilot-repo");
  const projectId = initHostedGuardRepo(
    repoDir,
    "git@github.com:org/guard-pilot.git",
  );
  const db = openDatabase({ dbPath: path.join(tmpDir, "gwrk.db") });
  const registry = createSqliteProjectRegistryAdapter({ db });
  const operationsStore = createSqliteOperationsStoreAdapter({ db });
  const authStore = createSqliteAuthStoreAdapter({ db });
  const crypto = createCredentialCryptoAdapter();

  const project = registry.enrollProject({
    projectId,
    slug: "guard-pilot-slug",
    name: "Guard Pilot Project",
    repoSlug: "org/guard-pilot",
    trunkBranch: "main",
    localRoot: repoDir,
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["local", "hosted"] },
    slack: {
      workspaceId: "W_GUARD",
      channelId: "C_GUARD",
      sharedChannel: false,
    },
    legacyProjectIds: [],
    createdAt: iso(NOW - 10_000),
    updatedAt: iso(NOW - 10_000),
  });

  if (options.bindGoogleRole) {
    registry.setRoleBinding({
      projectId: project.projectId,
      principalType: "google_sub",
      principalId: "https://accounts.google.com:operator",
      role: options.bindGoogleRole,
    });
  }
  if (options.bindPrincipal) {
    registry.setRoleBinding({
      projectId: project.projectId,
      principalType: options.bindPrincipal.principalType,
      principalId: options.bindPrincipal.principalId,
      role: options.bindPrincipal.role,
    });
  }

  const clock = { nowMs: () => NOW, nowIso: () => iso(NOW) };
  const google = createGoogleIdentityVerifier({
    clientId: "synthetic-client",
    readAllowlist: async () => ["operator@example.test"],
    fetch: async () => Response.json(jwks),
  });
  const proxy: ProxySessionLogoutPort = {
    clearProxySession: vi.fn(async () => ({
      ok: true as const,
      setCookieHeaders: [],
    })),
  };
  const authenticate = createRequestAuthenticator({
    store: authStore,
    crypto,
    google,
    clock,
    expectedOrigin: ORIGIN,
  });
  const sessions = createBrowserSessionService({
    store: authStore,
    proxy,
    clock,
  });
  const csrf = createBrowserCsrfAdapter({
    hmacKey: Buffer.alloc(32, 13),
    clock,
  });

  const checkGit = vi.fn().mockResolvedValue(true);
  const fakeSandbox = {
    checkGit,
    checkDocker: vi.fn().mockResolvedValue(true),
    listSandboxes: vi.fn().mockResolvedValue([]),
    pruneSandboxes: vi.fn().mockResolvedValue(undefined),
    pauseAll: vi.fn().mockResolvedValue(undefined),
    unpauseAll: vi.fn().mockResolvedValue(undefined),
  } as unknown as SandboxManager;

  const fakeNotifier: NotificationPort = {
    notify: vi.fn().mockResolvedValue({ ok: true, deliveryId: "guard-notify" }),
    getDeliveryStatus: vi.fn().mockResolvedValue({
      mode: "socket_connected" as const,
      workspaceId: "W_GUARD",
      connected: true,
    }),
  };

  const fakeWorker: WorkerExecutionPort = {
    inspectRecoveredWork: vi.fn(async () => ({
      workerState: "stopped" as const,
      pullRequestLookup: "complete" as const,
      openPullRequest: null,
      mergedPullRequest: null,
      completedManifestRunId: null,
      sandboxDir: null,
    })),
    launchPhaseShip: vi.fn(async () => ({ exitCode: 0, stderr: "" })),
    cleanupStaleSandbox: vi.fn(async () => {}),
  };

  const fakeGithub: GitHubHarvestPort = {
    verifyWebhookSignature: vi.fn(() => false),
    listTerminalPullRequests: vi.fn(async () => []),
    getPullRequest: vi.fn(async () => null),
  };

  const config = GwrkConfigSchema.parse({
    project: { name: "guard-pilot-fixture" },
    agents: { define: "gemini", implement: "claude" },
    server: {
      host: "127.0.0.1",
      port: 0,
      githubWebhookSecret: "synthetic-webhook-secret",
      heartbeatIntervalMs: 60_000,
      networkCheckIntervalMs: 60_000,
    },
    parallelism: {
      local: { maxCpu: 90, maxMem: 90, minDiskGb: 1, maxClones: 2 },
    },
  });

  const server = await startServer(config, {
    handleSignals: false,
    transport,
    projectRoot: repoDir,
    ledger: { db, projectId: project.projectId },
    registry,
    operationsStore,
    sandbox: fakeSandbox,
    worker: fakeWorker,
    notifier: fakeNotifier,
    github: fakeGithub,
    clock,
    pid: { writePid: vi.fn(), removePid: vi.fn() },
    heartbeatIntervalMs: null,
    ...(options.resolvePrincipal
      ? { resolvePrincipal: options.resolvePrincipal }
      : {}),
    ...(includeHostedAuth
      ? {
          hostedAuth: {
            authenticate,
            sessions,
            csrf,
            expectedOrigin: ORIGIN,
          },
        }
      : {}),
  });

  cleanup.push(async () => {
    await server.close();
    if (db.open) db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const operationCount = (): number =>
    (
      db.prepare("SELECT COUNT(*) AS count FROM dispatch_operations").get() as {
        count: number;
      }
    ).count;

  const googleSessionCount = (): number =>
    (
      db.prepare("SELECT COUNT(*) AS count FROM google_sessions").get() as {
        count: number;
      }
    ).count;

  return {
    server,
    project,
    checkGit,
    operationCount,
    googleSessionCount,
  };
}

describe("FR-007 FR-010 AUTH-04: full-server hosted auth guard integration via startServer", () => {
  it("AUTH-04: forged identity and auth-mode headers fail closed across full-server API routes with zero operation rows", async () => {
    const f = await createFullServerGuardFixture({
      bindGoogleRole: "operator",
    });
    const forgedHeaders = {
      "x-forwarded-user": "admin",
      "x-forwarded-email": "operator@example.test",
      "x-forwarded-groups": "maintainer",
      "x-forwarded-preferred-username": "admin",
      "x-forwarded-access-token": "forged",
      "x-auth-request-email": "operator@example.test",
      "x-auth-request-user": "admin",
      "x-gwrk-auth-mode": "trusted_local",
      "x-gwrk-role": "maintainer",
    };

    const dispatchRes = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: forgedHeaders,
      payload: {
        projectId: f.project.projectId,
        featureId: "051-pilot",
        phaseId: "phase-04",
      },
    });
    expect(dispatchRes.statusCode).toBe(401);
    expect(dispatchRes.json()).toMatchObject({
      ok: false,
      requestId: expect.any(String),
    });

    const healthRes = await f.server.inject({
      method: "GET",
      url: `/api/health?projectId=${f.project.projectId}`,
      headers: forgedHeaders,
    });
    expect(healthRes.statusCode).toBe(401);
    expect(healthRes.body).not.toContain(f.project.slug);
    expect(healthRes.body).not.toContain(f.project.localRoot ?? "");

    expect(f.operationCount()).toBe(0);
    expect(f.googleSessionCount()).toBe(0);
  });

  it("AUTH-04: forged Google ID token signature yields HTTP 401 with zero operations and zero Google sessions", async () => {
    const f = await createFullServerGuardFixture({
      bindGoogleRole: "operator",
    });
    const response = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: {
        authorization: `Bearer ${forgedToken}`,
        "x-gwrk-auth-mode": "google_id_token",
        origin: ORIGIN,
        "x-gwrk-csrf-token": "forged-csrf",
      },
      payload: {
        projectId: f.project.projectId,
        featureId: "051-pilot",
        phaseId: "phase-04",
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      ok: false,
      code: "AUTH_TOKEN_INVALID",
      requestId: expect.any(String),
    });
    expect(f.operationCount()).toBe(0);
    expect(f.googleSessionCount()).toBe(0);
  });

  it("FR-002 US-001: verified Google principal receives zero automatic project roles and gets HTTP 403 until bound", async () => {
    const f = await createFullServerGuardFixture();
    const statusRes = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
      headers: {
        authorization: `Bearer ${googleToken}`,
        "x-gwrk-auth-mode": "google_id_token",
      },
    });
    expect(statusRes.statusCode).toBe(403);
    expect(statusRes.json()).toMatchObject({
      ok: false,
      code: "UNAUTHORIZED_USER",
    });

    const healthRes = await f.server.inject({
      method: "GET",
      url: `/api/health?projectId=${f.project.projectId}`,
      headers: {
        authorization: `Bearer ${googleToken}`,
        "x-gwrk-auth-mode": "google_id_token",
      },
    });
    expect(healthRes.statusCode).toBe(403);
    expect(healthRes.body).not.toContain(f.project.slug);
    expect(f.operationCount()).toBe(0);
  });

  it("FR-007 FR-009: verified Google operator executes POST /api/dispatch only with same-origin Origin and session-bound CSRF", async () => {
    const f = await createFullServerGuardFixture({
      bindGoogleRole: "operator",
    });
    const sessionRes = await f.server.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        authorization: `Bearer ${googleToken}`,
        "x-gwrk-auth-mode": "google_id_token",
      },
    });
    expect(sessionRes.statusCode).toBe(200);
    const csrfToken = sessionRes.json().csrfToken as string;
    const rawSetCookie = sessionRes.headers["set-cookie"];
    const csrfCookieHeader = (
      Array.isArray(rawSetCookie) ? rawSetCookie[0] : String(rawSetCookie)
    ).split(";", 1)[0];

    const badOriginRes = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: {
        authorization: `Bearer ${googleToken}`,
        "x-gwrk-auth-mode": "google_id_token",
        origin: "https://evil.example.test",
        "x-gwrk-csrf-token": csrfToken,
        cookie: csrfCookieHeader,
      },
      payload: {
        projectId: f.project.projectId,
        featureId: "051-pilot",
        phaseId: "phase-04",
      },
    });
    expect(badOriginRes.statusCode).toBe(403);
    expect(badOriginRes.json().code).toBe("AUTH_ORIGIN_MISMATCH");
    expect(f.operationCount()).toBe(0);

    const queryCsrfRes = await f.server.inject({
      method: "POST",
      url: `/api/dispatch?csrf_token=${encodeURIComponent(csrfToken)}`,
      headers: {
        authorization: `Bearer ${googleToken}`,
        "x-gwrk-auth-mode": "google_id_token",
        origin: ORIGIN,
        "x-gwrk-csrf-token": csrfToken,
        cookie: csrfCookieHeader,
      },
      payload: {
        projectId: f.project.projectId,
        featureId: "051-pilot",
        phaseId: "phase-04",
      },
    });
    expect(queryCsrfRes.statusCode).toBe(403);
    expect(queryCsrfRes.json().code).toBe("AUTH_CSRF_INVALID");
    expect(f.operationCount()).toBe(0);

    const validRes = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: {
        authorization: `Bearer ${googleToken}`,
        "x-gwrk-auth-mode": "google_id_token",
        origin: ORIGIN,
        "x-gwrk-csrf-token": csrfToken,
        cookie: csrfCookieHeader,
      },
      payload: {
        projectId: f.project.projectId,
        featureId: "051-pilot",
        phaseId: "phase-04",
      },
    });
    expect(validRes.statusCode).toBe(201);
    expect(validRes.json().operationId).toBeTruthy();
    expect(f.operationCount()).toBe(1);
  });

  it("FR-010: full hosted server default-denies unclassified routes, disallowed methods, and internal /oauth2/sign_out", async () => {
    const f = await createFullServerGuardFixture({
      bindGoogleRole: "operator",
    });
    const headers = {
      authorization: `Bearer ${googleToken}`,
      "x-gwrk-auth-mode": "google_id_token",
    };

    const unclassified = await f.server.inject({
      method: "GET",
      url: "/api/not-declared",
      headers,
    });
    expect(unclassified.statusCode).toBe(404);
    expect(unclassified.json()).toMatchObject({
      ok: false,
      code: "ROUTE_NOT_FOUND",
      requestId: expect.any(String),
    });

    const badMethod = await f.server.inject({
      method: "PUT",
      url: "/api/status",
      headers,
    });
    expect(badMethod.statusCode).toBe(405);
    expect(badMethod.json()).toMatchObject({
      ok: false,
      code: "METHOD_NOT_ALLOWED",
      requestId: expect.any(String),
    });

    const proxySignOut = await f.server.inject({
      method: "GET",
      url: "/oauth2/sign_out",
      headers,
    });
    expect(proxySignOut.statusCode).toBe(404);
    expect(proxySignOut.json()).toMatchObject({
      ok: false,
      code: "ROUTE_NOT_PUBLIC",
      requestId: expect.any(String),
    });
  });

  it("FR-007 TC-002: hosted startServer without hostedAuth or custom resolvePrincipal fails closed without falling back to trusted_local", async () => {
    const f = await createFullServerGuardFixture({
      transport: "hosted",
      includeHostedAuth: false,
    });

    const statusRes = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
    });
    expect([401, 503]).toContain(statusRes.statusCode);
    expect(statusRes.json().ok).toBe(false);

    const healthRes = await f.server.inject({
      method: "GET",
      url: `/api/health?projectId=${f.project.projectId}`,
    });
    expect([401, 503]).toContain(healthRes.statusCode);
    expect(healthRes.json().ok).toBe(false);
    expect(healthRes.body).not.toContain(f.project.slug);

    const dispatchRes = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      payload: {
        projectId: f.project.projectId,
        featureId: "051-pilot",
        phaseId: "phase-04",
      },
    });
    expect([401, 503]).toContain(dispatchRes.statusCode);
    expect(f.operationCount()).toBe(0);
  });

  it("FR-007 FR-010: trusted_local loopback startServer stays independent from hosted auth guard and preserves local health", async () => {
    const f = await createFullServerGuardFixture({
      transport: "trusted_local",
      includeHostedAuth: false,
    });

    const healthRes = await f.server.inject({
      method: "GET",
      url: "/health",
    });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json().daemonLiveness).toBe("alive");
    expect(healthRes.json().projectReadiness).toMatchObject({
      totalCount: 1,
      readyCount: 1,
      status: "ready",
    });

    const statusRes = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().projectId).toBe(f.project.projectId);
  });

  it("FR-007: caller-supplied resolvePrincipal cannot replace guard-established context when hostedAuth is active", async () => {
    const f = await createFullServerGuardFixture({
      bindPrincipal: {
        principalType: "cli_token",
        principalId: "caller-supplied-operator",
        role: "operator",
      },
      resolvePrincipal: () => ({
        principalType: "cli_token",
        principalId: "caller-supplied-operator",
      }),
    });

    const unauthRes = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
    });
    expect(unauthRes.statusCode).toBe(401);
    expect(unauthRes.json()).toMatchObject({
      ok: false,
      code: "AUTH_REQUIRED",
      requestId: expect.any(String),
    });

    const statusRes = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
      headers: {
        authorization: `Bearer ${googleToken}`,
        "x-gwrk-auth-mode": "google_id_token",
      },
    });
    expect(statusRes.statusCode).toBe(403);
    expect(statusRes.json().code).toBe("UNAUTHORIZED_USER");

    const healthRes = await f.server.inject({
      method: "GET",
      url: `/api/health?projectId=${f.project.projectId}`,
      headers: {
        authorization: `Bearer ${googleToken}`,
        "x-gwrk-auth-mode": "google_id_token",
      },
    });
    expect(healthRes.statusCode).toBe(403);
    expect(healthRes.json().code).toBe("UNAUTHORIZED_USER");
    expect(healthRes.body).not.toContain(f.project.slug);
    expect(f.operationCount()).toBe(0);
  });

  it("FR-007 FR-010: caller-supplied resolvePrincipal cannot bypass hosted auth guard or hosted health scoping when hostedAuth is absent", async () => {
    const f = await createFullServerGuardFixture({
      transport: "hosted",
      includeHostedAuth: false,
      bindPrincipal: {
        principalType: "cli_token",
        principalId: "caller-supplied-operator",
        role: "operator",
      },
      resolvePrincipal: () => ({
        principalType: "cli_token",
        principalId: "caller-supplied-operator",
      }),
    });
    f.checkGit.mockClear();

    const dispatchRes = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      payload: {
        projectId: f.project.projectId,
        featureId: "051-pilot",
        phaseId: "phase-04",
      },
    });
    expect([401, 503]).toContain(dispatchRes.statusCode);
    expect(dispatchRes.json()).toMatchObject({
      ok: false,
      requestId: expect.any(String),
    });
    expect(f.operationCount()).toBe(0);

    const statusRes = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
    });
    expect([401, 503]).toContain(statusRes.statusCode);
    expect(statusRes.json()).toMatchObject({
      ok: false,
      requestId: expect.any(String),
    });

    const apiHealthRes = await f.server.inject({
      method: "GET",
      url: `/api/health?projectId=${f.project.projectId}`,
    });
    expect([401, 503]).toContain(apiHealthRes.statusCode);
    expect(apiHealthRes.json()).toMatchObject({
      ok: false,
      requestId: expect.any(String),
    });
    expect(apiHealthRes.body).not.toContain(f.project.slug);

    const privateHealthRes = await f.server.inject({
      method: "GET",
      url: "/health",
    });
    expect(privateHealthRes.statusCode).toBe(200);
    expect(privateHealthRes.json()).toEqual({
      status: "ok",
      daemonLiveness: "alive",
    });
    expect(f.checkGit).not.toHaveBeenCalled();

    const badMethodRes = await f.server.inject({
      method: "PUT",
      url: "/api/status",
    });
    expect(badMethodRes.statusCode).toBe(405);
    expect(badMethodRes.json()).toMatchObject({
      ok: false,
      code: "METHOD_NOT_ALLOWED",
      requestId: expect.any(String),
    });
  });
});
