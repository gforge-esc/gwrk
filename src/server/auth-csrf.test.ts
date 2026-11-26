/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
import { computeProjectId } from "../domain/project-id.js";
import type {
  GoogleIdentityVerifierPort,
  ProxySessionLogoutPort,
} from "../ports/auth-port.js";
import type { NotificationPort } from "../ports/notification-port.js";
import type {
  GitHubHarvestPort,
  WorkerExecutionPort,
} from "../ports/operations-port.js";
import { GwrkConfigSchema } from "../utils/config.js";
import { HarvestWatcher } from "./harvest-watcher.js";
import { startServer } from "./index.js";
import { SystemMonitor } from "./monitor.js";
import type { SandboxManager } from "./sandbox.js";
import * as slackNotify from "./slack-notify.js";

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
const NOW = Date.parse("2026-11-23T19:00:00.000Z");
const TOKEN_A = "CANARY_CSRF_GOOGLE_TOKEN_SESSION_A";
const TOKEN_B = "CANARY_CSRF_GOOGLE_TOKEN_SESSION_B";
const PROXY_COOKIE = "__Host-gwrk_session=CANARY_CSRF_PROXY_SESSION";
const PROXY_CHUNK_COOKIE = "__Host-gwrk_session_0=CANARY_CSRF_PROXY_CHUNK_0";
const iso = (ms: number) => new Date(ms).toISOString();
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of cleanup.splice(0)) {
    await close();
  }
  vi.restoreAllMocks();
});

function setCookieList(response: {
  headers: Record<string, unknown>;
}): string[] {
  const value = response.headers["set-cookie"];
  if (value === undefined) return [];
  return Array.isArray(value) ? (value as string[]) : [String(value)];
}

