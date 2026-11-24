/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fastify from "fastify";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createBrowserCsrfAdapter } from "../adapters/auth/browser-csrf.js";
import { createCredentialCryptoAdapter } from "../adapters/auth/credential-crypto.js";
import { createGoogleIdentityVerifier } from "../adapters/auth/google-id-token.js";
import { createRateAdmission } from "../adapters/auth/rate-admission.js";
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
import { DEFAULT_HOSTED_SECURITY_POLICY } from "../domain/auth-policy.js";
import { computeProjectId } from "../domain/project-id.js";
import type {
  GoogleIdentityVerifierPort,
  ProxySessionLogoutPort,
} from "../ports/auth-port.js";
import type { NotificationPort } from "../ports/notification-port.js";
import type {
  ClockPort,
  GitHubHarvestPort,
  WorkerExecutionPort,
} from "../ports/operations-port.js";
import type { RateAdmissionPort } from "../ports/rate-admission-port.js";
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
const BASE_NOW = Date.parse("2026-11-23T20:00:00.000Z");
const GOOGLE_TOKEN = "CANARY_BOUNDS_GOOGLE_ID_TOKEN";
const iso = (ms: number) => new Date(ms).toISOString();
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

let rsaKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwksPayload: { keys: object[] };
let signedGoogleJwt: string;

const cleanup: (() => Promise<void>)[] = [];

beforeAll(async () => {
  rsaKeys = await generateKeyPair("RS256");
  jwksPayload = {
    keys: [
      {
        ...(await exportJWK(rsaKeys.publicKey)),
        kid: "bounds-kid",
        alg: "RS256",
      },
    ],
  };
  signedGoogleJwt = await new SignJWT({
    email: "bounds-operator@example.test",
    email_verified: true,
  })
    .setProtectedHeader({ alg: "RS256", kid: "bounds-kid" })
    .setIssuer("https://accounts.google.com")
    .setAudience("bounds-client")
    .setSubject("bounds-operator")
    .setIssuedAt(Math.floor(BASE_NOW / 1000) - 5)
    .setExpirationTime(Math.floor(BASE_NOW / 1000) + 3600)
    .sign(rsaKeys.privateKey);
});

afterEach(async () => {
  for (const close of cleanup.splice(0)) {
    await close();
  }
  vi.restoreAllMocks();
});

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

function sendRawLoopbackHttp(
  port: number,
  rawRequest: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(rawRequest);
    });
    const chunks: Buffer[] = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", (err) => {
      const data = Buffer.concat(chunks).toString("utf8");
      if (data.length > 0) resolve(data);
      else reject(err);
    });
    socket.setTimeout(5000, () => {
      socket.destroy(new Error("Loopback parser fixture timed out"));
    });
  });
}

function sendLoopbackRequest(input: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}): Promise<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: input.port,
        method: input.method,
        path: input.path,
        headers: input.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (input.body !== undefined) {
      req.write(input.body);
    }
    req.end();
  });
}

