/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserCsrfAdapter } from "../adapters/auth/browser-csrf.js";
import { createCredentialCryptoAdapter } from "../adapters/auth/credential-crypto.js";
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
import type { StoredGoogleSession } from "../domain/auth-policy.js";
import { computeProjectId } from "../domain/project-id.js";
import type {
  AuthStorePort,
  GoogleIdentityVerifierPort,
  ProxySessionLogoutPort,
  VerifiedAuthContext,
} from "../ports/auth-port.js";
import type { NotificationPort } from "../ports/notification-port.js";
import type {
  GitHubHarvestPort,
  WorkerExecutionPort,
} from "../ports/operations-port.js";
import { GwrkConfigSchema } from "../utils/config.js";
import { registerHostedAuthGuard } from "./auth-guard.js";
import { HarvestWatcher } from "./harvest-watcher.js";
import { startServer } from "./index.js";
import { SystemMonitor } from "./monitor.js";
import { registerAuthRoutes } from "./routes/auth.js";
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

const NOW = Date.parse("2026-11-23T18:00:00Z");
const ORIGIN = "https://gwrk.gforge.ai";
const TOKEN = "CANARY_SYNTHETIC_GOOGLE_ID_TOKEN";
const OTHER_TOKEN = "CANARY_OTHER_GOOGLE_ID_TOKEN";
const API_KEY = `gwrk_v1.synthetic-api.${"a".repeat(43)}`;
const PROXY_COOKIE = "__Host-gwrk_session=CANARY_PROXY_COOKIE";
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const iso = (ms: number) => new Date(ms).toISOString();
const proxyClearing = [
  "__Host-gwrk_session_0=; Path=/; Secure; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  "__Host-gwrk_session_1=; Path=/; Secure; HttpOnly; Max-Age=0",
];
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.restoreAllMocks();
});

function cookies(response: { headers: Record<string, unknown> }): string[] {
  const value = response.headers["set-cookie"];
  return value === undefined
    ? []
    : Array.isArray(value)
      ? (value as string[])
      : [String(value)];
}
function browserHeaders(token = TOKEN) {
  return {
    authorization: `Bearer ${token}`,
    "x-gwrk-auth-mode": "google_id_token",
    cookie: PROXY_COOKIE,
  };
}
function privateBody(body: string) {
  for (const secret of [
    TOKEN,
    OTHER_TOKEN,
    API_KEY,
    digest(TOKEN),
    digest(OTHER_TOKEN),
    "CANARY_PROXY_COOKIE",
    "CANARY_UPSTREAM",
    "https://accounts.google.com:user-",
  ])
    expect(body).not.toContain(secret);
}