function initFixtureRepo(repoDir: string, remoteUrl: string): string {
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

async function createCsrfServerFixture() {
  vi.clearAllMocks();
  vi.spyOn(gwrkPaths, "usesHostedRuntime").mockReturnValue(false);
  vi.spyOn(HarvestWatcher.prototype, "start").mockImplementation(() => {});
  vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(true);

  const tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-hosted-csrf-")),
  );
  const repoDir = path.join(tmpDir, "csrf-pilot-repo");
  const projectId = initFixtureRepo(
    repoDir,
    "git@github.com:org/csrf-pilot.git",
  );

  const db = openDatabase({ dbPath: path.join(tmpDir, "gwrk.db") });
  const registry = createSqliteProjectRegistryAdapter({ db });
  const operationsStore = createSqliteOperationsStoreAdapter({ db });
  const authStore = createSqliteAuthStoreAdapter({ db });
  const crypto = createCredentialCryptoAdapter();

  const project = registry.enrollProject({
    projectId,
    slug: "csrf-pilot-slug",
    name: "CSRF Pilot Project",
    repoSlug: "org/csrf-pilot",
    trunkBranch: "main",
    localRoot: repoDir,
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["local", "hosted"] },
    slack: {
      workspaceId: "W_CSRF",
      channelId: "C_CSRF",
      sharedChannel: false,
    },
    legacyProjectIds: [],
    createdAt: iso(NOW - 10_000),
    updatedAt: iso(NOW - 10_000),
  });

  for (const subject of ["user-a", "user-b"]) {
    registry.setRoleBinding({
      projectId: project.projectId,
      principalType: "google_sub",
      principalId: `https://accounts.google.com:${subject}`,
      role: "operator",
    });
  }

  const generatedValidKey = crypto.generateApiCredential("cred-csrf-operator");
  authStore.createCredentialWithGrants({
    credentialId: "cred-csrf-operator",
    verifierSha256: generatedValidKey.verifierSha256,
    label: "csrf-operator",
    issuer: "local-admin",
    audienceOrigin: ORIGIN,
    createdAt: iso(NOW - 1000),
    expiresAt: iso(NOW + 3600_000),
    grants: [{ projectId: project.projectId, role: "operator" }],
  });

  const generatedRevokedKey = crypto.generateApiCredential("cred-csrf-revoked");
  authStore.createCredentialWithGrants({
    credentialId: "cred-csrf-revoked",
    verifierSha256: generatedRevokedKey.verifierSha256,
    label: "csrf-revoked",
    issuer: "local-admin",
    audienceOrigin: ORIGIN,
    createdAt: iso(NOW - 1000),
    expiresAt: iso(NOW + 3600_000),
    grants: [{ projectId: project.projectId, role: "operator" }],
  });
  authStore.revokeApiCredential({
    credentialId: "cred-csrf-revoked",
    revokedAt: iso(NOW - 500),
    reason: "revoked-for-csrf-test",
  });

  const clock = { nowMs: () => NOW, nowIso: () => iso(NOW) };
  const google: GoogleIdentityVerifierPort = {
    verifyIdToken: vi.fn(async ({ token }) => {
      if (token !== TOKEN_A && token !== TOKEN_B) {
        return {
          ok: false as const,
          code: "AUTH_TOKEN_INVALID" as const,
          message: "Denied",
        };
      }
      const subject = token === TOKEN_A ? "user-a" : "user-b";
      return {
        ok: true as const,
        claims: {
          canonicalIssuer: "https://accounts.google.com" as const,
          subject,
          principalId: `https://accounts.google.com:${subject}`,
          email: `${subject}@example.test`,
          emailVerified: true as const,
          issuedAtMs: NOW - 1000,
          expiresAtMs: NOW + 7200_000,
          tokenDigestSha256: sha256(token),
        },
      };
    }),
  };

  const proxy: ProxySessionLogoutPort = {
    clearProxySession: vi.fn(async () => ({
      ok: true as const,
      setCookieHeaders: [
        "__Host-gwrk_session=; Path=/; Secure; HttpOnly; Max-Age=0",
      ],
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
    hmacKey: Buffer.alloc(32, 29),
    clock,
  });

  const fakeSandbox = {
    checkGit: vi.fn().mockResolvedValue(true),
    checkDocker: vi.fn().mockResolvedValue(true),
    listSandboxes: vi.fn().mockResolvedValue([]),
    pruneSandboxes: vi.fn().mockResolvedValue(undefined),
    pauseAll: vi.fn().mockResolvedValue(undefined),
    unpauseAll: vi.fn().mockResolvedValue(undefined),
  } as unknown as SandboxManager;

  const fakeNotifier: NotificationPort = {
    notify: vi.fn().mockResolvedValue({ ok: true, deliveryId: "csrf-notify" }),
    getDeliveryStatus: vi.fn().mockResolvedValue({
      mode: "socket_connected" as const,
      workspaceId: "W_CSRF",
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
    project: { name: "csrf-pilot-fixture" },
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

  const issueBrowserCsrf = async (token = TOKEN_A) => {
    const res = await server.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        authorization: `Bearer ${token}`,
        "x-gwrk-auth-mode": "google_id_token",
        cookie: PROXY_COOKIE,
      },
    });
    expect(res.statusCode).toBe(200);
    const cookieHeader = setCookieList(res)[0];
    expect(cookieHeader).toBeDefined();
    return {
      response: res,
      csrfToken: res.json().csrfToken as string,
      csrfCookiePair: cookieHeader.split(";", 1)[0],
      fullSetCookie: cookieHeader,
    };
  };

  const dispatchCount = (): number =>
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
    db,
    authStore,
    project,
    proxy,
    validApiKey: generatedValidKey.rawCredential,
    revokedApiKey: generatedRevokedKey.rawCredential,
    issueBrowserCsrf,
    dispatchCount,
    googleSessionCount,
  };
}

