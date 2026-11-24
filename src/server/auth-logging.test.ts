/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
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
const NOW = Date.parse("2026-11-23T20:30:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const CANARY_JWT_SIG = "CANARY_JWT_SIG_VALUE_9876543210";
const CANARY_GOOGLE_JWT = `eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJsb2ctdXNlciJ9.${CANARY_JWT_SIG}`;
const CANARY_SESSION_COOKIE = "CANARY_HOST_SESSION_COOKIE_VAL";
const CANARY_CHUNK0_COOKIE = "CANARY_HOST_SESSION_CHUNK0_VAL";
const CANARY_CHUNK1_COOKIE = "CANARY_HOST_SESSION_CHUNK1_VAL";
const CANARY_CSRF_COOKIE = "CANARY_CSRF_COOKIE_SECRET_VAL";
const CANARY_CSRF_HEADER = "CANARY_CSRF_HEADER_TOKEN_VAL";
const CANARY_OAUTH_CODE = "CANARY_OAUTH_CODE_445566";
const CANARY_OAUTH_STATE = "CANARY_OAUTH_STATE_778899";
const CANARY_QUERY_TOKEN = "CANARY_QUERY_TOKEN_112233";
const CANARY_QUERY_CSRF = "CANARY_QUERY_CSRF_334455";
const CANARY_QUERY_CSRF2 = "CANARY_QUERY_CSRF2_556677";
const CANARY_QUERY_APIKEY = "CANARY_QUERY_APIKEY_778800";
const CANARY_MALFORMED_CODE = "CANARY_MALFORMED_CODE_9900";
const CANARY_MALFORMED_STATE = "CANARY_MALFORMED_STATE_8811";
const CANARY_MALFORMED_TOKEN = "CANARY_MALFORMED_TOKEN_7722";
const CANARY_DEP_ERR_BEARER = "CANARY_DEP_ERR_BEARER_6633";
const CANARY_DEP_ERR_SESSION = "CANARY_DEP_ERR_SESSION_5544";
const CANARY_DEP_ERR_CHUNK = "CANARY_DEP_ERR_CHUNK_4455";
const CANARY_DEP_ERR_CODE = "CANARY_DEP_ERR_CODE_3366";
const CANARY_DEP_ERR_TOKEN = "CANARY_DEP_ERR_TOKEN_2277";
const CANARY_DEP_ERR_CSRF = "CANARY_DEP_ERR_CSRF_1188";
const CANARY_FWD_ACCESS = "CANARY_FWD_ACCESS_TOKEN_9911";
const CANARY_AUTHREQ_ACCESS = "CANARY_AUTHREQ_ACCESS_TOKEN_8822";
const CANARY_BODY_SECRET = "CANARY_BODY_SECRET_VALUE_7733";
const CANARY_SET_COOKIE_PROXY0 = "CANARY_PROXY_CLEAR_VAL_0";
const CANARY_SET_COOKIE_PROXY1 = "CANARY_PROXY_CLEAR_VAL_1";

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of cleanup.splice(0)) {
    await close();
  }
  vi.restoreAllMocks();
});

function createLogSink() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk),
      );
      callback();
    },
  });
  return {
    stream,
    readAll: () => chunks.join(""),
    lines: () =>
      chunks
        .join("")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
  };
}

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