async function fixture(
  options: {
    proxyFailure?: "typed" | "throw";
    revokeFailure?: boolean;
    csrfIssueFailure?: "reject" | "throw";
    revokeAfterGuard?: boolean;
    initialCapMs?: number;
    noGuard?: boolean;
  } = {},
) {
  let now = NOW;
  const events: string[] = [];
  const records = new Map<string, StoredGoogleSession>();
  const record = (
    token: string,
    cap = NOW + 3600_000,
  ): StoredGoogleSession => ({
    tokenDigestSha256: digest(token),
    principalId: `https://accounts.google.com:user-${token === TOKEN ? "one" : "two"}`,
    issuedAt: iso(NOW - 1000),
    expiresAt: iso(NOW + 7200_000),
    sessionCapAt: iso(cap),
    revokedAt: null,
    revokedReason: null,
  });
  if (options.initialCapMs !== undefined)
    records.set(digest(TOKEN), record(TOKEN, options.initialCapMs));
  const crypto = createCredentialCryptoAdapter();
  const store: AuthStorePort = {
    findApiCredentialById: () => ({
      credentialId: "synthetic-api",
      label: "synthetic",
      issuer: "local",
      audienceOrigin: ORIGIN,
      createdAt: iso(NOW - 1000),
      expiresAt: iso(NOW + 600_000),
      revokedAt: null,
      revokedReason: null,
      rotatedFromId: null,
      overlapUntil: null,
      verifierSha256: crypto.hashCredential(API_KEY),
    }),
    listApiCredentials: () => [],
    revokeApiCredential: () => false,
    observeGoogleSession: (input) => {
      const existing = records.get(input.tokenDigestSha256);
      if (existing?.revokedAt) return { ok: false, code: "SESSION_REVOKED" };
      if (
        existing &&
        (existing.principalId !== input.principalId ||
          existing.issuedAt !== input.issuedAt ||
          existing.expiresAt !== input.expiresAt)
      )
        return { ok: false, code: "SESSION_METADATA_CONFLICT" };
      const session = existing ?? {
        ...input,
        revokedAt: null,
        revokedReason: null,
      };
      records.set(input.tokenDigestSha256, session);
      return { ok: true, session, created: !existing };
    },
    getGoogleSession: (key) => records.get(key) ?? null,
    revokeGoogleSession: vi.fn(({ tokenDigestSha256, revokedAt, reason }) => {
      if (options.revokeFailure) return false;
      const current = records.get(tokenDigestSha256);
      if (!current) return false;
      records.set(tokenDigestSha256, {
        ...current,
        revokedAt,
        revokedReason: reason,
      });
      events.push("revoke");
      return true;
    }),
    appendAuditEvent: () => {},
    close: () => {},
  };
  const google: GoogleIdentityVerifierPort = {
    verifyIdToken: async ({ token }) => {
      if (token !== TOKEN && token !== OTHER_TOKEN)
        return { ok: false, code: "AUTH_TOKEN_INVALID", message: "Denied" };
      const current = record(token);
      return {
        ok: true,
        claims: {
          canonicalIssuer: "https://accounts.google.com",
          subject: token === TOKEN ? "user-one" : "user-two",
          principalId: current.principalId,
          email: "synthetic@example.test",
          emailVerified: true,
          issuedAtMs: NOW - 1000,
          expiresAtMs: NOW + 7200_000,
          tokenDigestSha256: current.tokenDigestSha256,
        },
      };
    },
  };
  const proxy: ProxySessionLogoutPort = {
    clearProxySession: vi.fn(async () => {
      events.push("proxy");
      expect(records.get(digest(TOKEN))?.revokedAt).not.toBeNull();
      if (options.proxyFailure === "throw")
        throw new Error(`CANARY_UPSTREAM ${TOKEN} ${PROXY_COOKIE}`);
      if (options.proxyFailure === "typed")
        return {
          ok: false,
          code: "PROXY_LOGOUT_FAILED",
          message: `CANARY_UPSTREAM ${TOKEN}`,
        };
      return { ok: true, setCookieHeaders: proxyClearing };
    }),
  };
  const clock = { nowMs: () => now, nowIso: () => iso(now) };
  const sessions = createBrowserSessionService({ store, proxy, clock });
  const csrf = createBrowserCsrfAdapter({
    hmacKey: Buffer.alloc(32, 7),
    clock,
  });
  const issue = vi.spyOn(csrf, "issueToken");
  if (options.csrfIssueFailure === "reject")
    issue.mockRejectedValue(new Error(`CANARY_UPSTREAM ${TOKEN}`));
  if (options.csrfIssueFailure === "throw")
    issue.mockImplementation(() => {
      throw new Error(`CANARY_UPSTREAM ${TOKEN}`);
    });
  const clear = vi.spyOn(csrf, "clearCookieHeader");
  const read = vi.spyOn(sessions, "readSession");
  const logout = vi.spyOn(sessions, "logout");
  const app = fastify({ logger: false });
  cleanup.push(async () => {
    await app.close();
  });
  if (!options.noGuard)
    registerHostedAuthGuard(app, {
      authenticate: createRequestAuthenticator({
        store,
        crypto,
        google,
        clock,
        expectedOrigin: ORIGIN,
      }),
      csrf,
      expectedOrigin: ORIGIN,
    });
  if (options.noGuard)
    app.addHook("preHandler", async (request) => {
      const forged: VerifiedAuthContext = {
        principalType: "google_sub",
        principalId: record(TOKEN).principalId,
        credentialId: digest(TOKEN),
        expiresAt: iso(NOW + 3600_000),
        authMethod: "google_id_token",
        sessionDigest: digest(TOKEN),
      };
      request.gwrkVerifiedAuth = forged;
    });
  if (options.revokeAfterGuard)
    app.addHook("preHandler", async () => {
      const current = records.get(digest(TOKEN));
      if (current)
        records.set(digest(TOKEN), {
          ...current,
          revokedAt: iso(now),
          revokedReason: "concurrent-revocation",
        });
    });
  registerAuthRoutes(app, { sessions, csrf });
  await app.ready();
  const session = () =>
    app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: browserHeaders(),
    });
  const mutationHeaders = async (token = TOKEN) => {
    const response = await session();
    expect(response.statusCode).toBe(200);
    return {
      ...browserHeaders(token),
      origin: ORIGIN,
      "x-gwrk-csrf-token": response.json().csrfToken as string,
      cookie: `${PROXY_COOKIE}; ${cookies(response)[0].split(";", 1)[0]}`,
    };
  };
  return {
    app,
    store,
    records,
    proxy,
    events,
    issue,
    clear,
    read,
    logout,
    session,
    mutationHeaders,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("browser authentication HTTP routes", () => {
  it("serves one static login entry without identity or project metadata", async () => {
    const f = await fixture();
    const first = await f.app.inject({ url: "/" });
    const second = await f.app.inject({
      url: "/?project=CANARY_PROJECT&code=CANARY_CODE",
      headers: { "x-forwarded-user": "CANARY_USER" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers["content-type"]).toContain("text/html");
    expect(first.body).toContain('href="/oauth2/start"');
    expect(second.body).toBe(first.body);
    privateBody(first.body);
    privateBody(second.body);
    expect(first.body).not.toMatch(
      /CANARY|CANARY_PROJECT|CANARY_CODE|CANARY_USER|TOKEN|PROXY_COOKIE|USER_EMAIL|USER_SUB|gwrk_v1\./,
    );
    expect(f.records.size).toBe(0);
    expect(f.issue).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
  });
  it("returns only expiry and a CSRF token after checking the verified session", async () => {
    const f = await fixture({ initialCapMs: NOW + 120_000 });
    const response = await f.session();
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      ok: true,
      expiresAt: iso(NOW + 120_000),
      csrfToken: expect.any(String),
    });
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.issue).toHaveBeenCalledWith({
      sessionDigest: digest(TOKEN),
      expiresAt: iso(NOW + 120_000),
    });
    const header = cookies(response)[0];
    expect(header).toMatch(/__Host-gwrk_csrf=.*; Path=\/.*HttpOnly.*Secure/);
    expect(header).not.toMatch(/Domain=|Max-Age=/i);
    expect(Date.parse(/Expires=([^;]+)/.exec(header)![1])).toBeLessThanOrEqual(
      NOW + 120_000,
    );
    expect(response.body).not.toContain(header.split(";", 1)[0].split("=")[1]);
    privateBody(response.body);
  });
  it("HEAD rechecks the same Google session without issuing or rotating CSRF", async () => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "HEAD",
      url: "/api/auth/session",
      headers: browserHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toBe("");
    expect(cookies(response)).toEqual([]);
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.issue).not.toHaveBeenCalled();
  });
  it.each(["GET", "HEAD"] as const)(
    "requires Google authentication for %s session",
    async (method) => {
      const f = await fixture();
      expect(
        (await f.app.inject({ method, url: "/api/auth/session" })).statusCode,
      ).toBe(401);
      expect(f.issue).not.toHaveBeenCalled();
      expect(f.read).not.toHaveBeenCalled();
    },
  );
  it.each(["reject", "throw"] as const)(
    "returns a static 503 on CSRF issuance %s",
    async (csrfIssueFailure) => {
      const f = await fixture({ csrfIssueFailure });
      const response = await f.session();
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        ok: false,
        code: "AUTH_DEPENDENCY_UNAVAILABLE",
        requestId: expect.any(String),
      });
      expect(cookies(response)).toEqual([]);
      privateBody(response.body);
    },
  );
  it("rechecks revocation after guard completion before issuing CSRF", async () => {
    const f = await fixture({ revokeAfterGuard: true });
    const response = await f.session();
    expect(response.statusCode).toBe(401);
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.issue).not.toHaveBeenCalled();
    expect(cookies(response)).toEqual([]);
    privateBody(response.body);
  });
  it.each([
    { key: API_KEY, method: "GET" as const, url: "/api/auth/session" },
    {
      key: "CANARY_INVALID_API_KEY",
      method: "GET" as const,
      url: "/api/auth/session",
    },
    { key: API_KEY, method: "POST" as const, url: "/api/auth/logout" },
    {
      key: "CANARY_INVALID_API_KEY",
      method: "POST" as const,
      url: "/api/auth/logout",
    },
  ])(
    "does not fall back from API authentication to a browser cookie %#",
    async ({ key, method, url }) => {
      const f = await fixture();
      const response = await f.app.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${key}`,
          "x-gwrk-auth-mode": "api_key",
          cookie: PROXY_COOKIE,
        },
      });
      expect(response.statusCode).toBe(401);
      expect(f.records.size).toBe(0);
      expect(f.read).not.toHaveBeenCalled();
      expect(f.issue).not.toHaveBeenCalled();
      privateBody(response.body);
    },
  );
  it("cannot establish a session from a forged public decoration without the guard", async () => {
    const f = await fixture({ noGuard: true });
    const response = await f.app.inject({
      url: "/api/auth/session",
      headers: {
        "x-forwarded-user": "CANARY_USER",
        "x-gwrk-auth-mode": "google_id_token",
      },
    });
    expect(response.statusCode).toBe(401);
    expect(f.read).not.toHaveBeenCalled();
    expect(f.issue).not.toHaveBeenCalled();
    privateBody(response.body);
  });
  it("AUTH-06: revokes before proxy clearing, preserves cookie headers and denies copied replay", async () => {
    const f = await fixture();
    const headers = await f.mutationHeaders();
    const response = await f.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, proxyCleared: true });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(f.events).toEqual(["revoke", "proxy"]);
    expect(f.proxy.clearProxySession).toHaveBeenCalledWith({
      cookieHeader: headers.cookie,
    });
    expect(cookies(response)).toEqual([
      ...proxyClearing,
      expect.stringMatching(/^__Host-gwrk_csrf=;/),
    ]);
    expect(cookies(response)[2]).toContain("Max-Age=0");
    expect(f.clear).toHaveBeenCalledTimes(1);
    privateBody(response.body);
    const replay = await f.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers,
    });
    expect(replay.statusCode).toBe(401);
    expect((await f.session()).statusCode).toBe(401);
    expect(f.proxy.clearProxySession).toHaveBeenCalledTimes(1);
    privateBody(replay.body);
  });
  it.each(["typed", "throw"] as const)(
    "keeps origin logout committed and clears CSRF when proxy %s fails",
    async (proxyFailure) => {
      const f = await fixture({ proxyFailure });
      const response = await f.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: await f.mutationHeaders(),
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ ok: true, proxyCleared: false });
      expect(f.records.get(digest(TOKEN))?.revokedAt).toBe(iso(NOW));
      expect(cookies(response)).toEqual([
        expect.stringMatching(/^__Host-gwrk_csrf=;/),
      ]);
      expect(f.clear).toHaveBeenCalledTimes(1);
      expect((await f.session()).statusCode).toBe(401);
      privateBody(response.body);
    },
  );
  it("does not claim logout success when origin revocation fails", async () => {
    const f = await fixture({ revokeFailure: true });
    const response = await f.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: await f.mutationHeaders(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ok: false,
      code: "AUTH_DEPENDENCY_UNAVAILABLE",
      requestId: expect.any(String),
    });
    expect(f.records.get(digest(TOKEN))?.revokedAt).toBeNull();
    expect(f.proxy.clearProxySession).not.toHaveBeenCalled();
    expect(cookies(response)).toEqual([]);
    privateBody(response.body);
  });
  it.each([
    "missing-origin",
    "wrong-origin",
    "missing-csrf",
    "query-csrf",
    "wrong-session",
  ])(
    "guard denies %s before invoking mutating logout effects",
    async (failure) => {
      const f = await fixture();
      const originalHeaders = await f.mutationHeaders(
        failure === "wrong-session" ? OTHER_TOKEN : TOKEN,
      );
      const omitted =
        failure === "missing-origin"
          ? "origin"
          : failure === "missing-csrf"
            ? "x-gwrk-csrf-token"
            : undefined;
      const headers: Record<string, string> = Object.fromEntries(
        Object.entries(originalHeaders).filter(([key]) => key !== omitted),
      );
      let url = "/api/auth/logout";
      if (failure === "wrong-origin")
        headers.origin = "https://other.example.test";
      if (failure === "query-csrf")
        url += `?csrf_token=${encodeURIComponent(headers["x-gwrk-csrf-token"])}`;
      const response = await f.app.inject({ method: "POST", url, headers });
      expect(response.statusCode).toBe(403);
      expect(f.logout).not.toHaveBeenCalled();
      expect(f.store.revokeGoogleSession).not.toHaveBeenCalled();
      expect(f.proxy.clearProxySession).not.toHaveBeenCalled();
      expect(f.events).toEqual([]);
      expect(cookies(response)).toEqual([]);
      privateBody(response.body);
    },
  );
});

function initHostedSessionRepo(repoDir: string, remoteUrl: string): string {
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

async function createFullServerSessionFixture(
  options: { proxyFailure?: "typed" | "throw" } = {},
) {
  vi.spyOn(gwrkPaths, "usesHostedRuntime").mockReturnValue(false);
  vi.spyOn(HarvestWatcher.prototype, "start").mockImplementation(() => {});
  vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(true);

  const tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-full-session-")),
  );
  const repoDir = path.join(tmpDir, "session-repo");
  const projectId = initHostedSessionRepo(
    repoDir,
    "git@github.com:org/session-pilot.git",
  );
  const db = openDatabase({ dbPath: path.join(tmpDir, "gwrk.db") });
  const registry = createSqliteProjectRegistryAdapter({ db });
  const operationsStore = createSqliteOperationsStoreAdapter({ db });
  const authStore = createSqliteAuthStoreAdapter({ db });
  const crypto = createCredentialCryptoAdapter();

  const project = registry.enrollProject({
    projectId,
    slug: "session-pilot-slug",
    name: "Session Pilot Project",
    repoSlug: "org/session-pilot",
    trunkBranch: "main",
    localRoot: repoDir,
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["local", "hosted"] },
    slack: {
      workspaceId: "W_SESSION",
      channelId: "C_SESSION",
      sharedChannel: false,
    },
    legacyProjectIds: [],
    createdAt: iso(NOW - 10_000),
    updatedAt: iso(NOW - 10_000),
  });
  registry.setRoleBinding({
    projectId: project.projectId,
    principalType: "google_sub",
    principalId: "https://accounts.google.com:user-one",
    role: "operator",
  });

  const events: string[] = [];
  const clock = { nowMs: () => NOW, nowIso: () => iso(NOW) };
  const google: GoogleIdentityVerifierPort = {
    verifyIdToken: async ({ token }) => {
      if (token !== TOKEN) {
        return { ok: false, code: "AUTH_TOKEN_INVALID", message: "Denied" };
      }
      return {
        ok: true,
        claims: {
          canonicalIssuer: "https://accounts.google.com",
          subject: "user-one",
          principalId: "https://accounts.google.com:user-one",
          email: "synthetic@example.test",
          emailVerified: true,
          issuedAtMs: NOW - 1000,
          expiresAtMs: NOW + 7200_000,
          tokenDigestSha256: digest(token),
        },
      };
    },
  };
  const proxy: ProxySessionLogoutPort = {
    clearProxySession: vi.fn(async () => {
      events.push("proxy");
      const persisted = authStore.getGoogleSession(digest(TOKEN));
      expect(persisted?.revokedAt).not.toBeNull();
      if (options.proxyFailure === "throw") {
        throw new Error(`CANARY_UPSTREAM ${TOKEN}`);
      }
      if (options.proxyFailure === "typed") {
        return {
          ok: false as const,
          code: "PROXY_LOGOUT_FAILED" as const,
          message: `CANARY_UPSTREAM ${TOKEN}`,
        };
      }
      return { ok: true as const, setCookieHeaders: proxyClearing };
    }),
  };

  const origRevoke = authStore.revokeGoogleSession.bind(authStore);
  const revokeSpy = vi.spyOn(authStore, "revokeGoogleSession");
  revokeSpy.mockImplementation((input) => {
    const revoked = origRevoke(input);
    if (revoked) events.push("revoke");
    return revoked;
  });

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
    hmacKey: Buffer.alloc(32, 17),
    clock,
  });
  const issueSpy = vi.spyOn(csrf, "issueToken");

  const fakeSandbox = {
    checkGit: vi.fn().mockResolvedValue(true),
    checkDocker: vi.fn().mockResolvedValue(true),
    listSandboxes: vi.fn().mockResolvedValue([]),
    pruneSandboxes: vi.fn().mockResolvedValue(undefined),
    pauseAll: vi.fn().mockResolvedValue(undefined),
    unpauseAll: vi.fn().mockResolvedValue(undefined),
  } as unknown as SandboxManager;

  const fakeNotifier: NotificationPort = {
    notify: vi.fn().mockResolvedValue({ ok: true, deliveryId: "sess-notify" }),
    getDeliveryStatus: vi.fn().mockResolvedValue({
      mode: "socket_connected" as const,
      workspaceId: "W_SESSION",
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
    project: { name: "session-pilot-fixture" },
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
    transport: "hosted",
    projectRoot: tmpDir,
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
    hostedAuth: {
      authenticate,
      sessions,
      csrf,
      expectedOrigin: ORIGIN,
    },
  });

  cleanup.push(async () => {
    await server.close();
    if (db.open) db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const operationCount = (): number =>
    (
      db.prepare("SELECT COUNT(*) AS count FROM dispatch_operations").get() as {
        count: number;
      }
    ).count;

  return {
    server,
    db,
    authStore,
    project,
    proxy,
    events,
    issueSpy,
    operationCount,
  };
}

describe("FR-003 FR-009 AUTH-06: full-server browser session and logout replay via startServer", () => {
  it("FR-003 FR-009: full hosted startServer serves static GET /, issues no-store session CSRF on GET, and skips CSRF issuance on HEAD", async () => {
    const f = await createFullServerSessionFixture();

    const entry = await f.server.inject({ method: "GET", url: "/" });
    expect(entry.statusCode).toBe(200);
    expect(entry.headers["content-type"]).toContain("text/html");
    expect(entry.body).toContain('href="/oauth2/start"');
    expect(entry.body).not.toContain(f.project.slug);
    expect(entry.body).not.toContain(f.project.projectId);

    const headRes = await f.server.inject({
      method: "HEAD",
      url: "/api/auth/session",
      headers: browserHeaders(),
    });
    expect(headRes.statusCode).toBe(200);
    expect(headRes.headers["cache-control"]).toBe("no-store");
    expect(cookies(headRes)).toEqual([]);
    expect(f.issueSpy).not.toHaveBeenCalled();

    const getRes = await f.server.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: browserHeaders(),
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.headers["cache-control"]).toBe("no-store");
    expect(getRes.json()).toEqual({
      ok: true,
      expiresAt: iso(NOW + 3600_000),
      csrfToken: expect.any(String),
    });
    expect(cookies(getRes)).toHaveLength(1);
    expect(cookies(getRes)[0]).toMatch(
      /__Host-gwrk_csrf=.*; Path=\/.*HttpOnly.*Secure/,
    );
    expect(cookies(getRes)[0]).not.toMatch(/Domain=|Max-Age=/i);
    privateBody(getRes.body);
  });

  it("AUTH-15: login admission subrequest serves bounded root response <= 4096 bytes while browser presentation receives full portal", async () => {
    const f = await createFullServerSessionFixture();

    // 1. Admission subrequest (exact admission header contract: X-Forwarded-Uri: /)
    const admissionRes = await f.server.inject({
      method: "GET",
      url: "/",
      headers: {
        "x-forwarded-uri": "/",
        "x-forwarded-method": "GET",
      },
    });
    expect(admissionRes.statusCode).toBe(200);
    expect(admissionRes.headers["content-type"]).toContain("text/html");
    expect(admissionRes.body).toContain('href="/oauth2/start"');
    // ForwardAuth maxResponseBodySize is 4096 bytes
    expect(Buffer.byteLength(admissionRes.body)).toBeLessThanOrEqual(4096);

    // Pinned ForwardAuth oversized body check: response > 4096 triggers built-in 401
    const simulateForwardAuth = (res: { statusCode: number; body: string }) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (Buffer.byteLength(res.body) > 4096) {
          return {
            status: 401,
            admitted: false,
            error: "oversized admission body",
          };
        }
        return { status: 200, admitted: true };
      }
      return { status: res.statusCode, admitted: false };
    };
    const admissionGate = simulateForwardAuth(admissionRes);
    expect(admissionGate.admitted).toBe(true);

    // 2. Browser or CLI presentation request (without X-Forwarded-Uri: /)
    const browserRes = await f.server.inject({
      method: "GET",
      url: "/",
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    expect(browserRes.statusCode).toBe(200);
    expect(browserRes.headers["content-type"]).toContain("text/html");
    expect(browserRes.body).toContain('href="/oauth2/start"');
    // Full portal content must be preserved (> 4096 bytes)
    expect(Buffer.byteLength(browserRes.body)).toBeGreaterThan(4096);
    expect(browserRes.body).toContain("Flamingo");

    const curlRes = await f.server.inject({
      method: "GET",
      url: "/",
    });
    expect(curlRes.statusCode).toBe(200);
    expect(Buffer.byteLength(curlRes.body)).toBeGreaterThan(4096);
    expect(curlRes.body).toContain("Flamingo");

    // 3. HEAD / must be bodyless and <= 4096 bytes
    const headRes = await f.server.inject({
      method: "HEAD",
      url: "/",
      headers: {
        "x-forwarded-uri": "/",
        "x-forwarded-method": "GET",
      },
    });
    expect(headRes.statusCode).toBe(200);
    expect(Buffer.byteLength(headRes.body)).toBe(0);

    // 4. Denied / capacity paths on admission subrequests return bounded non-2xx JSON (<= 4096 bytes) and block proxy work
    const exhaustedIp = "198.51.100.201";
    for (let i = 0; i < 60; i++) {
      const okSub = await f.server.inject({
        method: "GET",
        url: "/",
        remoteAddress: "127.0.0.1",
        headers: {
          "x-forwarded-for": exhaustedIp,
          "x-forwarded-uri": "/",
          "x-forwarded-method": "GET",
        },
      });
      expect(okSub.statusCode).toBe(200);
      expect(Buffer.byteLength(okSub.body)).toBeLessThanOrEqual(4096);
    }
    const denied61Sub = await f.server.inject({
      method: "GET",
      url: "/",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": exhaustedIp,
        "x-forwarded-uri": "/",
        "x-forwarded-method": "GET",
      },
    });
    expect(denied61Sub.statusCode).toBe(429);
    expect(Buffer.byteLength(denied61Sub.body)).toBeLessThanOrEqual(4096);
    expect(simulateForwardAuth(denied61Sub)).toEqual({
      status: 429,
      admitted: false,
    });

    const malformedForwardSub = await f.server.inject({
      method: "GET",
      url: "/",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.1, 203.0.113.1",
        "x-forwarded-uri": "/",
        "x-forwarded-method": "GET",
      },
    });
    expect(malformedForwardSub.statusCode).toBe(503);
    expect(Buffer.byteLength(malformedForwardSub.body)).toBeLessThanOrEqual(
      4096,
    );
    expect(simulateForwardAuth(malformedForwardSub)).toEqual({
      status: 503,
      admitted: false,
    });

    // 5. Invariant: root response never leaks cleanup headers, Location, or Set-Cookie
    for (const res of [
      admissionRes,
      browserRes,
      curlRes,
      headRes,
      denied61Sub,
      malformedForwardSub,
    ]) {
      expect(res.headers).not.toHaveProperty("set-cookie");
      expect(res.headers).not.toHaveProperty("location");
      expect(res.headers).not.toHaveProperty("x-forwarded-for");
      expect(res.headers).not.toHaveProperty("x-forwarded-uri");
      expect(res.headers).not.toHaveProperty("x-forwarded-method");
    }
  });

  it("AUTH-06: full hosted startServer logout commits SQLite digest revocation first, preserves separate Set-Cookie headers, and denies copied replay across all APIs", async () => {
    const f = await createFullServerSessionFixture();

    const sessionRes = await f.server.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: browserHeaders(),
    });
    expect(sessionRes.statusCode).toBe(200);
    const csrfToken = sessionRes.json().csrfToken as string;
    const csrfCookiePair = cookies(sessionRes)[0].split(";", 1)[0];
    const copiedHeaders = {
      ...browserHeaders(),
      origin: ORIGIN,
      "x-gwrk-csrf-token": csrfToken,
      cookie: `${PROXY_COOKIE}; ${csrfCookiePair}`,
    };

    const statusBefore = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
      headers: browserHeaders(),
    });
    expect(statusBefore.statusCode).toBe(200);

    const logoutRes = await f.server.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: copiedHeaders,
    });
    expect(logoutRes.statusCode).toBe(200);
    expect(logoutRes.json()).toEqual({ ok: true, proxyCleared: true });
    expect(logoutRes.headers["cache-control"]).toBe("no-store");
    expect(f.events).toEqual(["revoke", "proxy"]);
    expect(cookies(logoutRes)).toEqual([
      ...proxyClearing,
      expect.stringMatching(/^__Host-gwrk_csrf=;/),
    ]);
    privateBody(logoutRes.body);

    // SQLite persists only the SHA-256 digest and never the raw Google token.
    const rawRows = f.db
      .prepare("SELECT * FROM google_sessions")
      .all() as Record<string, unknown>[];
    expect(rawRows).toHaveLength(1);
    expect(JSON.stringify(rawRows)).toContain(digest(TOKEN));
    expect(JSON.stringify(rawRows)).not.toContain(TOKEN);

    // Replaying the copied cookie and Google ID token fails across session and project APIs.
    expect(
      (
        await f.server.inject({
          method: "GET",
          url: "/api/auth/session",
          headers: browserHeaders(),
        })
      ).statusCode,
    ).toBe(401);

    const statusAfter = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
      headers: browserHeaders(),
    });
    expect(statusAfter.statusCode).toBe(401);
    expect(statusAfter.json().code).toBe("AUTH_SESSION_REVOKED");

    const healthAfter = await f.server.inject({
      method: "GET",
      url: `/api/health?projectId=${f.project.projectId}`,
      headers: browserHeaders(),
    });
    expect(healthAfter.statusCode).toBe(401);
    expect(healthAfter.json().code).toBe("AUTH_SESSION_REVOKED");

    const dispatchAfter = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: copiedHeaders,
      payload: {
        projectId: f.project.projectId,
        featureId: "051-pilot",
        phaseId: "phase-04",
      },
    });
    expect(dispatchAfter.statusCode).toBe(401);
    expect(dispatchAfter.json().code).toBe("AUTH_SESSION_REVOKED");
    expect(f.operationCount()).toBe(0);
    expect(f.proxy.clearProxySession).toHaveBeenCalledTimes(1);
  });

  it("FR-003: full hosted startServer returns HTTP 503 on proxy logout failure while keeping SQLite revocation committed and denying replay", async () => {
    const f = await createFullServerSessionFixture({ proxyFailure: "typed" });

    const sessionRes = await f.server.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: browserHeaders(),
    });
    expect(sessionRes.statusCode).toBe(200);
    const csrfToken = sessionRes.json().csrfToken as string;
    const csrfCookiePair = cookies(sessionRes)[0].split(";", 1)[0];

    const logoutRes = await f.server.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        ...browserHeaders(),
        origin: ORIGIN,
        "x-gwrk-csrf-token": csrfToken,
        cookie: `${PROXY_COOKIE}; ${csrfCookiePair}`,
      },
    });
    expect(logoutRes.statusCode).toBe(503);
    expect(logoutRes.json()).toEqual({ ok: true, proxyCleared: false });
    expect(cookies(logoutRes)).toEqual([
      expect.stringMatching(/^__Host-gwrk_csrf=;/),
    ]);
    expect(f.authStore.getGoogleSession(digest(TOKEN))?.revokedAt).toBe(
      iso(NOW),
    );
    privateBody(logoutRes.body);

    const replayStatus = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
      headers: browserHeaders(),
    });
    expect(replayStatus.statusCode).toBe(401);
    expect(replayStatus.json().code).toBe("AUTH_SESSION_REVOKED");
  });
});