describe("FR-009 US-002 TR-011 AUTH-11: browser same-origin and session-bound CSRF protection on hosted startServer", () => {
  it("AUTH-11: rejects browser mutations on dispatch, notify, and logout with missing or cross-site Origin", async () => {
    const f = await createCsrfServerFixture();
    const { csrfToken, csrfCookiePair } = await f.issueBrowserCsrf(TOKEN_A);

    const badOrigins = [
      undefined,
      "https://evil.example.test",
      "http://gwrk.gforge.ai",
      "https://gwrk.gforge.ai:8443",
      "null",
    ];

    for (const origin of badOrigins) {
      const baseHeaders: Record<string, string> = {
        authorization: `Bearer ${TOKEN_A}`,
        "x-gwrk-auth-mode": "google_id_token",
        "x-gwrk-csrf-token": csrfToken,
        cookie: `${PROXY_COOKIE}; ${csrfCookiePair}`,
        ...(origin !== undefined ? { origin } : {}),
      };

      const dispatchRes = await f.server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: baseHeaders,
        payload: {
          projectId: f.project.projectId,
          featureId: "051-pilot",
          phaseId: "phase-05",
        },
      });
      expect(dispatchRes.statusCode).toBe(403);
      expect(dispatchRes.json()).toMatchObject({
        ok: false,
        code: "AUTH_ORIGIN_MISMATCH",
        requestId: expect.any(String),
      });

      const notifyRes = await f.server.inject({
        method: "POST",
        url: "/api/notify",
        headers: baseHeaders,
        payload: {
          projectId: f.project.projectId,
          type: "phase_start",
          feature: "051-pilot",
          phase: "phase-05",
        },
      });
      expect(notifyRes.statusCode).toBe(403);
      expect(notifyRes.json()).toMatchObject({
        ok: false,
        code: "AUTH_ORIGIN_MISMATCH",
        requestId: expect.any(String),
      });

      const logoutRes = await f.server.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: baseHeaders,
      });
      expect(logoutRes.statusCode).toBe(403);
      expect(logoutRes.json()).toMatchObject({
        ok: false,
        code: "AUTH_ORIGIN_MISMATCH",
        requestId: expect.any(String),
      });
    }

    expect(f.dispatchCount()).toBe(0);
    expect(slackNotify.notifySlack).not.toHaveBeenCalled();
    expect(f.proxy.clearProxySession).not.toHaveBeenCalled();
    expect(f.authStore.getGoogleSession(sha256(TOKEN_A))?.revokedAt).toBeNull();
  });

  it("AUTH-11: rejects query-only and mixed query CSRF tokens even when Origin and cookie are valid", async () => {
    const f = await createCsrfServerFixture();
    const { csrfToken, csrfCookiePair } = await f.issueBrowserCsrf(TOKEN_A);

    for (const paramName of [
      "csrf",
      "csrf_token",
      "csrftoken",
      "_csrf",
      "x-gwrk-csrf-token",
    ]) {
      const queryOnlyRes = await f.server.inject({
        method: "POST",
        url: `/api/dispatch?${paramName}=${encodeURIComponent(csrfToken)}`,
        headers: {
          authorization: `Bearer ${TOKEN_A}`,
          "x-gwrk-auth-mode": "google_id_token",
          origin: ORIGIN,
          cookie: `${PROXY_COOKIE}; ${csrfCookiePair}`,
        },
        payload: {
          projectId: f.project.projectId,
          featureId: "051-pilot",
          phaseId: "phase-05",
        },
      });
      expect(queryOnlyRes.statusCode).toBe(403);
      expect(queryOnlyRes.json()).toMatchObject({
        ok: false,
        code: "AUTH_CSRF_INVALID",
        requestId: expect.any(String),
      });

      const mixedRes = await f.server.inject({
        method: "POST",
        url: `/api/notify?${paramName}=${encodeURIComponent(csrfToken)}`,
        headers: {
          authorization: `Bearer ${TOKEN_A}`,
          "x-gwrk-auth-mode": "google_id_token",
          origin: ORIGIN,
          "x-gwrk-csrf-token": csrfToken,
          cookie: `${PROXY_COOKIE}; ${csrfCookiePair}`,
        },
        payload: {
          projectId: f.project.projectId,
          type: "phase_start",
          feature: "051-pilot",
          phase: "phase-05",
        },
      });
      expect(mixedRes.statusCode).toBe(403);
      expect(mixedRes.json()).toMatchObject({
        ok: false,
        code: "AUTH_CSRF_INVALID",
        requestId: expect.any(String),
      });
    }

    expect(f.dispatchCount()).toBe(0);
    expect(slackNotify.notifySlack).not.toHaveBeenCalled();
  });

  it("AUTH-11: rejects wrong-session CSRF tokens, raw ID tokens as CSRF, missing cookies, and duplicate CSRF cookies", async () => {
    const f = await createCsrfServerFixture();
    const sessionA = await f.issueBrowserCsrf(TOKEN_A);
    const sessionB = await f.issueBrowserCsrf(TOKEN_B);

    const probes = [
      {
        label: "Session A CSRF replayed against Session B",
        headers: {
          authorization: `Bearer ${TOKEN_B}`,
          "x-gwrk-auth-mode": "google_id_token",
          origin: ORIGIN,
          "x-gwrk-csrf-token": sessionA.csrfToken,
          cookie: `${PROXY_COOKIE}; ${sessionA.csrfCookiePair}`,
        },
      },
      {
        label: "Session A token paired with Session B cookie",
        headers: {
          authorization: `Bearer ${TOKEN_A}`,
          "x-gwrk-auth-mode": "google_id_token",
          origin: ORIGIN,
          "x-gwrk-csrf-token": sessionA.csrfToken,
          cookie: `${PROXY_COOKIE}; ${sessionB.csrfCookiePair}`,
        },
      },
      {
        label: "raw Google ID token submitted as CSRF header",
        headers: {
          authorization: `Bearer ${TOKEN_A}`,
          "x-gwrk-auth-mode": "google_id_token",
          origin: ORIGIN,
          "x-gwrk-csrf-token": TOKEN_A,
          cookie: `${PROXY_COOKIE}; ${sessionA.csrfCookiePair}`,
        },
      },
      {
        label: "missing __Host-gwrk_csrf cookie",
        headers: {
          authorization: `Bearer ${TOKEN_A}`,
          "x-gwrk-auth-mode": "google_id_token",
          origin: ORIGIN,
          "x-gwrk-csrf-token": sessionA.csrfToken,
          cookie: PROXY_COOKIE,
        },
      },
      {
        label: "duplicate __Host-gwrk_csrf cookies",
        headers: {
          authorization: `Bearer ${TOKEN_A}`,
          "x-gwrk-auth-mode": "google_id_token",
          origin: ORIGIN,
          "x-gwrk-csrf-token": sessionA.csrfToken,
          cookie: `${PROXY_COOKIE}; ${sessionA.csrfCookiePair}; ${sessionB.csrfCookiePair}`,
        },
      },
    ];

    for (const probe of probes) {
      const dispatchRes = await f.server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: probe.headers,
        payload: {
          projectId: f.project.projectId,
          featureId: "051-pilot",
          phaseId: "phase-05",
        },
      });
      expect(dispatchRes.statusCode, probe.label).toBe(403);
      expect(dispatchRes.json(), probe.label).toMatchObject({
        ok: false,
        code: "AUTH_CSRF_INVALID",
        requestId: expect.any(String),
      });

      const logoutRes = await f.server.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: probe.headers,
      });
      expect(logoutRes.statusCode, `${probe.label} (logout)`).toBe(403);
      expect(logoutRes.json(), `${probe.label} (logout)`).toMatchObject({
        ok: false,
        code: "AUTH_CSRF_INVALID",
        requestId: expect.any(String),
      });
    }

    expect(f.dispatchCount()).toBe(0);
    expect(f.proxy.clearProxySession).not.toHaveBeenCalled();
  });

  it("AUTH-11 FR-009: invalid API keys never fall back to a browser session cookie", async () => {
    const f = await createCsrfServerFixture();
    const { csrfToken, csrfCookiePair } = await f.issueBrowserCsrf(TOKEN_A);
    const sessionsBefore = f.googleSessionCount();

    const invalidBearers = [
      "malformed-api-key",
      `gwrk_v1.cred-csrf-operator.${"z".repeat(43)}`,
      f.revokedApiKey,
      f.validApiKey,
    ];

    for (const bearer of invalidBearers) {
      for (const sessionCookie of [PROXY_COOKIE, PROXY_CHUNK_COOKIE]) {
        const res = await f.server.inject({
          method: "POST",
          url: "/api/dispatch",
          headers: {
            authorization: `Bearer ${bearer}`,
            "x-gwrk-auth-mode": "api_key",
            origin: ORIGIN,
            "x-gwrk-csrf-token": csrfToken,
            cookie: `${sessionCookie}; ${csrfCookiePair}`,
          },
          payload: {
            projectId: f.project.projectId,
            featureId: "051-pilot",
            phaseId: "phase-05",
          },
        });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toMatchObject({
          ok: false,
          code: "AUTH_CONFLICTING_CREDENTIALS",
          requestId: expect.any(String),
        });
        expect(res.body).not.toContain(bearer);
      }
    }

    expect(f.dispatchCount()).toBe(0);
    expect(f.googleSessionCount()).toBe(sessionsBefore);
  });

  it("AUTH-11 FR-009: accepts valid same-origin session-bound browser writes and allows API key writes without CSRF", async () => {
    const f = await createCsrfServerFixture();
    const issued = await f.issueBrowserCsrf(TOKEN_A);

    expect(issued.response.headers["cache-control"]).toBe("no-store");
    expect(issued.csrfToken).not.toBe(TOKEN_A);
    expect(issued.fullSetCookie).toMatch(
      /^__Host-gwrk_csrf=[^;]+;.*Path=\/.*HttpOnly.*Secure/i,
    );
    expect(issued.fullSetCookie).not.toMatch(/Domain=|Max-Age=/i);

    const browserDispatch = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: {
        authorization: `Bearer ${TOKEN_A}`,
        "x-gwrk-auth-mode": "google_id_token",
        origin: ORIGIN,
        "x-gwrk-csrf-token": issued.csrfToken,
        cookie: `${PROXY_COOKIE}; ${issued.csrfCookiePair}`,
      },
      payload: {
        projectId: f.project.projectId,
        featureId: "051-csrf-browser",
        phaseId: "phase-05",
      },
    });
    expect(browserDispatch.statusCode).toBe(201);
    expect(browserDispatch.json().operationId).toBeTruthy();

    const browserNotify = await f.server.inject({
      method: "POST",
      url: "/api/notify",
      headers: {
        authorization: `Bearer ${TOKEN_A}`,
        "x-gwrk-auth-mode": "google_id_token",
        origin: ORIGIN,
        "x-gwrk-csrf-token": issued.csrfToken,
        cookie: `${PROXY_COOKIE}; ${issued.csrfCookiePair}`,
      },
      payload: {
        projectId: f.project.projectId,
        type: "phase_start",
        feature: "051-csrf-browser",
        phase: "phase-05",
      },
    });
    expect(browserNotify.statusCode).toBe(200);
    expect(slackNotify.notifySlack).toHaveBeenCalledTimes(1);

    const apiKeyDispatch = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: {
        authorization: `Bearer ${f.validApiKey}`,
      },
      payload: {
        projectId: f.project.projectId,
        featureId: "051-csrf-api",
        phaseId: "phase-05",
      },
    });
    expect(apiKeyDispatch.statusCode).toBe(201);
    expect(f.dispatchCount()).toBe(2);
  });
});