async function createLoggingServerFixture(
  options: {
    throwOnAuth?: boolean;
    throwOnLogout?: boolean;
  } = {},
) {
  vi.clearAllMocks();
  vi.spyOn(gwrkPaths, "usesHostedRuntime").mockReturnValue(false);
  vi.spyOn(HarvestWatcher.prototype, "start").mockImplementation(() => {});
  vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(true);

  const tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-hosted-logging-")),
  );
  const repoDir = path.join(tmpDir, "logging-repo");
  const projectId = initFixtureRepo(
    repoDir,
    "git@github.com:org/logging-pilot.git",
  );

  const db = openDatabase({ dbPath: path.join(tmpDir, "gwrk.db") });
  const registry = createSqliteProjectRegistryAdapter({ db });
  const operationsStore = createSqliteOperationsStoreAdapter({ db });
  const authStore = createSqliteAuthStoreAdapter({ db });
  const crypto = createCredentialCryptoAdapter();

  const project = registry.enrollProject({
    projectId,
    slug: "logging-pilot-slug",
    name: "Logging Pilot Project",
    repoSlug: "org/logging-pilot",
    trunkBranch: "main",
    localRoot: repoDir,
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["local", "hosted"] },
    slack: {
      workspaceId: "W_LOG",
      channelId: "C_LOG",
      sharedChannel: false,
    },
    legacyProjectIds: [],
    createdAt: iso(NOW - 10_000),
    updatedAt: iso(NOW - 10_000),
  });

  const apiKey = crypto.generateApiCredential("cred-log-op");
  authStore.createCredentialWithGrants({
    credentialId: "cred-log-op",
    verifierSha256: apiKey.verifierSha256,
    label: "log-op",
    issuer: "local-admin",
    audienceOrigin: ORIGIN,
    createdAt: iso(NOW - 1000),
    expiresAt: iso(NOW + 3600_000),
    grants: [{ projectId: project.projectId, role: "operator" }],
  });

  registry.setRoleBinding({
    projectId: project.projectId,
    principalType: "google_sub",
    principalId: "https://accounts.google.com:log-user",
    role: "operator",
  });

  const clock = { nowMs: () => NOW, nowIso: () => iso(NOW) };
  const google: GoogleIdentityVerifierPort = {
    verifyIdToken: vi.fn(async ({ token }) => {
      if (token !== CANARY_GOOGLE_JWT) {
        return {
          ok: false as const,
          code: "AUTH_TOKEN_INVALID" as const,
          message: "Denied",
        };
      }
      return {
        ok: true as const,
        claims: {
          canonicalIssuer: "https://accounts.google.com" as const,
          subject: "log-user",
          principalId: "https://accounts.google.com:log-user",
          email: "log-user@example.test",
          emailVerified: true as const,
          issuedAtMs: NOW - 1000,
          expiresAtMs: NOW + 7200_000,
          tokenDigestSha256: sha256(token),
        },
      };
    }),
  };

  const proxy: ProxySessionLogoutPort = {
    clearProxySession: vi.fn(async () => {
      if (options.throwOnLogout) {
        throw new Error(
          `Upstream proxy error Bearer ${CANARY_DEP_ERR_BEARER} __Host-gwrk_session=${CANARY_DEP_ERR_SESSION} __Host-gwrk_session_0=${CANARY_DEP_ERR_CHUNK}`,
        );
      }
      return {
        ok: true as const,
        setCookieHeaders: [
          `__Host-gwrk_session_0=${CANARY_SET_COOKIE_PROXY0}; Path=/; Secure; HttpOnly; Max-Age=0`,
          `__Host-gwrk_session_1=${CANARY_SET_COOKIE_PROXY1}; Path=/; Secure; HttpOnly; Max-Age=0`,
        ],
      };
    }),
  };

  const baseAuthenticate = createRequestAuthenticator({
    store: authStore,
    crypto,
    google,
    clock,
    expectedOrigin: ORIGIN,
  });

  const authenticate = options.throwOnAuth
    ? async () => {
        const cause = new Error(
          `Cause: gwrk_v1.errkey.${"E".repeat(43)} ?code=${CANARY_DEP_ERR_CODE}&token=${CANARY_DEP_ERR_TOKEN}&csrf=${CANARY_DEP_ERR_CSRF}`,
        );
        throw new Error(
          `Auth dep failed: Bearer ${CANARY_DEP_ERR_BEARER} __Host-gwrk_session=${CANARY_DEP_ERR_SESSION} __Host-gwrk_session_0=${CANARY_DEP_ERR_CHUNK}`,
          { cause },
        );
      }
    : baseAuthenticate;

  const sessions = createBrowserSessionService({
    store: authStore,
    proxy,
    clock,
  });
  const csrf = createBrowserCsrfAdapter({
    hmacKey: Buffer.alloc(32, 43),
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
    notify: vi.fn().mockResolvedValue({ ok: true, deliveryId: "log-notify" }),
    getDeliveryStatus: vi.fn().mockResolvedValue({
      mode: "socket_connected" as const,
      workspaceId: "W_LOG",
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
    project: { name: "logging-pilot-fixture" },
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

  const logSink = createLogSink();
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
    loggerStream: logSink.stream,
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

  return {
    server,
    project,
    apiKey: apiKey.rawCredential,
    apiKeySecret: apiKey.rawCredential.split(".")[2],
    logSink,
  };
}

describe("FR-013 US-008 TR-015 AUTH-15: sanitized Fastify logger and zero canary secret leaks", () => {
  it("AUTH-15: emits real structured logs to the configured stream with zero canary secrets across success, denials, cookies, query params, and errors", async () => {
    const f = await createLoggingServerFixture();
    const responseBodies: string[] = [];
    const dynamicCanaries: string[] = [];

    // 1. Successful API key read and dispatch with body canary.
    const statusOk = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}&token=${CANARY_QUERY_TOKEN}&csrf=${CANARY_QUERY_CSRF}`,
      headers: {
        authorization: `Bearer ${f.apiKey}`,
        "x-forwarded-access-token": CANARY_FWD_ACCESS,
        "x-auth-request-access-token": CANARY_AUTHREQ_ACCESS,
      },
    });
    expect(statusOk.statusCode).toBe(200);
    responseBodies.push(statusOk.body);

    const dispatchOk = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: { authorization: `Bearer ${f.apiKey}` },
      payload: {
        projectId: f.project.projectId,
        featureId: "051-log-check",
        phaseId: "phase-05",
        extraSecret: CANARY_BODY_SECRET,
      },
    });
    expect(dispatchOk.statusCode).toBe(201);
    responseBodies.push(dispatchOk.body);

    // 2. Successful Google session issuance (Set-Cookie: __Host-gwrk_csrf=<issuedSecret>) and logout (separate Set-Cookie headers).
    const sessionRes = await f.server.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        authorization: `Bearer ${CANARY_GOOGLE_JWT}`,
        "x-gwrk-auth-mode": "google_id_token",
        cookie: `__Host-gwrk_session=${CANARY_SESSION_COOKIE}; __Host-gwrk_session_0=${CANARY_CHUNK0_COOKIE}; __Host-gwrk_session_1=${CANARY_CHUNK1_COOKIE}`,
      },
    });
    expect(sessionRes.statusCode).toBe(200);
    const issuedCsrfToken = sessionRes.json().csrfToken as string;
    const issuedCsrfCookie = setCookieList(sessionRes)[0];
    const issuedCsrfCookiePair = issuedCsrfCookie.split(";", 1)[0];
    const issuedCsrfSecret = issuedCsrfCookiePair.split("=", 2)[1];
    dynamicCanaries.push(issuedCsrfToken, issuedCsrfSecret);
    responseBodies.push(sessionRes.body);

    // 3. Denied browser write with query CSRF + header CSRF + cookie CSRF.
    const badCsrfRes = await f.server.inject({
      method: "POST",
      url: `/api/dispatch?csrf_token=${CANARY_QUERY_CSRF2}&_csrf=${CANARY_QUERY_CSRF}&api_key=${CANARY_QUERY_APIKEY}`,
      headers: {
        authorization: `Bearer ${CANARY_GOOGLE_JWT}`,
        "x-gwrk-auth-mode": "google_id_token",
        origin: "https://evil.example.test",
        "x-gwrk-csrf-token": CANARY_CSRF_HEADER,
        cookie: `__Host-gwrk_session=${CANARY_SESSION_COOKIE}; __Host-gwrk_csrf=${CANARY_CSRF_COOKIE}`,
      },
      payload: {
        projectId: f.project.projectId,
        featureId: "051-bad-csrf",
        phaseId: "phase-05",
      },
    });
    expect(badCsrfRes.statusCode).toBe(403);
    responseBodies.push(badCsrfRes.body);

    // 4. Denied conflicting credentials with chunked proxy cookies and bad API key.
    const badKey = `gwrk_v1.bad-log-key.${"Z".repeat(43)}`;
    dynamicCanaries.push(badKey, "Z".repeat(43));
    const conflictRes = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: {
        authorization: `Bearer ${badKey}`,
        "x-gwrk-auth-mode": "api_key",
        cookie: `__Host-gwrk_session_0=${CANARY_CHUNK0_COOKIE}; __Host-gwrk_session_1=${CANARY_CHUNK1_COOKIE}`,
      },
    });
    expect(conflictRes.statusCode).toBe(401);
    responseBodies.push(conflictRes.body);

    // 5. OAuth callback query params AND malformed percent-encoded URLs.
    const oauthQueryRes = await f.server.inject({
      method: "GET",
      url: `/oauth2/callback?code=${CANARY_OAUTH_CODE}&state=${CANARY_OAUTH_STATE}&token=${CANARY_QUERY_TOKEN}&csrf=${CANARY_QUERY_CSRF}`,
    });
    responseBodies.push(oauthQueryRes.body);

    const malformedUrlRes = await f.server.inject({
      method: "GET",
      url: `/oauth2/callback?code=${CANARY_MALFORMED_CODE}%E0%A4%A&state=${CANARY_MALFORMED_STATE}%ZZ&token=${CANARY_MALFORMED_TOKEN}%2`,
    });
    responseBodies.push(malformedUrlRes.body);

    // 6. Handler dependency error containing canaries in message and cause.
    vi.mocked(slackNotify.notifySlack).mockRejectedValueOnce(
      new Error(
        `Slack failure Bearer ${CANARY_DEP_ERR_BEARER} __Host-gwrk_session=${CANARY_DEP_ERR_SESSION} __Host-gwrk_session_0=${CANARY_DEP_ERR_CHUNK} ?code=${CANARY_DEP_ERR_CODE}&token=${CANARY_DEP_ERR_TOKEN}&csrf=${CANARY_DEP_ERR_CSRF}`,
      ),
    );
    const handlerErrRes = await f.server.inject({
      method: "POST",
      url: "/api/notify",
      headers: { authorization: `Bearer ${f.apiKey}` },
      payload: {
        projectId: f.project.projectId,
        type: "phase_start",
        feature: "051-err",
        phase: "phase-05",
      },
    });
    expect(handlerErrRes.statusCode).toBeGreaterThanOrEqual(500);
    responseBodies.push(handlerErrRes.body);

    // 7. Logout emitting multiple separate Set-Cookie headers.
    const logoutRes = await f.server.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        authorization: `Bearer ${CANARY_GOOGLE_JWT}`,
        "x-gwrk-auth-mode": "google_id_token",
        origin: ORIGIN,
        "x-gwrk-csrf-token": issuedCsrfToken,
        cookie: `__Host-gwrk_session=${CANARY_SESSION_COOKIE}; ${issuedCsrfCookiePair}`,
      },
    });
    expect(logoutRes.statusCode).toBe(200);
    expect(setCookieList(logoutRes).length).toBeGreaterThanOrEqual(3);
    responseBodies.push(logoutRes.body);

    const logOutput = f.logSink.readAll();
    const lines = f.logSink.lines();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    const allCanaries = [
      f.apiKey,
      f.apiKeySecret,
      CANARY_GOOGLE_JWT,
      CANARY_JWT_SIG,
      CANARY_SESSION_COOKIE,
      CANARY_CHUNK0_COOKIE,
      CANARY_CHUNK1_COOKIE,
      CANARY_CSRF_COOKIE,
      CANARY_CSRF_HEADER,
      CANARY_OAUTH_CODE,
      CANARY_OAUTH_STATE,
      CANARY_QUERY_TOKEN,
      CANARY_QUERY_CSRF,
      CANARY_QUERY_CSRF2,
      CANARY_QUERY_APIKEY,
      CANARY_MALFORMED_CODE,
      CANARY_MALFORMED_STATE,
      CANARY_MALFORMED_TOKEN,
      CANARY_DEP_ERR_BEARER,
      CANARY_DEP_ERR_SESSION,
      CANARY_DEP_ERR_CHUNK,
      CANARY_DEP_ERR_CODE,
      CANARY_DEP_ERR_TOKEN,
      CANARY_DEP_ERR_CSRF,
      CANARY_FWD_ACCESS,
      CANARY_AUTHREQ_ACCESS,
      CANARY_BODY_SECRET,
      CANARY_SET_COOKIE_PROXY0,
      CANARY_SET_COOKIE_PROXY1,
      ...dynamicCanaries,
    ];

    for (const canary of allCanaries) {
      expect(logOutput, `logger leaked canary ${canary}`).not.toContain(canary);
    }

    // Response bodies never echo credentials, cookies, or error secrets (excluding the intentional csrfToken field from /api/auth/session).
    for (const body of responseBodies) {
      for (const canary of allCanaries.filter((c) => c !== issuedCsrfToken)) {
        expect(body, `response leaked canary ${canary}`).not.toContain(canary);
      }
    }
  });

  it("AUTH-15: redacts canaries in thrown authentication and proxy-logout errors without leaking to logs or HTTP 503 responses", async () => {
    const authFail = await createLoggingServerFixture({ throwOnAuth: true });
    const res = await authFail.server.inject({
      method: "POST",
      url: `/api/dispatch?token=${CANARY_QUERY_TOKEN}&code=${CANARY_OAUTH_CODE}`,
      headers: {
        authorization: `Bearer ${authFail.apiKey}`,
        cookie: `__Host-gwrk_session=${CANARY_SESSION_COOKIE}`,
      },
      payload: {
        projectId: authFail.project.projectId,
        featureId: "051-auth-throw",
        phaseId: "phase-05",
      },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      ok: false,
      code: "AUTH_DEPENDENCY_UNAVAILABLE",
      requestId: expect.any(String),
    });

    const logOutput = authFail.logSink.readAll();
    expect(authFail.logSink.lines().length).toBeGreaterThan(0);

    for (const canary of [
      authFail.apiKey,
      authFail.apiKeySecret,
      CANARY_SESSION_COOKIE,
      CANARY_QUERY_TOKEN,
      CANARY_OAUTH_CODE,
      CANARY_DEP_ERR_BEARER,
      CANARY_DEP_ERR_SESSION,
      CANARY_DEP_ERR_CHUNK,
      CANARY_DEP_ERR_CODE,
      CANARY_DEP_ERR_TOKEN,
      CANARY_DEP_ERR_CSRF,
      "E".repeat(43),
    ]) {
      expect(logOutput, `auth error log leaked ${canary}`).not.toContain(
        canary,
      );
      expect(res.body, `auth error response leaked ${canary}`).not.toContain(
        canary,
      );
    }
  });

  it("AUTH-15: thrown proxy logout errors stay private after committed revocation", async () => {
    const f = await createLoggingServerFixture({ throwOnLogout: true });
    const headers = {
      authorization: `Bearer ${CANARY_GOOGLE_JWT}`,
      "x-gwrk-auth-mode": "google_id_token",
      cookie: `__Host-gwrk_session=${CANARY_SESSION_COOKIE}; __Host-gwrk_session_0=${CANARY_CHUNK0_COOKIE}`,
    };
    const session = await f.server.inject({
      method: "GET",
      url: "/api/auth/session",
      headers,
    });
    expect(session.statusCode).toBe(200);
    const csrfToken = session.json().csrfToken as string;
    const cookiePair = setCookieList(session)[0].split(";", 1)[0];
    const response = await f.server.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        ...headers,
        origin: ORIGIN,
        "x-gwrk-csrf-token": csrfToken,
        cookie: `${headers.cookie}; ${cookiePair}`,
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: true, proxyCleared: false });
    expect(
      setCookieList(response).some(
        (cookie) =>
          cookie.startsWith("__Host-gwrk_csrf=") &&
          cookie.includes("Max-Age=0"),
      ),
    ).toBe(true);
    const replay = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
      headers,
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe("AUTH_SESSION_REVOKED");
    expect(f.logSink.lines().length).toBeGreaterThan(0);
    const output = f.logSink.readAll();
    for (const canary of [
      CANARY_GOOGLE_JWT,
      CANARY_SESSION_COOKIE,
      CANARY_CHUNK0_COOKIE,
      CANARY_DEP_ERR_BEARER,
      CANARY_DEP_ERR_SESSION,
      CANARY_DEP_ERR_CHUNK,
      csrfToken,
      cookiePair.split("=", 2)[1],
    ]) {
      expect(output).not.toContain(canary);
      expect(response.body).not.toContain(canary);
      expect(replay.body).not.toContain(canary);
    }
  });

  it("AUTH-15: createSanitizedLoggerOptions redacts req, res separate Set-Cookie headers, and nested err objects directly", async () => {
    const { createSanitizedLoggerOptions } = await import("./auth-logging.js");
    const sink = createLogSink();
    const app = fastify({
      logger: createSanitizedLoggerOptions({ stream: sink.stream }),
    });
    cleanup.push(async () => {
      await app.close();
    });

    app.get("/probe", async (request, reply) => {
      reply.header("set-cookie", [
        `__Host-gwrk_session_0=${CANARY_SET_COOKIE_PROXY0}; Path=/; HttpOnly; Secure`,
        `__Host-gwrk_csrf=${CANARY_CSRF_COOKIE}; Path=/; HttpOnly; Secure`,
      ]);
      const nestedErr = new Error(
        `Nested failure Bearer ${CANARY_DEP_ERR_BEARER} __Host-gwrk_session=${CANARY_DEP_ERR_SESSION} __Host-gwrk_session_1=${CANARY_CHUNK1_COOKIE}`,
        {
          cause: new Error(
            `Cause ?code=${CANARY_DEP_ERR_CODE}&state=${CANARY_OAUTH_STATE}&token=${CANARY_DEP_ERR_TOKEN}&csrf=${CANARY_DEP_ERR_CSRF}`,
          ),
        },
      );
      request.log.error(
        { err: nestedErr, req: request, res: reply },
        "probe error",
      );
      return { ok: true };
    });

    const res = await app.inject({
      method: "GET",
      url: `/probe?code=${CANARY_OAUTH_CODE}&state=${CANARY_OAUTH_STATE}&token=${CANARY_QUERY_TOKEN}&csrf=${CANARY_QUERY_CSRF}&bad=%E0%A4%A${CANARY_MALFORMED_CODE}`,
      headers: {
        authorization: `Bearer ${CANARY_GOOGLE_JWT}`,
        cookie: `__Host-gwrk_session=${CANARY_SESSION_COOKIE}; __Host-gwrk_session_0=${CANARY_CHUNK0_COOKIE}; __Host-gwrk_csrf=${CANARY_CSRF_COOKIE}`,
        "x-gwrk-csrf-token": CANARY_CSRF_HEADER,
      },
    });
    expect(res.statusCode).toBe(200);

    const output = sink.readAll();
    expect(sink.lines().length).toBeGreaterThan(0);
    for (const canary of [
      CANARY_GOOGLE_JWT,
      CANARY_JWT_SIG,
      CANARY_SESSION_COOKIE,
      CANARY_CHUNK0_COOKIE,
      CANARY_CHUNK1_COOKIE,
      CANARY_CSRF_COOKIE,
      CANARY_CSRF_HEADER,
      CANARY_SET_COOKIE_PROXY0,
      CANARY_OAUTH_CODE,
      CANARY_OAUTH_STATE,
      CANARY_QUERY_TOKEN,
      CANARY_QUERY_CSRF,
      CANARY_MALFORMED_CODE,
      CANARY_DEP_ERR_BEARER,
      CANARY_DEP_ERR_SESSION,
      CANARY_DEP_ERR_CODE,
      CANARY_DEP_ERR_TOKEN,
      CANARY_DEP_ERR_CSRF,
    ]) {
      expect(output, `serializer leaked ${canary}`).not.toContain(canary);
    }
  });
});
