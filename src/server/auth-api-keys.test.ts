/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
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
import type { EnrolledProject } from "../domain/project-registry.js";
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
const NOW = Date.parse("2026-11-23T18:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const cleanup: (() => Promise<void>)[] = [];

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

async function createHostedApiKeyFixture() {
  vi.clearAllMocks();
  vi.spyOn(gwrkPaths, "usesHostedRuntime").mockReturnValue(false);
  vi.spyOn(HarvestWatcher.prototype, "start").mockImplementation(() => {});
  vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(true);

  const tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-hosted-api-keys-")),
  );
  const alphaDir = path.join(tmpDir, "alpha-repo");
  const betaDir = path.join(tmpDir, "beta-repo");
  const alphaProjectId = initFixtureRepo(
    alphaDir,
    "git@github.com:org/alpha-secret-app.git",
  );
  const betaProjectId = initFixtureRepo(
    betaDir,
    "git@github.com:org/beta-confidential-app.git",
  );

  const db = openDatabase({ dbPath: path.join(tmpDir, "gwrk.db") });
  const registry = createSqliteProjectRegistryAdapter({ db });
  const operationsStore = createSqliteOperationsStoreAdapter({ db });
  const authStore = createSqliteAuthStoreAdapter({ db });
  const crypto = createCredentialCryptoAdapter();

  const projectA: EnrolledProject = registry.enrollProject({
    projectId: alphaProjectId,
    slug: "alpha-pilot-slug",
    name: "Alpha Pilot Project",
    repoSlug: "org/alpha-secret-app",
    trunkBranch: "main",
    localRoot: alphaDir,
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["local", "hosted"] },
    slack: {
      workspaceId: "W_ALPHA",
      channelId: "C_ALPHA",
      sharedChannel: false,
    },
    legacyProjectIds: [],
    createdAt: iso(NOW - 10_000),
    updatedAt: iso(NOW - 10_000),
  });

  const projectB: EnrolledProject = registry.enrollProject({
    projectId: betaProjectId,
    slug: "beta-isolated-slug",
    name: "Beta Confidential Project",
    repoSlug: "org/beta-confidential-app",
    trunkBranch: "main",
    localRoot: betaDir,
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["local", "hosted"] },
    slack: {
      workspaceId: "W_BETA",
      channelId: "C_BETA",
      sharedChannel: false,
    },
    legacyProjectIds: [],
    createdAt: iso(NOW - 10_000),
    updatedAt: iso(NOW - 10_000),
  });

  const issueKey = (input: {
    credentialId: string;
    label: string;
    role: "viewer" | "operator" | "maintainer";
    projectId?: string;
    audienceOrigin?: string;
    expiresAt?: string;
  }) => {
    const generated = crypto.generateApiCredential(input.credentialId);
    authStore.createCredentialWithGrants({
      credentialId: input.credentialId,
      verifierSha256: generated.verifierSha256,
      label: input.label,
      issuer: "local-admin",
      audienceOrigin: input.audienceOrigin ?? ORIGIN,
      createdAt: iso(NOW - 1000),
      expiresAt: input.expiresAt ?? iso(NOW + 3600_000),
      grants: [
        { projectId: input.projectId ?? projectA.projectId, role: input.role },
      ],
    });
    return generated.rawCredential;
  };

  const viewerAKey = issueKey({
    credentialId: "cred-alpha-viewer",
    label: "alpha-viewer",
    role: "viewer",
  });
  const operatorAKey = issueKey({
    credentialId: "cred-alpha-operator",
    label: "alpha-operator",
    role: "operator",
  });
  const wrongOriginKey = issueKey({
    credentialId: "cred-wrong-origin",
    label: "wrong-origin",
    role: "operator",
    audienceOrigin: "https://other.example.test",
  });
  const expiredKey = issueKey({
    credentialId: "cred-expired",
    label: "expired",
    role: "operator",
    expiresAt: iso(NOW - 1000),
  });
  const revokedKey = issueKey({
    credentialId: "cred-revoked",
    label: "revoked",
    role: "operator",
  });
  authStore.revokeApiCredential({
    credentialId: "cred-revoked",
    revokedAt: iso(NOW - 500),
    reason: "test-revocation",
  });

  const clock = { nowMs: () => NOW, nowIso: () => iso(NOW) };
  const google: GoogleIdentityVerifierPort = {
    verifyIdToken: vi.fn(async () => ({
      ok: false as const,
      code: "AUTH_TOKEN_INVALID" as const,
      message: "Denied",
    })),
  };
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
    hmacKey: Buffer.alloc(32, 11),
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

  const getDeliveryStatus = vi.fn().mockResolvedValue({
    mode: "socket_connected" as const,
    workspaceId: "W_ALPHA",
    connected: true,
  });
  const fakeNotifier: NotificationPort = {
    notify: vi.fn().mockResolvedValue({
      ok: true,
      deliveryId: "fake-delivery",
    }),
    getDeliveryStatus,
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

  const getOperationsStatusSpy = vi.spyOn(
    operationsStore,
    "getOperationsStatus",
  );

  const config = GwrkConfigSchema.parse({
    project: { name: "hosted-pilot-fixture" },
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
    ledger: { db, projectId: projectA.projectId },
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

  const dispatchCount = (projectId?: string): number => {
    const row = projectId
      ? (db
          .prepare(
            "SELECT COUNT(*) AS count FROM dispatch_operations WHERE project_id = ?",
          )
          .get(projectId) as { count: number })
      : (db
          .prepare("SELECT COUNT(*) AS count FROM dispatch_operations")
          .get() as { count: number });
    return row.count;
  };

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
    crypto,
    projectA,
    projectB,
    viewerAKey,
    operatorAKey,
    wrongOriginKey,
    expiredKey,
    revokedKey,
    checkGit,
    getDeliveryStatus,
    getOperationsStatusSpy,
    fakeWorker,
    dispatchCount,
    googleSessionCount,
  };
}

function assertNoProjectMetadata(body: string, project: EnrolledProject): void {
  expect(body).not.toContain(project.projectId);
  expect(body).not.toContain(project.slug);
  expect(body).not.toContain(project.name);
  if (project.repoSlug) expect(body).not.toContain(project.repoSlug);
  if (project.localRoot) expect(body).not.toContain(project.localRoot);
  if (project.mirrorPath) expect(body).not.toContain(project.mirrorPath);
}

describe("FR-004 FR-007 AUTH-07: opaque API credential HTTP 401 denials on hosted startServer", () => {
  it("US-003: returns HTTP 401 JSON without redirect across all protected API routes when credentials are missing", async () => {
    const f = await createHostedApiKeyFixture();
    const probes = [
      {
        method: "GET" as const,
        url: `/api/status?projectId=${f.projectA.projectId}`,
      },
      {
        method: "POST" as const,
        url: "/api/dispatch",
        payload: {
          projectId: f.projectA.projectId,
          featureId: "051-pilot",
          phaseId: "phase-04",
        },
      },
      {
        method: "GET" as const,
        url: `/api/dispatch/queue?projectId=${f.projectA.projectId}`,
      },
      {
        method: "GET" as const,
        url: `/api/dispatch/051-pilot/phase-04?projectId=${f.projectA.projectId}`,
      },
      {
        method: "POST" as const,
        url: "/api/notify",
        payload: {
          projectId: f.projectA.projectId,
          type: "phase_start",
          feature: "051-pilot",
          phase: "phase-04",
        },
      },
      {
        method: "GET" as const,
        url: `/api/health?projectId=${f.projectA.projectId}`,
      },
    ];

    for (const probe of probes) {
      const response = await f.server.inject(probe);
      expect(response.statusCode).toBe(401);
      expect(response.headers.location).toBeUndefined();
      expect(response.json()).toMatchObject({
        ok: false,
        code: "AUTH_REQUIRED",
        requestId: expect.any(String),
      });
      assertNoProjectMetadata(response.body, f.projectA);
      assertNoProjectMetadata(response.body, f.projectB);
    }

    expect(f.dispatchCount()).toBe(0);
    expect(slackNotify.notifySlack).not.toHaveBeenCalled();
  });

  it.each([
    { label: "non-Bearer scheme", authorization: "Basic Zm9vOmJhcg==" },
    { label: "malformed bearer", authorization: "Bearer malformed-key" },
    {
      label: "wrong version",
      authorization: `Bearer gwrk_v2.cred-alpha-operator.${"a".repeat(43)}`,
    },
    {
      label: "oversized credential",
      authorization: `Bearer gwrk_v1.${"a".repeat(64)}.${"b".repeat(220)}`,
    },
    {
      label: "wrong secret hash",
      authorization: `Bearer gwrk_v1.cred-alpha-operator.${"z".repeat(43)}`,
    },
  ])(
    "US-003: rejects $label with HTTP 401 JSON, zero effects, and no credential echo",
    async ({ authorization }) => {
      const f = await createHostedApiKeyFixture();
      const response = await f.server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { authorization },
        payload: {
          projectId: f.projectA.projectId,
          featureId: "051-pilot",
          phaseId: "phase-04",
        },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        ok: false,
        requestId: expect.any(String),
      });
      expect(["AUTH_CREDENTIAL_INVALID", "AUTH_CREDENTIAL_REJECTED"]).toContain(
        response.json().code,
      );
      expect(response.body).not.toContain(authorization.slice(7));
      expect(f.dispatchCount()).toBe(0);
    },
  );

  it.each(["wrongOriginKey", "expiredKey", "revokedKey"] as const)(
    "US-003: rejects %s with HTTP 401 AUTH_CREDENTIAL_REJECTED and zero effects",
    async (keyKind) => {
      const f = await createHostedApiKeyFixture();
      const rawKey = f[keyKind];
      const dispatchRes = await f.server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { authorization: `Bearer ${rawKey}` },
        payload: {
          projectId: f.projectA.projectId,
          featureId: "051-pilot",
          phaseId: "phase-04",
        },
      });
      expect(dispatchRes.statusCode).toBe(401);
      expect(dispatchRes.json()).toMatchObject({
        ok: false,
        code: "AUTH_CREDENTIAL_REJECTED",
        requestId: expect.any(String),
      });
      expect(dispatchRes.body).not.toContain(rawKey);

      const statusRes = await f.server.inject({
        method: "GET",
        url: `/api/status?projectId=${f.projectA.projectId}`,
        headers: { authorization: `Bearer ${rawKey}` },
      });
      expect(statusRes.statusCode).toBe(401);
      expect(statusRes.json().code).toBe("AUTH_CREDENTIAL_REJECTED");
      expect(f.dispatchCount()).toBe(0);
    },
  );

  it("US-003: denies rotated-out credential while newly rotated credential inherits copied grants", async () => {
    const f = await createHostedApiKeyFixture();
    const rotated = f.crypto.generateApiCredential("cred-alpha-operator-v2");
    f.authStore.rotateCredential({
      targetCredentialId: "cred-alpha-operator",
      newCredentialId: "cred-alpha-operator-v2",
      newVerifierSha256: rotated.verifierSha256,
      issuer: "local-admin",
      audienceOrigin: ORIGIN,
      createdAt: iso(NOW),
      expiresAt: iso(NOW + 7200_000),
      reason: "scheduled-rotation",
    });

    const oldRes = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: { authorization: `Bearer ${f.operatorAKey}` },
      payload: {
        projectId: f.projectA.projectId,
        featureId: "051-pilot",
        phaseId: "phase-04",
      },
    });
    expect(oldRes.statusCode).toBe(401);
    expect(oldRes.json().code).toBe("AUTH_CREDENTIAL_REJECTED");
    expect(f.dispatchCount()).toBe(0);

    const newRes = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: { authorization: `Bearer ${rotated.rawCredential}` },
      payload: {
        projectId: f.projectA.projectId,
        featureId: "051-pilot",
        phaseId: "phase-04",
      },
    });
    expect(newRes.statusCode).toBe(201);
    expect(newRes.json().operationId).toBeTruthy();
    expect(f.dispatchCount(f.projectA.projectId)).toBe(1);
  });

  it("US-003: denies conflicting API credentials with browser session cookie without fallback", async () => {
    const f = await createHostedApiKeyFixture();
    for (const bearer of [
      f.operatorAKey,
      `gwrk_v1.cred-alpha-operator.${"x".repeat(43)}`,
    ]) {
      const response = await f.server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: {
          authorization: `Bearer ${bearer}`,
          cookie: "__Host-gwrk_session=synthetic-browser-cookie",
          "x-gwrk-auth-mode": "api_key",
        },
        payload: {
          projectId: f.projectA.projectId,
          featureId: "051-pilot",
          phaseId: "phase-04",
        },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        ok: false,
        code: "AUTH_CONFLICTING_CREDENTIALS",
        requestId: expect.any(String),
      });
    }
    expect(f.dispatchCount()).toBe(0);
    expect(f.googleSessionCount()).toBe(0);
  });

  it("US-003: rejects API credentials on browser-only session routes and rejects Google parser hint for API keys", async () => {
    const f = await createHostedApiKeyFixture();
    const sessionRes = await f.server.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { authorization: `Bearer ${f.operatorAKey}` },
    });
    expect(sessionRes.statusCode).toBe(401);

    const logoutRes = await f.server.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { authorization: `Bearer ${f.operatorAKey}` },
    });
    expect(logoutRes.statusCode).toBe(401);

    const wrongHintRes = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: {
        authorization: `Bearer ${f.operatorAKey}`,
        "x-gwrk-auth-mode": "google_id_token",
      },
      payload: {
        projectId: f.projectA.projectId,
        featureId: "051-pilot",
        phaseId: "phase-04",
      },
    });
    expect(wrongHintRes.statusCode).toBe(401);
    expect(f.dispatchCount()).toBe(0);
  });

  it("US-003: permits unrelated cookies alongside a valid API credential", async () => {
    const f = await createHostedApiKeyFixture();
    const response = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.projectA.projectId}`,
      headers: {
        authorization: `Bearer ${f.viewerAKey}`,
        cookie: "theme=dark; locale=en",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().projectId).toBe(f.projectA.projectId);
  });
});

describe("FR-004 FR-007 FR-010 AUTH-08: project-scoped API authorization and filtered health on hosted startServer", () => {
  it("US-003: Project A viewer reads Project A status, queue, and filtered health but gets HTTP 403 on mutations", async () => {
    const f = await createHostedApiKeyFixture();

    const statusRes = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.projectA.projectId}`,
      headers: { authorization: `Bearer ${f.viewerAKey}` },
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().projectId).toBe(f.projectA.projectId);
    assertNoProjectMetadata(statusRes.body, f.projectB);

    const queueRes = await f.server.inject({
      method: "GET",
      url: `/api/dispatch/queue?projectId=${f.projectA.projectId}`,
      headers: { authorization: `Bearer ${f.viewerAKey}` },
    });
    expect(queueRes.statusCode).toBe(200);
    expect(queueRes.json()).toMatchObject({
      active: [],
      queued: [],
      paused: false,
    });

    const healthRes = await f.server.inject({
      method: "GET",
      url: `/api/health?projectId=${f.projectA.projectId}`,
      headers: { authorization: `Bearer ${f.viewerAKey}` },
    });
    expect(healthRes.statusCode).toBe(200);
    const health = healthRes.json();
    expect(health.daemonLiveness).toBe("alive");
    expect(health.telegram).toEqual({
      enabled: false,
      reason: "disabled_in_pilot",
    });
    expect(health.projectReadiness).toMatchObject({
      totalCount: 1,
      readyCount: 1,
      status: "ready",
    });
    expect(health.projectReadiness.projects).toHaveLength(1);
    expect(health.projectReadiness.projects[0]).toMatchObject({
      projectId: f.projectA.projectId,
      slug: f.projectA.slug,
    });
    assertNoProjectMetadata(healthRes.body, f.projectB);

    const dispatchRes = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: { authorization: `Bearer ${f.viewerAKey}` },
      payload: {
        projectId: f.projectA.projectId,
        featureId: "051-pilot",
        phaseId: "phase-04",
      },
    });
    expect(dispatchRes.statusCode).toBe(403);
    expect(dispatchRes.json()).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_ROLE",
    });

    const notifyRes = await f.server.inject({
      method: "POST",
      url: "/api/notify",
      headers: { authorization: `Bearer ${f.viewerAKey}` },
      payload: {
        projectId: f.projectA.projectId,
        type: "phase_start",
        feature: "051-pilot",
        phase: "phase-04",
      },
    });
    expect(notifyRes.statusCode).toBe(403);
    expect(notifyRes.json()).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_ROLE",
    });

    expect(f.dispatchCount()).toBe(0);
    expect(slackNotify.notifySlack).not.toHaveBeenCalled();
  });

  it("US-003: Project A operator operates on Project A but receives HTTP 403 for Project B across all APIs", async () => {
    const f = await createHostedApiKeyFixture();

    const dispatchA = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: { authorization: `Bearer ${f.operatorAKey}` },
      payload: {
        projectId: f.projectA.projectId,
        featureId: "051-pilot",
        phaseId: "phase-04",
      },
    });
    expect(dispatchA.statusCode).toBe(201);
    const receipt = dispatchA.json();
    expect(receipt.operationId).toBeTruthy();
    expect(f.dispatchCount(f.projectA.projectId)).toBe(1);

    const phaseA = await f.server.inject({
      method: "GET",
      url: `/api/dispatch/051-pilot/phase-04?projectId=${f.projectA.projectId}`,
      headers: { authorization: `Bearer ${f.operatorAKey}` },
    });
    expect(phaseA.statusCode).toBe(200);
    expect(phaseA.json().operationId).toBe(receipt.operationId);

    const notifyA = await f.server.inject({
      method: "POST",
      url: "/api/notify",
      headers: { authorization: `Bearer ${f.operatorAKey}` },
      payload: {
        projectId: f.projectA.projectId,
        type: "phase_start",
        feature: "051-pilot",
        phase: "phase-04",
      },
    });
    expect(notifyA.statusCode).toBe(200);
    expect(notifyA.json()).toEqual({ ok: true });
    expect(slackNotify.notifySlack).toHaveBeenCalledTimes(1);

    f.getOperationsStatusSpy.mockClear();

    const statusB = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.projectB.projectId}`,
      headers: { authorization: `Bearer ${f.operatorAKey}` },
    });
    expect(statusB.statusCode).toBe(403);
    expect(statusB.json()).toMatchObject({
      ok: false,
      code: "UNAUTHORIZED_USER",
    });
    assertNoProjectMetadata(statusB.body, f.projectB);

    const queueB = await f.server.inject({
      method: "GET",
      url: `/api/dispatch/queue?projectId=${f.projectB.projectId}`,
      headers: { authorization: `Bearer ${f.operatorAKey}` },
    });
    expect(queueB.statusCode).toBe(403);
    expect(queueB.json().code).toBe("UNAUTHORIZED_USER");

    const phaseB = await f.server.inject({
      method: "GET",
      url: `/api/dispatch/051-pilot/phase-04?projectId=${f.projectB.projectId}`,
      headers: { authorization: `Bearer ${f.operatorAKey}` },
    });
    expect(phaseB.statusCode).toBe(403);
    expect(phaseB.json().code).toBe("UNAUTHORIZED_USER");

    const dispatchB = await f.server.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: {
        authorization: `Bearer ${f.operatorAKey}`,
        "x-gwrk-role": "maintainer",
        "x-forwarded-user": "admin",
      },
      payload: {
        projectId: f.projectB.projectId,
        featureId: "051-pilot",
        phaseId: "phase-04",
      },
    });
    expect(dispatchB.statusCode).toBe(403);
    expect(dispatchB.json().code).toBe("UNAUTHORIZED_USER");
    expect(f.dispatchCount(f.projectB.projectId)).toBe(0);

    const notifyB = await f.server.inject({
      method: "POST",
      url: "/api/notify",
      headers: { authorization: `Bearer ${f.operatorAKey}` },
      payload: {
        projectId: f.projectB.projectId,
        type: "phase_start",
        feature: "051-pilot",
        phase: "phase-04",
      },
    });
    expect(notifyB.statusCode).toBe(403);
    expect(notifyB.json().code).toBe("UNAUTHORIZED_USER");
    expect(slackNotify.notifySlack).toHaveBeenCalledTimes(1);

    const healthB = await f.server.inject({
      method: "GET",
      url: `/api/health?projectId=${f.projectB.projectId}`,
      headers: { authorization: `Bearer ${f.operatorAKey}` },
    });
    expect(healthB.statusCode).toBe(403);
    expect(["UNAUTHORIZED_USER", "PROJECT_ACCESS_DENIED"]).toContain(
      healthB.json().code,
    );
    assertNoProjectMetadata(healthB.body, f.projectB);
    expect(f.getOperationsStatusSpy).not.toHaveBeenCalledWith(
      f.projectB.projectId,
    );
  });

  it("US-006: hosted GET /api/health requires an explicit project without leaking other project slugs", async () => {
    const f = await createHostedApiKeyFixture();

    const missingProject = await f.server.inject({
      method: "GET",
      url: "/api/health",
      headers: { authorization: `Bearer ${f.operatorAKey}` },
    });
    expect([400, 403]).toContain(missingProject.statusCode);
    expect(missingProject.json().ok).toBe(false);
    assertNoProjectMetadata(missingProject.body, f.projectA);
    assertNoProjectMetadata(missingProject.body, f.projectB);

    const unknownProject = await f.server.inject({
      method: "GET",
      url: "/api/health?projectId=unknown-project",
      headers: { authorization: `Bearer ${f.operatorAKey}` },
    });
    expect([403, 404]).toContain(unknownProject.statusCode);
    expect(unknownProject.json().ok).toBe(false);
    assertNoProjectMetadata(unknownProject.body, f.projectA);
    assertNoProjectMetadata(unknownProject.body, f.projectB);
  });

  it("US-006: hosted GET /health returns minimal private liveness with zero Git or provider probes", async () => {
    const f = await createHostedApiKeyFixture();
    f.checkGit.mockClear();
    f.getDeliveryStatus.mockClear();
    f.getOperationsStatusSpy.mockClear();

    const getRes = await f.server.inject({
      method: "GET",
      url: "/health",
      headers: {
        authorization: `Bearer ${f.operatorAKey}`,
        "x-forwarded-user": "forged",
      },
    });
    expect(getRes.statusCode).toBe(200);
    const payload = getRes.json();
    expect(payload.status).toBe("ok");
    expect(payload.daemonLiveness).toBe("alive");
    expect(payload.projectReadiness).toBeUndefined();
    expect(payload.slackDelivery).toBeUndefined();
    expect(payload.outbox).toBeUndefined();
    expect(payload.harvest).toBeUndefined();
    assertNoProjectMetadata(getRes.body, f.projectA);
    assertNoProjectMetadata(getRes.body, f.projectB);

    const headRes = await f.server.inject({
      method: "HEAD",
      url: "/health",
    });
    expect(headRes.statusCode).toBe(200);
    expect(headRes.body).toBe("");

    expect(f.checkGit).not.toHaveBeenCalled();
    expect(f.getDeliveryStatus).not.toHaveBeenCalled();
    expect(f.getOperationsStatusSpy).not.toHaveBeenCalled();
  });

  it("US-006: HEAD follows authenticated project read policy on status and health routes", async () => {
    const f = await createHostedApiKeyFixture();

    expect(
      (
        await f.server.inject({
          method: "HEAD",
          url: `/api/status?projectId=${f.projectA.projectId}`,
        })
      ).statusCode,
    ).toBe(401);

    expect(
      (
        await f.server.inject({
          method: "HEAD",
          url: `/api/health?projectId=${f.projectA.projectId}`,
        })
      ).statusCode,
    ).toBe(401);

    expect(
      (
        await f.server.inject({
          method: "HEAD",
          url: `/api/status?projectId=${f.projectA.projectId}`,
          headers: { authorization: `Bearer ${f.viewerAKey}` },
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (
        await f.server.inject({
          method: "HEAD",
          url: `/api/health?projectId=${f.projectA.projectId}`,
          headers: { authorization: `Bearer ${f.viewerAKey}` },
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (
        await f.server.inject({
          method: "HEAD",
          url: `/api/health?projectId=${f.projectB.projectId}`,
          headers: { authorization: `Bearer ${f.viewerAKey}` },
        })
      ).statusCode,
    ).toBe(403);
  });
});