async function createBoundsServerFixture(
  options: {
    googleVerifier?: GoogleIdentityVerifierPort;
    customAuthenticate?: ReturnType<typeof createRequestAuthenticator>;
    rateAdmission?: RateAdmissionPort;
    clock?: ClockPort;
  } = {},
) {
  vi.clearAllMocks();
  vi.spyOn(gwrkPaths, "usesHostedRuntime").mockReturnValue(false);
  vi.spyOn(HarvestWatcher.prototype, "start").mockImplementation(() => {});
  vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(true);

  const tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-hosted-bounds-")),
  );
  const repoDir = path.join(tmpDir, "bounds-repo");
  const projectId = initFixtureRepo(
    repoDir,
    "git@github.com:org/bounds-pilot.git",
  );

  const db = openDatabase({ dbPath: path.join(tmpDir, "gwrk.db") });
  const registry = createSqliteProjectRegistryAdapter({ db });
  const operationsStore = createSqliteOperationsStoreAdapter({ db });
  const authStore = createSqliteAuthStoreAdapter({ db });
  const crypto = createCredentialCryptoAdapter();

  const project = registry.enrollProject({
    projectId,
    slug: "bounds-pilot-slug",
    name: "Bounds Pilot Project",
    repoSlug: "org/bounds-pilot",
    trunkBranch: "main",
    localRoot: repoDir,
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["local", "hosted"] },
    slack: {
      workspaceId: "W_BOUNDS",
      channelId: "C_BOUNDS",
      sharedChannel: false,
    },
    legacyProjectIds: [],
    createdAt: iso(BASE_NOW - 10_000),
    updatedAt: iso(BASE_NOW - 10_000),
  });

  const operatorKey = crypto.generateApiCredential("cred-bounds-op");
  authStore.createCredentialWithGrants({
    credentialId: "cred-bounds-op",
    verifierSha256: operatorKey.verifierSha256,
    label: "bounds-op",
    issuer: "local-admin",
    audienceOrigin: ORIGIN,
    createdAt: iso(BASE_NOW - 1000),
    expiresAt: iso(BASE_NOW + 3600_000),
    grants: [{ projectId: project.projectId, role: "operator" }],
  });

  const viewerKey = crypto.generateApiCredential("cred-bounds-viewer");
  authStore.createCredentialWithGrants({
    credentialId: "cred-bounds-viewer",
    verifierSha256: viewerKey.verifierSha256,
    label: "bounds-viewer",
    issuer: "local-admin",
    audienceOrigin: ORIGIN,
    createdAt: iso(BASE_NOW - 1000),
    expiresAt: iso(BASE_NOW + 3600_000),
    grants: [{ projectId: project.projectId, role: "viewer" }],
  });

  registry.setRoleBinding({
    projectId: project.projectId,
    principalType: "google_sub",
    principalId: "https://accounts.google.com:bounds-operator",
    role: "operator",
  });

  let now = BASE_NOW;
  const clock: ClockPort = options.clock ?? {
    nowMs: () => now,
    nowIso: () => iso(now),
  };

  const defaultGoogle: GoogleIdentityVerifierPort = {
    verifyIdToken: vi.fn(async ({ token }) => {
      if (token !== GOOGLE_TOKEN) {
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
          subject: "bounds-operator",
          principalId: "https://accounts.google.com:bounds-operator",
          email: "bounds-operator@example.test",
          emailVerified: true as const,
          issuedAtMs: BASE_NOW - 1000,
          expiresAtMs: BASE_NOW + 7200_000,
          tokenDigestSha256: sha256(token),
        },
      };
    }),
  };

  const google = options.googleVerifier ?? defaultGoogle;
  const proxy: ProxySessionLogoutPort = {
    clearProxySession: vi.fn(async () => ({
      ok: true as const,
      setCookieHeaders: [],
    })),
  };

  const authenticate =
    options.customAuthenticate ??
    createRequestAuthenticator({
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
    hmacKey: Buffer.alloc(32, 41),
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
    notify: vi
      .fn()
      .mockResolvedValue({ ok: true, deliveryId: "bounds-notify" }),
    getDeliveryStatus: vi.fn().mockResolvedValue({
      mode: "socket_connected" as const,
      workspaceId: "W_BOUNDS",
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
    project: { name: "bounds-pilot-fixture" },
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
      ...(options.rateAdmission
        ? { rateAdmission: options.rateAdmission }
        : {}),
    },
  });

  cleanup.push(async () => {
    await server.close();
    if (db.open) db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const addresses = server.addresses();
  const port = addresses[0]?.port;
  if (!port) throw new Error("Expected bound loopback port from startServer");

  const dispatchCount = (): number =>
    (
      db.prepare("SELECT COUNT(*) AS count FROM dispatch_operations").get() as {
        count: number;
      }
    ).count;

  return {
    server,
    port,
    db,
    project,
    google,
    operatorKey: operatorKey.rawCredential,
    viewerKey: viewerKey.rawCredential,
    advanceMs: (ms: number) => {
      now += ms;
    },
    dispatchCount,
  };
}

describe("FR-013 US-008 TR-014 AUTH-14: full-server HTTP rate admission, parser bounds, and dependency outages", () => {
  it("AUTH-14: holds 60 requests at verifier barrier from one trusted IP and denies attempt 61 with HTTP 429 before verifier", async () => {
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    let entered = 0;

    const verifyIdToken = vi.fn(async () => {
      entered++;
      if (entered <= 60) await barrier;
      return {
        ok: false as const,
        code: "AUTH_TOKEN_INVALID" as const,
        message: "Denied",
      };
    });

    const f = await createBoundsServerFixture({
      googleVerifier: { verifyIdToken },
    });

    const inflight = Array.from({ length: 60 }, (_, idx) =>
      f.server
        .inject({
          method: "POST",
          url: "/api/dispatch",
          remoteAddress: "127.0.0.1",
          headers: {
            "x-forwarded-for": "198.51.100.10",
            authorization: `Bearer bad-google-${idx}`,
            "x-gwrk-auth-mode": "google_id_token",
          },
          payload: {
            projectId: f.project.projectId,
            featureId: "051-barrier",
            phaseId: "phase-05",
          },
        })
        .then((response) => response),
    );

    try {
      await vi.waitFor(() => expect(entered).toBe(60), { timeout: 1000 });
      expect(verifyIdToken).toHaveBeenCalledTimes(60);
      expect(f.dispatchCount()).toBe(0);

      const attempt61 = await f.server.inject({
        method: "POST",
        url: "/api/dispatch",
        remoteAddress: "127.0.0.1",
        headers: {
          "x-forwarded-for": "198.51.100.10",
          authorization: "Bearer bad-google-61",
          "x-gwrk-auth-mode": "google_id_token",
        },
        payload: {
          projectId: f.project.projectId,
          featureId: "051-barrier",
          phaseId: "phase-05",
        },
      });

      expect(attempt61.statusCode).toBe(429);
      expect(attempt61.json()).toMatchObject({
        ok: false,
        code: "RATE_LIMIT_EXCEEDED",
        requestId: expect.any(String),
      });
      expect(verifyIdToken).toHaveBeenCalledTimes(60);
      expect(f.dispatchCount()).toBe(0);

      // Minimal private liveness stays independent of API rate admission.
      const liveness = await f.server.inject({
        method: "GET",
        url: "/health",
        remoteAddress: "127.0.0.1",
        headers: { "x-forwarded-for": "198.51.100.10" },
      });
      expect(liveness.statusCode).toBe(200);
      expect(liveness.json()).toEqual({
        status: "ok",
        daemonLiveness: "alive",
      });

      releaseBarrier();
      const responses = await Promise.all(inflight);
      expect(responses.every((res) => res.statusCode === 401)).toBe(true);
      expect(f.dispatchCount()).toBe(0);
    } finally {
      releaseBarrier();
      await Promise.allSettled(inflight);
    }
  });

  it("AUTH-14: permits 120 sequential verified requests from one IP and denies request 121 by credential quota", async () => {
    const f = await createBoundsServerFixture();

    for (let i = 1; i <= 120; i++) {
      const res = await f.server.inject({
        method: "GET",
        url: `/api/status?projectId=${f.project.projectId}`,
        remoteAddress: "127.0.0.1",
        headers: {
          "x-forwarded-for": "198.51.100.11",
          authorization: `Bearer ${f.operatorKey}`,
        },
      });
      expect(res.statusCode, `sequential valid request #${i}`).toBe(200);
    }

    const request121 = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.11",
        authorization: `Bearer ${f.operatorKey}`,
      },
      payload: {
        projectId: f.project.projectId,
        featureId: "051-quota-121",
        phaseId: "phase-05",
      },
    });
    expect(request121.statusCode).toBe(429);
    expect(request121.json()).toMatchObject({
      ok: false,
      code: "RATE_LIMIT_EXCEEDED",
      requestId: expect.any(String),
    });
    expect(f.dispatchCount()).toBe(0);
  });

  it("AUTH-14: tracks credential quota across IPs while keeping two credentials on one IP independent", async () => {
    const f = await createBoundsServerFixture();

    for (let i = 0; i < 60; i++) {
      const ipA = await f.server.inject({
        method: "GET",
        url: `/api/status?projectId=${f.project.projectId}`,
        remoteAddress: "127.0.0.1",
        headers: {
          "x-forwarded-for": "198.51.100.20",
          authorization: `Bearer ${f.operatorKey}`,
        },
      });
      expect(ipA.statusCode).toBe(200);
    }

    for (let i = 0; i < 60; i++) {
      const ipB = await f.server.inject({
        method: "GET",
        url: `/api/status?projectId=${f.project.projectId}`,
        remoteAddress: "127.0.0.1",
        headers: {
          "x-forwarded-for": "198.51.100.21",
          authorization: `Bearer ${f.operatorKey}`,
        },
      });
      expect(ipB.statusCode).toBe(200);
    }

    const exhaustedSameCred = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.22",
        authorization: `Bearer ${f.operatorKey}`,
      },
    });
    expect(exhaustedSameCred.statusCode).toBe(429);
    expect(exhaustedSameCred.json().code).toBe("RATE_LIMIT_EXCEEDED");

    // Second distinct credential on the same IP remains admitted.
    const secondCredSameIp = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.20",
        authorization: `Bearer ${f.viewerKey}`,
      },
    });
    expect(secondCredSameIp.statusCode).toBe(200);
  });

  it("AUTH-14: retains IP charge on authentication denial and thrown dependency error without refund or operational effects", async () => {
    let shouldThrow = false;
    const authenticate = vi.fn(async () => {
      if (shouldThrow) {
        throw new Error("CANARY_DEP_ERR_SECRET");
      }
      return {
        ok: false as const,
        code: "AUTH_CREDENTIAL_REJECTED" as const,
        message: "Authentication denied",
      };
    });

    const f = await createBoundsServerFixture({
      customAuthenticate: authenticate,
    });

    for (let i = 0; i < 30; i++) {
      const denied = await f.server.inject({
        method: "POST",
        url: "/api/dispatch",
        remoteAddress: "127.0.0.1",
        headers: {
          "x-forwarded-for": "198.51.100.30",
          authorization: `Bearer gwrk_v1.unknown.${"a".repeat(43)}`,
        },
        payload: {
          projectId: f.project.projectId,
          featureId: "051-denial",
          phaseId: "phase-05",
        },
      });
      expect(denied.statusCode).toBe(401);
    }

    shouldThrow = true;
    for (let i = 0; i < 30; i++) {
      const errored = await f.server.inject({
        method: "POST",
        url: "/api/dispatch",
        remoteAddress: "127.0.0.1",
        headers: {
          "x-forwarded-for": "198.51.100.30",
          authorization: `Bearer gwrk_v1.unknown.${"b".repeat(43)}`,
        },
        payload: {
          projectId: f.project.projectId,
          featureId: "051-dep-err",
          phaseId: "phase-05",
        },
      });
      expect(errored.statusCode).toBe(503);
      expect(errored.body).not.toContain("CANARY_DEP_ERR_SECRET");
    }

    expect(authenticate).toHaveBeenCalledTimes(60);

    const attempt61 = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.30",
        authorization: `Bearer ${f.operatorKey}`,
      },
      payload: {
        projectId: f.project.projectId,
        featureId: "051-after-60",
        phaseId: "phase-05",
      },
    });
    expect(attempt61.statusCode).toBe(429);
    expect(attempt61.json().code).toBe("RATE_LIMIT_EXCEEDED");
    expect(authenticate).toHaveBeenCalledTimes(60);
    expect(f.dispatchCount()).toBe(0);
  });

  it("AUTH-14: real loopback client disconnect during blocked verification prevents handler effects and preserves single IP charge", async () => {
    let blockNext = true;
    let verifierEntered = false;
    let verifierFinished = false;
    let releaseVerifier!: () => void;
    const verifierGate = new Promise<void>((resolve) => {
      releaseVerifier = resolve;
    });

    let verifyCalls = 0;
    const customAuthenticate = vi.fn(
      async (input: { authorizationHeader?: string }) => {
        verifyCalls++;
        if (
          blockNext &&
          input.authorizationHeader ===
            `Bearer gwrk_v1.abort-op.${"a".repeat(43)}`
        ) {
          blockNext = false;
          verifierEntered = true;
          await verifierGate;
          verifierFinished = true;
          return {
            ok: true as const,
            context: {
              principalType: "cli_token" as const,
              principalId: "cred-bounds-op",
              credentialId: "cred-bounds-op",
              expiresAt: iso(BASE_NOW + 3600_000),
              authMethod: "api_key" as const,
            },
          };
        }
        return {
          ok: false as const,
          code: "AUTH_CREDENTIAL_REJECTED" as const,
          message: "Authentication denied",
        };
      },
    );

    const f = await createBoundsServerFixture({
      customAuthenticate,
    });

    const payload = JSON.stringify({
      projectId: f.project.projectId,
      featureId: "051-abort-disconnect",
      phaseId: "phase-05",
    });

    let serverSocketClosed = false;
    f.server.server.once("connection", (socket) => {
      socket.once("close", () => {
        serverSocketClosed = true;
      });
    });
    const abortReq = http.request({
      host: "127.0.0.1",
      port: f.port,
      method: "POST",
      path: "/api/dispatch",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(payload)),
        "x-forwarded-for": "198.51.100.40",
        authorization: `Bearer gwrk_v1.abort-op.${"a".repeat(43)}`,
      },
    });
    abortReq.on("error", () => {});
    abortReq.write(payload);
    abortReq.end();

    try {
      await vi.waitFor(() => expect(verifierEntered).toBe(true), {
        timeout: 1000,
      });
      abortReq.destroy();
      await vi.waitFor(() => expect(serverSocketClosed).toBe(true), {
        timeout: 1000,
      });

      releaseVerifier();
      await vi.waitFor(() => expect(verifierFinished).toBe(true), {
        timeout: 1000,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));

      // Late verifier resolution after abort MUST NOT execute the dispatch handler.
      expect(f.dispatchCount()).toBe(0);

      // Remaining IP allowance on 198.51.100.40 is exactly 59 (abort kept 1 charge, no refund and no double charge).
      for (let i = 0; i < 59; i++) {
        const res = await f.server.inject({
          method: "GET",
          url: `/api/status?projectId=${f.project.projectId}`,
          remoteAddress: "127.0.0.1",
          headers: {
            "x-forwarded-for": "198.51.100.40",
            authorization: `Bearer gwrk_v1.invalid.${"c".repeat(43)}`,
          },
        });
        expect(res.statusCode, `remaining attempt #${i + 1}`).toBe(401);
      }

      const callsBeforeLimit = verifyCalls;
      const attempt61 = await f.server.inject({
        method: "GET",
        url: `/api/status?projectId=${f.project.projectId}`,
        remoteAddress: "127.0.0.1",
        headers: {
          "x-forwarded-for": "198.51.100.40",
          authorization: `Bearer gwrk_v1.invalid.${"d".repeat(43)}`,
        },
      });
      expect(attempt61.statusCode).toBe(429);
      expect(attempt61.json().code).toBe("RATE_LIMIT_EXCEEDED");
      expect(verifyCalls).toBe(callsBeforeLimit);
      expect(f.dispatchCount()).toBe(0);
    } finally {
      abortReq.destroy();
      releaseVerifier();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  });

  it("AUTH-14: error or 403/500 response cleanup after verified completion neither double-charges nor refunds credential quota", async () => {
    const f = await createBoundsServerFixture();

    // Viewer denied 403 by project role policy AFTER verified auth completion.
    const roleDenied = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.50",
        authorization: `Bearer ${f.viewerKey}`,
      },
      payload: {
        projectId: f.project.projectId,
        featureId: "051-role-denied",
        phaseId: "phase-05",
      },
    });
    expect(roleDenied.statusCode).toBe(403);

    // Exactly 119 more verified requests succeed (proving 1 charge for the 403, not 0 and not 2).
    for (let i = 0; i < 119; i++) {
      const okRes = await f.server.inject({
        method: "GET",
        url: `/api/status?projectId=${f.project.projectId}`,
        remoteAddress: "127.0.0.1",
        headers: {
          "x-forwarded-for": "198.51.100.50",
          authorization: `Bearer ${f.viewerKey}`,
        },
      });
      expect(okRes.statusCode, `viewer follow-up #${i + 1}`).toBe(200);
    }

    const viewer121 = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.50",
        authorization: `Bearer ${f.viewerKey}`,
      },
    });
    expect(viewer121.statusCode).toBe(429);

    // Handler throws 500 AFTER verified auth completion.
    vi.mocked(slackNotify.notifySlack).mockRejectedValueOnce(
      new Error("CANARY_HANDLER_BOOM"),
    );
    const handlerErr = await f.server.inject({
      method: "POST",
      url: "/api/notify",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.51",
        authorization: `Bearer ${f.operatorKey}`,
      },
      payload: {
        projectId: f.project.projectId,
        type: "phase_start",
        feature: "051-handler-err",
        phase: "phase-05",
      },
    });
    expect(handlerErr.statusCode).toBeGreaterThanOrEqual(500);

    for (let i = 0; i < 119; i++) {
      const okRes = await f.server.inject({
        method: "GET",
        url: `/api/status?projectId=${f.project.projectId}`,
        remoteAddress: "127.0.0.1",
        headers: {
          "x-forwarded-for": "198.51.100.51",
          authorization: `Bearer ${f.operatorKey}`,
        },
      });
      expect(okRes.statusCode, `operator follow-up #${i + 1}`).toBe(200);
    }

    const operator121 = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.51",
        authorization: `Bearer ${f.operatorKey}`,
      },
    });
    expect(operator121.statusCode).toBe(429);
  });

  it("AUTH-14: preserves new IP generation across rollover, enforces 60 pending across rollover, and denies expired handles at 120s", async () => {
    let blockToken: string | null = "BLOCK_ROLLOVER";
    const enteredTokens = new Set<string>();
    const gateMap = new Map<string, Promise<void>>();
    const releaseMap = new Map<string, () => void>();

    const armGate = (tag: string) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      gateMap.set(tag, gate);
      releaseMap.set(tag, release);
      return { release };
    };

    const rolloverGate = armGate("BLOCK_ROLLOVER");
    const expiryGate = armGate("BLOCK_EXPIRY");

    let pendingBatchEntered = 0;
    let releaseSixtyPending!: () => void;
    const sixtyPendingGate = new Promise<void>((resolve) => {
      releaseSixtyPending = resolve;
    });

    const verifyIdToken = vi.fn(async ({ token }: { token: string }) => {
      if (
        token === blockToken ||
        token === "BLOCK_ROLLOVER" ||
        token === "BLOCK_EXPIRY"
      ) {
        enteredTokens.add(token);
        await gateMap.get(token);
        return {
          ok: true as const,
          claims: {
            canonicalIssuer: "https://accounts.google.com" as const,
            subject: "bounds-operator",
            principalId: "https://accounts.google.com:bounds-operator",
            email: "bounds-operator@example.test",
            emailVerified: true as const,
            issuedAtMs: BASE_NOW - 1000,
            expiresAtMs: BASE_NOW + 7200_000,
            tokenDigestSha256: sha256(token),
          },
        };
      }
      if (token.startsWith("PENDING_BATCH_")) {
        pendingBatchEntered++;
        await sixtyPendingGate;
        return {
          ok: false as const,
          code: "AUTH_TOKEN_INVALID" as const,
          message: "Denied",
        };
      }
      return {
        ok: false as const,
        code: "AUTH_TOKEN_INVALID" as const,
        message: "Denied",
      };
    });

    const f = await createBoundsServerFixture({
      googleVerifier: { verifyIdToken },
    });

    const requests: Promise<unknown>[] = [];
    try {
      // (a) Rollover while blocked: old verified completion MUST NOT refund the new IP generation.
      const oldReq = f.server
        .inject({
          method: "GET",
          url: `/api/status?projectId=${f.project.projectId}`,
          remoteAddress: "127.0.0.1",
          headers: {
            "x-forwarded-for": "198.51.100.60",
            authorization: "Bearer BLOCK_ROLLOVER",
            "x-gwrk-auth-mode": "google_id_token",
          },
        })
        .then((response) => response);
      requests.push(oldReq);
      await vi.waitFor(
        () => expect(enteredTokens.has("BLOCK_ROLLOVER")).toBe(true),
        { timeout: 1000 },
      );

      f.advanceMs(60_000);
      const newGenFirstFailure = await f.server.inject({
        method: "GET",
        url: `/api/status?projectId=${f.project.projectId}`,
        remoteAddress: "127.0.0.1",
        headers: {
          "x-forwarded-for": "198.51.100.60",
          authorization: "Bearer invalid-new-gen-0",
          "x-gwrk-auth-mode": "google_id_token",
        },
      });
      expect(newGenFirstFailure.statusCode).toBe(401);

      rolloverGate.release();
      expect((await oldReq).statusCode).toBe(200);

      for (let i = 1; i < 60; i++) {
        const failRes = await f.server.inject({
          method: "GET",
          url: `/api/status?projectId=${f.project.projectId}`,
          remoteAddress: "127.0.0.1",
          headers: {
            "x-forwarded-for": "198.51.100.60",
            authorization: `Bearer invalid-new-gen-${i}`,
            "x-gwrk-auth-mode": "google_id_token",
          },
        });
        expect(failRes.statusCode).toBe(401);
      }

      const newGenAttempt61 = await f.server.inject({
        method: "GET",
        url: `/api/status?projectId=${f.project.projectId}`,
        remoteAddress: "127.0.0.1",
        headers: {
          "x-forwarded-for": "198.51.100.60",
          authorization: "Bearer invalid-new-gen-60",
          "x-gwrk-auth-mode": "google_id_token",
        },
      });
      expect(newGenAttempt61.statusCode).toBe(429);

      // (b) 60 pending reservations stay capped across window rollover.
      const pendingBatch = Array.from({ length: 60 }, (_, idx) =>
        f.server
          .inject({
            method: "GET",
            url: `/api/status?projectId=${f.project.projectId}`,
            remoteAddress: "127.0.0.1",
            headers: {
              "x-forwarded-for": "198.51.100.61",
              authorization: `Bearer PENDING_BATCH_${idx}`,
              "x-gwrk-auth-mode": "google_id_token",
            },
          })
          .then((response) => response),
      );
      requests.push(...pendingBatch);
      await vi.waitFor(() => expect(pendingBatchEntered).toBe(60), {
        timeout: 1000,
      });
      f.advanceMs(60_000);
      const callsBeforeCrossGen61 = verifyIdToken.mock.calls.length;
      const crossGen61 = await f.server.inject({
        method: "GET",
        url: `/api/status?projectId=${f.project.projectId}`,
        remoteAddress: "127.0.0.1",
        headers: {
          "x-forwarded-for": "198.51.100.61",
          authorization: "Bearer cross-gen-61",
          "x-gwrk-auth-mode": "google_id_token",
        },
      });
      expect(crossGen61.statusCode).toBe(429);
      expect(verifyIdToken.mock.calls.length).toBe(callsBeforeCrossGen61);
      releaseSixtyPending();
      await Promise.all(pendingBatch);

      // (c) Fixed 120s reservation expiry while verification is blocked denies work.
      blockToken = "BLOCK_EXPIRY";
      const expiredReq = f.server
        .inject({
          method: "GET",
          url: `/api/status?projectId=${f.project.projectId}`,
          remoteAddress: "127.0.0.1",
          headers: {
            "x-forwarded-for": "198.51.100.62",
            authorization: "Bearer BLOCK_EXPIRY",
            "x-gwrk-auth-mode": "google_id_token",
          },
        })
        .then((response) => response);
      requests.push(expiredReq);
      await vi.waitFor(
        () => expect(enteredTokens.has("BLOCK_EXPIRY")).toBe(true),
        { timeout: 1000 },
      );
      f.advanceMs(120_000);
      expiryGate.release();
      const expiredRes = await expiredReq;
      expect([429, 503]).toContain(expiredRes.statusCode);
      expect(expiredRes.json()).toMatchObject({
        ok: false,
        requestId: expect.any(String),
      });
      expect(f.dispatchCount()).toBe(0);
    } finally {
      for (const release of releaseMap.values()) release();
      releaseSixtyPending();
      await Promise.allSettled(requests);
    }
  });

  it("AUTH-14: ignores forged forwarding headers from untrusted peers and normalizes IPv6 variants from trusted proxy", async () => {
    const f = await createBoundsServerFixture();

    // Untrusted direct peer rotating forged X-Forwarded-For cannot reset its quota.
    for (let i = 0; i < 60; i++) {
      const res = await f.server.inject({
        method: "GET",
        url: `/api/status?projectId=${f.project.projectId}`,
        remoteAddress: "198.51.100.77",
        headers: {
          "x-forwarded-for": `203.0.113.${i + 1}`,
          authorization: "Bearer malformed-key",
        },
      });
      expect(res.statusCode).toBe(401);
    }
    const untrusted61 = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
      remoteAddress: "198.51.100.77",
      headers: {
        "x-forwarded-for": "203.0.113.250",
        authorization: `Bearer ${f.operatorKey}`,
      },
    });
    expect(untrusted61.statusCode).toBe(429);

    // Trusted loopback proxy: equivalent IPv6 spellings share one bucket without aggregating neighbor ::2.
    for (let i = 0; i < 30; i++) {
      expect(
        (
          await f.server.inject({
            method: "GET",
            url: `/api/status?projectId=${f.project.projectId}`,
            remoteAddress: "127.0.0.1",
            headers: {
              "x-forwarded-for": "2001:0DB8:0:0:0:0:0:1",
              authorization: "Bearer malformed-key",
            },
          })
        ).statusCode,
      ).toBe(401);
    }
    for (let i = 0; i < 30; i++) {
      expect(
        (
          await f.server.inject({
            method: "GET",
            url: `/api/status?projectId=${f.project.projectId}`,
            remoteAddress: "127.0.0.1",
            headers: {
              "x-forwarded-for": "2001:db8::1",
              authorization: "Bearer malformed-key",
            },
          })
        ).statusCode,
      ).toBe(401);
    }
    const ipv6Variant61 = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "2001:db8:0:0::1",
        authorization: `Bearer ${f.operatorKey}`,
      },
    });
    expect(ipv6Variant61.statusCode).toBe(429);

    const ipv6Neighbor = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "2001:db8::2",
        authorization: `Bearer ${f.operatorKey}`,
      },
    });
    expect(ipv6Neighbor.statusCode).toBe(200);

    // A single mapped IPv6 address shares its quota with the equivalent IPv4 address.
    for (let i = 0; i < 30; i++) {
      expect(
        (
          await f.server.inject({
            method: "GET",
            url: `/api/status?projectId=${f.project.projectId}`,
            remoteAddress: "127.0.0.1",
            headers: {
              "x-forwarded-for": "::ffff:198.51.100.88",
              authorization: "Bearer malformed-key",
            },
          })
        ).statusCode,
      ).toBe(401);
    }
    for (let i = 0; i < 30; i++) {
      expect(
        (
          await f.server.inject({
            method: "GET",
            url: `/api/status?projectId=${f.project.projectId}`,
            remoteAddress: "127.0.0.1",
            headers: {
              "x-forwarded-for": "198.51.100.88",
              authorization: "Bearer malformed-key",
            },
          })
        ).statusCode,
      ).toBe(401);
    }
    const mapped61 = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.88",
        authorization: `Bearer ${f.operatorKey}`,
      },
    });
    expect(mapped61.statusCode).toBe(429);
  });

  it("AUTH-14: refuses capacity beyond 1000 combined buckets without evicting active counts or calling verifier", async () => {
    const customAuthenticate = vi.fn(async () => ({
      ok: false as const,
      code: "AUTH_CREDENTIAL_REJECTED" as const,
      message: "Authentication denied",
    }));
    const f = await createBoundsServerFixture({ customAuthenticate });

    for (
      let i = 1;
      i <= DEFAULT_HOSTED_SECURITY_POLICY.rateLimitBucketCount;
      i++
    ) {
      const res = await f.server.inject({
        method: "GET",
        url: `/api/status?projectId=${f.project.projectId}`,
        remoteAddress: "127.0.0.1",
        headers: {
          "x-forwarded-for": `2001:db8:1::${i.toString(16)}`,
          authorization: "Bearer invalid-key",
        },
      });
      expect(res.statusCode).toBe(401);
    }

    const callsAtCapacity = customAuthenticate.mock.calls.length;
    const key1001 = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.250",
        authorization: `Bearer ${f.operatorKey}`,
      },
      payload: {
        projectId: f.project.projectId,
        featureId: "051-capacity",
        phaseId: "phase-05",
      },
    });
    expect(key1001.statusCode).toBe(429);
    expect(key1001.json()).toMatchObject({
      ok: false,
      code: "RATE_LIMIT_EXCEEDED",
      requestId: expect.any(String),
    });
    expect(customAuthenticate.mock.calls.length).toBe(callsAtCapacity);
    expect(f.dispatchCount()).toBe(0);

    // Existing active bucket 2001:db8:1::1 retained its count of 1 (59 more attempts allowed, 60th denied).
    for (let i = 0; i < 59; i++) {
      expect(
        (
          await f.server.inject({
            method: "GET",
            url: `/api/status?projectId=${f.project.projectId}`,
            remoteAddress: "127.0.0.1",
            headers: {
              "x-forwarded-for": "2001:db8:1::1",
              authorization: "Bearer invalid-key",
            },
          })
        ).statusCode,
      ).toBe(401);
    }
    expect(
      (
        await f.server.inject({
          method: "GET",
          url: `/api/status?projectId=${f.project.projectId}`,
          remoteAddress: "127.0.0.1",
          headers: {
            "x-forwarded-for": "2001:db8:1::1",
            authorization: "Bearer invalid-key",
          },
        })
      ).statusCode,
    ).toBe(429);
  });

  it.each([
    ["comma list", ["X-Forwarded-For: 198.51.100.88, 203.0.113.1"]],
    [
      "duplicate",
      ["X-Forwarded-For: 198.51.100.88", "X-Forwarded-For: 203.0.113.1"],
    ],
    ["malformed", ["X-Forwarded-For: not-an-ip"]],
  ])(
    "AUTH-14: denies trusted forwarding %s before authentication or effects",
    async (_label, forwardingHeaders) => {
      const authenticate = vi.fn(async () => ({
        ok: false as const,
        code: "AUTH_CREDENTIAL_INVALID" as const,
        message: "Denied",
      }));
      const f = await createBoundsServerFixture({
        customAuthenticate: authenticate,
      });
      const response = await sendRawLoopbackHttp(
        f.port,
        [
          `GET /api/status?projectId=${f.project.projectId} HTTP/1.1`,
          "Host: localhost",
          "Connection: close",
          ...forwardingHeaders,
          `Authorization: Bearer ${f.operatorKey}`,
          "",
          "",
        ].join("\r\n"),
      );
      expect(response).toMatch(/^HTTP\/1\.1 503 /);
      expect(authenticate).not.toHaveBeenCalled();
      expect(f.dispatchCount()).toBe(0);
    },
  );

  it("AUTH-14: shares injected owner capacity with HTTP admission before authentication", async () => {
    const owner = createRateAdmission({ clock: { nowMs: () => BASE_NOW } });
    try {
      for (let i = 1; i <= 1000; i++) {
        expect(
          owner.consumeLogin({ trustedIp: `2001:db8::${i.toString(16)}` })
            .allowed,
        ).toBe(true);
      }
      const authenticate = vi.fn(async () => ({
        ok: false as const,
        code: "AUTH_CREDENTIAL_INVALID" as const,
        message: "Denied",
      }));
      const f = await createBoundsServerFixture({
        rateAdmission: owner,
        customAuthenticate: authenticate,
      });
      const response = await f.server.inject({
        method: "GET",
        url: `/api/status?projectId=${f.project.projectId}`,
        remoteAddress: "127.0.0.1",
        headers: {
          "x-forwarded-for": "198.51.100.99",
          authorization: `Bearer ${f.operatorKey}`,
        },
      });
      expect(response.statusCode).toBe(429);
      expect(response.json().code).toBe("RATE_LIMIT_EXCEEDED");
      expect(authenticate).not.toHaveBeenCalled();
      expect(f.dispatchCount()).toBe(0);
    } finally {
      owner.close();
    }
  });

  it("AUTH-14: fails closed on closed rate admission store or clock failure without calling verifier or running work", async () => {
    let failClock = false;
    const failingClock: ClockPort = {
      nowMs: () => {
        if (failClock) throw new Error("CANARY_CLOCK_FAILURE_SECRET");
        return BASE_NOW;
      },
      nowIso: () => iso(BASE_NOW),
    };
    const authSpy = vi.fn(async () => ({
      ok: true as const,
      context: {
        principalType: "cli_token" as const,
        principalId: "cred-bounds-op",
        credentialId: "cred-bounds-op",
        expiresAt: iso(BASE_NOW + 3600_000),
        authMethod: "api_key" as const,
      },
    }));

    const clockFixture = await createBoundsServerFixture({
      clock: failingClock,
      customAuthenticate: authSpy,
    });
    failClock = true;
    const clockFailRes = await clockFixture.server.inject({
      method: "POST",
      url: "/api/dispatch",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.90",
        authorization: `Bearer ${clockFixture.operatorKey}`,
      },
      payload: {
        projectId: clockFixture.project.projectId,
        featureId: "051-clock-fail",
        phaseId: "phase-05",
      },
    });
    expect([429, 503]).toContain(clockFailRes.statusCode);
    expect(clockFailRes.json()).toMatchObject({
      ok: false,
      requestId: expect.any(String),
    });
    expect(clockFailRes.body).not.toContain("CANARY_CLOCK_FAILURE_SECRET");
    expect(authSpy).not.toHaveBeenCalled();
    expect(clockFixture.dispatchCount()).toBe(0);

    // Closed rate admission store fails closed on full server AND closes on server shutdown.
    const ownedAdmission = createRateAdmission({
      clock: { nowMs: () => BASE_NOW },
    });
    const closeSpy = vi.spyOn(ownedAdmission, "close");
    const closedAuthSpy = vi.fn(async () => ({
      ok: true as const,
      context: {
        principalType: "cli_token" as const,
        principalId: "cred-bounds-op",
        credentialId: "cred-bounds-op",
        expiresAt: iso(BASE_NOW + 3600_000),
        authMethod: "api_key" as const,
      },
    }));
    const closedFixture = await createBoundsServerFixture({
      rateAdmission: ownedAdmission,
      customAuthenticate: closedAuthSpy,
    });

    ownedAdmission.close();
    const closedRes = await closedFixture.server.inject({
      method: "POST",
      url: "/api/dispatch",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.91",
        authorization: `Bearer ${closedFixture.operatorKey}`,
      },
      payload: {
        projectId: closedFixture.project.projectId,
        featureId: "051-store-closed",
        phaseId: "phase-05",
      },
    });
    expect([429, 503]).toContain(closedRes.statusCode);
    expect(closedRes.json()).toMatchObject({
      ok: false,
      requestId: expect.any(String),
    });
    expect(closedAuthSpy).not.toHaveBeenCalled();
    expect(closedFixture.dispatchCount()).toBe(0);

    // Standalone registerHostedAuthBounds closes its owned store on server close.
    const { registerHostedAuthBounds } = await import("./auth-bounds.js");
    const app = fastify({ logger: false });
    const returned = registerHostedAuthBounds(app, {
      clock: { nowMs: () => BASE_NOW },
    });
    const appCloseSpy = vi.spyOn(returned, "close");
    await app.ready();
    await app.close();
    expect(appCloseSpy).toHaveBeenCalledTimes(1);
    const closesBeforeShutdown = closeSpy.mock.calls.length;
    await closedFixture.server.close();
    expect(closeSpy).toHaveBeenCalledTimes(closesBeforeShutdown + 1);
  });

  it("AUTH-14: enforces real loopback parser limits for >16384 header bytes (431) and >1048576 body bytes (413)", async () => {
    const f = await createBoundsServerFixture();

    // Baseline within bounds succeeds on the same loopback listener.
    const baseline = await sendLoopbackRequest({
      port: f.port,
      method: "GET",
      path: `/api/status?projectId=${f.project.projectId}`,
      headers: {
        authorization: `Bearer ${f.operatorKey}`,
      },
    });
    expect(baseline.statusCode).toBe(200);

    // Real Node HTTP parser enforces httpHeaderMaxBytes = 16384 -> HTTP 431.
    const oversizedHeader = "x".repeat(
      DEFAULT_HOSTED_SECURITY_POLICY.httpHeaderMaxBytes + 512,
    );
    const rawResponse = await sendRawLoopbackHttp(
      f.port,
      `GET /api/status?projectId=${f.project.projectId} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ${f.operatorKey}\r\nX-Oversized-Header: ${oversizedHeader}\r\nConnection: close\r\n\r\n`,
    );
    expect(rawResponse).toMatch(/^HTTP\/1\.1 431\b/);
    expect(rawResponse).not.toContain(f.operatorKey);
    expect(f.dispatchCount()).toBe(0);

    // Real Fastify body parser enforces httpBodyMaxBytes = 1048576 -> HTTP 413.
    const oversizedPadding = "p".repeat(
      DEFAULT_HOSTED_SECURITY_POLICY.httpBodyMaxBytes + 1024,
    );
    const oversizedBody = JSON.stringify({
      projectId: f.project.projectId,
      featureId: "051-body-limit",
      phaseId: "phase-05",
      padding: oversizedPadding,
    });
    const bodyLimitRes = await sendLoopbackRequest({
      port: f.port,
      method: "POST",
      path: "/api/dispatch",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(oversizedBody)),
        authorization: `Bearer ${f.operatorKey}`,
      },
      body: oversizedBody,
    });
    expect(bodyLimitRes.statusCode).toBe(413);
    expect(bodyLimitRes.body.length).toBeLessThan(4096);
    expect(bodyLimitRes.body).not.toContain(f.operatorKey);
    expect(f.dispatchCount()).toBe(0);
  });

  it("AUTH-14: returns HTTP 503 with zero accepted work and no credential echo on JWKS timeout or outage", async () => {
    const outageVerifier = createGoogleIdentityVerifier({
      clientId: "bounds-client",
      readAllowlist: async () => ["bounds-operator@example.test"],
      fetch: async () => {
        throw new Error(`CANARY_JWKS_OUTAGE ${signedGoogleJwt}`);
      },
    });
    const outageFixture = await createBoundsServerFixture({
      googleVerifier: outageVerifier,
    });

    const outageRes = await outageFixture.server.inject({
      method: "POST",
      url: "/api/dispatch",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.95",
        authorization: `Bearer ${signedGoogleJwt}`,
        "x-gwrk-auth-mode": "google_id_token",
      },
      payload: {
        projectId: outageFixture.project.projectId,
        featureId: "051-jwks-outage",
        phaseId: "phase-05",
      },
    });
    expect(outageRes.statusCode).toBe(503);
    expect(outageRes.json()).toMatchObject({
      ok: false,
      code: "AUTH_VERIFIER_UNAVAILABLE",
      requestId: expect.any(String),
    });
    expect(outageRes.body).not.toContain(signedGoogleJwt);
    expect(outageRes.body).not.toContain("CANARY_JWKS_OUTAGE");
    expect(outageFixture.dispatchCount()).toBe(0);

    const timeoutVerifier = createGoogleIdentityVerifier({
      clientId: "bounds-client",
      readAllowlist: async () => ["bounds-operator@example.test"],
      policy: {
        ...DEFAULT_HOSTED_SECURITY_POLICY,
        jwksRequestTimeoutSeconds: 1,
      },
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("CANARY_JWKS_TIMEOUT_ABORT"));
          });
        }),
    });
    const timeoutFixture = await createBoundsServerFixture({
      googleVerifier: timeoutVerifier,
    });

    const timeoutRes = await timeoutFixture.server.inject({
      method: "GET",
      url: `/api/status?projectId=${timeoutFixture.project.projectId}`,
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.96",
        authorization: `Bearer ${signedGoogleJwt}`,
        "x-gwrk-auth-mode": "google_id_token",
      },
    });
    expect(timeoutRes.statusCode).toBe(503);
    expect(timeoutRes.json()).toMatchObject({
      ok: false,
      code: "AUTH_VERIFIER_UNAVAILABLE",
      requestId: expect.any(String),
    });
    expect(timeoutRes.body).not.toContain(signedGoogleJwt);
    expect(timeoutRes.body).not.toContain("CANARY_JWKS_TIMEOUT_ABORT");
    expect(timeoutFixture.dispatchCount()).toBe(0);

    // Sanity check that our signedGoogleJwt + jwksPayload fixture is valid when JWKS is reachable.
    const healthyVerifier = createGoogleIdentityVerifier({
      clientId: "bounds-client",
      readAllowlist: async () => ["bounds-operator@example.test"],
      fetch: async () => Response.json(jwksPayload),
    });
    const healthyFixture = await createBoundsServerFixture({
      googleVerifier: healthyVerifier,
    });
    const okRes = await healthyFixture.server.inject({
      method: "GET",
      url: `/api/status?projectId=${healthyFixture.project.projectId}`,
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "198.51.100.97",
        authorization: `Bearer ${signedGoogleJwt}`,
        "x-gwrk-auth-mode": "google_id_token",
      },
    });
    expect(okRes.statusCode).toBe(200);
  });
});
