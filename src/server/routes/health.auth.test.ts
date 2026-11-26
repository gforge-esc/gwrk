/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserCsrfAdapter } from "../../adapters/auth/browser-csrf.js";
import { createCredentialCryptoAdapter } from "../../adapters/auth/credential-crypto.js";
import * as gwrkPaths from "../../adapters/config/paths.js";
import { repositoryGitEnv } from "../../adapters/git/process-env.js";
import {
  createSqliteAuthStoreAdapter,
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../../adapters/sqlite/index.js";
import { createRequestAuthenticator } from "../../application/auth/authenticate-request.js";
import { createBrowserSessionService } from "../../application/auth/browser-session.js";
import { openDatabase } from "../../db/index.js";
import { computeProjectId } from "../../domain/project-id.js";
import type { EnrolledProject } from "../../domain/project-registry.js";
import type {
  GoogleIdentityVerifierPort,
  ProxySessionLogoutPort,
} from "../../ports/auth-port.js";
import type { NotificationPort } from "../../ports/notification-port.js";
import type {
  GitHubHarvestPort,
  WorkerExecutionPort,
} from "../../ports/operations-port.js";
import { GwrkConfigSchema } from "../../utils/config.js";
import { HarvestWatcher } from "../harvest-watcher.js";
import { startServer } from "../index.js";
import { SystemMonitor } from "../monitor.js";
import type { SandboxManager } from "../sandbox.js";

vi.mock("../slack.js", () => ({
  getSlackApp: vi.fn().mockReturnValue(null),
  isSlackConnected: vi.fn().mockResolvedValue(false),
  startSlackApp: vi.fn().mockResolvedValue(undefined),
  stopSlackApp: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../slack-notify.js", () => ({
  notifySlack: vi.fn().mockResolvedValue(undefined),
}));

const ORIGIN = "https://gwrk.gforge.ai";
const NOW = Date.parse("2026-11-23T19:15:00.000Z");
const GOOGLE_TOKEN_A = "CANARY_HEALTH_GOOGLE_TOKEN_PROJECT_A";
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

function assertNoProjectMetadata(body: string, project: EnrolledProject): void {
  expect(body).not.toContain(project.projectId);
  expect(body).not.toContain(project.slug);
  expect(body).not.toContain(project.name);
  if (project.repoSlug) expect(body).not.toContain(project.repoSlug);
  if (project.localRoot) expect(body).not.toContain(project.localRoot);
  if (project.mirrorPath) expect(body).not.toContain(project.mirrorPath);
  if (project.slack?.workspaceId)
    expect(body).not.toContain(project.slack.workspaceId);
  if (project.slack?.channelId)
    expect(body).not.toContain(project.slack.channelId);
}

async function createHealthAuthFixture(
  options: { transport?: "hosted" | "trusted_local" } = {},
) {
  const transport = options.transport ?? "hosted";
  vi.clearAllMocks();
  vi.spyOn(gwrkPaths, "usesHostedRuntime").mockReturnValue(false);
  vi.spyOn(HarvestWatcher.prototype, "start").mockImplementation(() => {});
  vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(true);

  const tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-health-auth-")),
  );
  const alphaDir = path.join(tmpDir, "alpha-health-repo");
  const betaDir = path.join(tmpDir, "beta-health-repo");
  const alphaId = initFixtureRepo(
    alphaDir,
    "git@github.com:org/alpha-health-app.git",
  );
  const betaId = initFixtureRepo(
    betaDir,
    "git@github.com:org/beta-secret-app.git",
  );

  const db = openDatabase({ dbPath: path.join(tmpDir, "gwrk.db") });
  const registry = createSqliteProjectRegistryAdapter({ db });
  const operationsStore = createSqliteOperationsStoreAdapter({ db });
  const authStore = createSqliteAuthStoreAdapter({ db });
  const crypto = createCredentialCryptoAdapter();

  const projectA: EnrolledProject = registry.enrollProject({
    projectId: alphaId,
    slug: "alpha-health-slug",
    name: "Alpha Health Project",
    repoSlug: "org/alpha-health-app",
    trunkBranch: "main",
    localRoot: alphaDir,
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["local", "hosted"] },
    slack: {
      workspaceId: "W_ALPHA_H",
      channelId: "C_ALPHA_H",
      sharedChannel: false,
    },
    legacyProjectIds: [],
    createdAt: iso(NOW - 10_000),
    updatedAt: iso(NOW - 10_000),
  });

  const projectB: EnrolledProject = registry.enrollProject({
    projectId: betaId,
    slug: "beta-secret-slug",
    name: "Beta Secret Project",
    repoSlug: "org/beta-secret-app",
    trunkBranch: "main",
    localRoot: betaDir,
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["local", "hosted"] },
    slack: {
      workspaceId: "W_BETA_H",
      channelId: "C_BETA_H",
      sharedChannel: false,
    },
    legacyProjectIds: [],
    createdAt: iso(NOW - 10_000),
    updatedAt: iso(NOW - 10_000),
  });

  const projectAKey = crypto.generateApiCredential("cred-health-alpha");
  authStore.createCredentialWithGrants({
    credentialId: "cred-health-alpha",
    verifierSha256: projectAKey.verifierSha256,
    label: "alpha-health-reader",
    issuer: "local-admin",
    audienceOrigin: ORIGIN,
    createdAt: iso(NOW - 1000),
    expiresAt: iso(NOW + 3600_000),
    grants: [{ projectId: projectA.projectId, role: "viewer" }],
  });

  registry.setRoleBinding({
    projectId: projectA.projectId,
    principalType: "google_sub",
    principalId: "https://accounts.google.com:health-viewer-a",
    role: "viewer",
  });

  const clock = { nowMs: () => NOW, nowIso: () => iso(NOW) };
  const google: GoogleIdentityVerifierPort = {
    verifyIdToken: vi.fn(async ({ token }) => {
      if (token !== GOOGLE_TOKEN_A) {
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
          subject: "health-viewer-a",
          principalId: "https://accounts.google.com:health-viewer-a",
          email: "health-viewer-a@example.test",
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
    hmacKey: Buffer.alloc(32, 31),
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
    workspaceId: "W_ALPHA_H",
    connected: true,
  });
  const fakeNotifier: NotificationPort = {
    notify: vi
      .fn()
      .mockResolvedValue({ ok: true, deliveryId: "health-notify" }),
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

  const listTerminalPullRequests = vi.fn(async () => []);
  const getPullRequest = vi.fn(async () => null);
  const fakeGithub: GitHubHarvestPort = {
    verifyWebhookSignature: vi.fn(() => false),
    listTerminalPullRequests,
    getPullRequest,
  };

  const getOperationsStatusSpy = vi.spyOn(
    operationsStore,
    "getOperationsStatus",
  );

  const config = GwrkConfigSchema.parse({
    project: { name: "health-auth-fixture" },
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
    ...(transport === "hosted"
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
  });

  return {
    server,
    projectA,
    projectB,
    projectAKey: projectAKey.rawCredential,
    checkGit,
    getDeliveryStatus,
    getOperationsStatusSpy,
    listTerminalPullRequests,
    getPullRequest,
  };
}

describe("FR-010 US-006 TR-012 AUTH-12: hosted scoped /api/health and minimal private /health", () => {
  it("AUTH-12: denies Project A credentials reading Project B readiness by ID or slug without leaking Project B metadata", async () => {
    const f = await createHealthAuthFixture();
    f.checkGit.mockClear();
    f.getDeliveryStatus.mockClear();
    f.getOperationsStatusSpy.mockClear();

    const probes = [
      {
        label: "API key by projectId",
        url: `/api/health?projectId=${f.projectB.projectId}`,
        headers: { authorization: `Bearer ${f.projectAKey}` },
      },
      {
        label: "API key by slug",
        url: `/api/health?project=${f.projectB.slug}`,
        headers: { authorization: `Bearer ${f.projectAKey}` },
      },
      {
        label: "Google session by projectId",
        url: `/api/health?projectId=${f.projectB.projectId}`,
        headers: {
          authorization: `Bearer ${GOOGLE_TOKEN_A}`,
          "x-gwrk-auth-mode": "google_id_token",
        },
      },
    ];

    for (const probe of probes) {
      const res = await f.server.inject({
        method: "GET",
        url: probe.url,
        headers: probe.headers,
      });
      expect(res.statusCode, probe.label).toBe(403);
      expect(res.json(), probe.label).toMatchObject({
        ok: false,
        code: "UNAUTHORIZED_USER",
        requestId: expect.any(String),
      });
      assertNoProjectMetadata(res.body, f.projectB);
      assertNoProjectMetadata(res.body, f.projectA);
    }

    expect(f.checkGit).not.toHaveBeenCalled();
    expect(f.getDeliveryStatus).not.toHaveBeenCalled();
    expect(f.getOperationsStatusSpy).not.toHaveBeenCalled();
  });

  it("AUTH-12: filters authorized GET /api/health strictly to the single requested project for both API key and Google session", async () => {
    const f = await createHealthAuthFixture();

    const authHeadersList = [
      { authorization: `Bearer ${f.projectAKey}` },
      {
        authorization: `Bearer ${GOOGLE_TOKEN_A}`,
        "x-gwrk-auth-mode": "google_id_token",
      },
    ];

    for (const headers of authHeadersList) {
      f.getOperationsStatusSpy.mockClear();
      const res = await f.server.inject({
        method: "GET",
        url: `/api/health?projectId=${f.projectA.projectId}`,
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.daemonLiveness).toBe("alive");
      expect(body.telegram).toEqual({
        enabled: false,
        reason: "disabled_in_pilot",
      });
      expect(body.projectReadiness).toMatchObject({
        totalCount: 1,
        readyCount: 1,
        status: "ready",
      });
      expect(body.projectReadiness.projects).toHaveLength(1);
      expect(body.projectReadiness.projects[0]).toMatchObject({
        projectId: f.projectA.projectId,
        slug: f.projectA.slug,
      });
      assertNoProjectMetadata(res.body, f.projectB);
      expect(f.getOperationsStatusSpy).toHaveBeenCalledTimes(1);
      expect(f.getOperationsStatusSpy).toHaveBeenCalledWith(
        f.projectA.projectId,
      );
    }
  });

  it("AUTH-12 FR-010: denies missing project, unknown project, and unauthenticated /api/health with JSON and requestId", async () => {
    const f = await createHealthAuthFixture();
    f.checkGit.mockClear();
    f.getDeliveryStatus.mockClear();
    f.getOperationsStatusSpy.mockClear();

    const unauthGet = await f.server.inject({
      method: "GET",
      url: `/api/health?projectId=${f.projectA.projectId}`,
    });
    expect(unauthGet.statusCode).toBe(401);
    expect(unauthGet.headers.location).toBeUndefined();
    expect(unauthGet.json()).toMatchObject({
      ok: false,
      code: "AUTH_REQUIRED",
      requestId: expect.any(String),
    });

    const unauthHead = await f.server.inject({
      method: "HEAD",
      url: `/api/health?projectId=${f.projectA.projectId}`,
    });
    expect(unauthHead.statusCode).toBe(401);
    expect(unauthHead.headers.location).toBeUndefined();

    const missingProject = await f.server.inject({
      method: "GET",
      url: "/api/health",
      headers: { authorization: `Bearer ${f.projectAKey}` },
    });
    expect(missingProject.statusCode).toBe(400);
    expect(missingProject.json()).toMatchObject({
      ok: false,
      requestId: expect.any(String),
    });
    assertNoProjectMetadata(missingProject.body, f.projectA);
    assertNoProjectMetadata(missingProject.body, f.projectB);

    const unknownProject = await f.server.inject({
      method: "GET",
      url: "/api/health?projectId=proj-nonexistent-999",
      headers: { authorization: `Bearer ${f.projectAKey}` },
    });
    expect(unknownProject.statusCode).toBe(404);
    expect(unknownProject.json()).toMatchObject({
      ok: false,
      code: "UNKNOWN_PROJECT",
      requestId: expect.any(String),
    });
    assertNoProjectMetadata(unknownProject.body, f.projectA);
    assertNoProjectMetadata(unknownProject.body, f.projectB);

    expect(f.checkGit).not.toHaveBeenCalled();
    expect(f.getDeliveryStatus).not.toHaveBeenCalled();
    expect(f.getOperationsStatusSpy).not.toHaveBeenCalled();
  });

  it("AUTH-12 FR-010: hosted GET and HEAD /health return minimal private liveness with zero Git or provider probes", async () => {
    const f = await createHealthAuthFixture();
    f.checkGit.mockClear();
    f.getDeliveryStatus.mockClear();
    f.getOperationsStatusSpy.mockClear();
    f.listTerminalPullRequests.mockClear();
    f.getPullRequest.mockClear();

    const getRes = await f.server.inject({
      method: "GET",
      url: "/health",
      headers: {
        "x-forwarded-user": "forged-admin",
        authorization: `Bearer ${f.projectAKey}`,
      },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual({
      status: "ok",
      daemonLiveness: "alive",
    });
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
    expect(f.listTerminalPullRequests).not.toHaveBeenCalled();
    expect(f.getPullRequest).not.toHaveBeenCalled();
  });

  it("FR-010: HEAD /api/health follows authenticated read policy and trusted_local preserves full local health", async () => {
    const hosted = await createHealthAuthFixture({ transport: "hosted" });

    const headOk = await hosted.server.inject({
      method: "HEAD",
      url: `/api/health?projectId=${hosted.projectA.projectId}`,
      headers: { authorization: `Bearer ${hosted.projectAKey}` },
    });
    expect(headOk.statusCode).toBe(200);
    expect(headOk.body).toBe("");

    const headCrossProject = await hosted.server.inject({
      method: "HEAD",
      url: `/api/health?projectId=${hosted.projectB.projectId}`,
      headers: { authorization: `Bearer ${hosted.projectAKey}` },
    });
    expect(headCrossProject.statusCode).toBe(403);

    const local = await createHealthAuthFixture({ transport: "trusted_local" });
    const localHealth = await local.server.inject({
      method: "GET",
      url: "/health",
    });
    expect(localHealth.statusCode).toBe(200);
    expect(localHealth.json().projectReadiness.totalCount).toBe(2);
  });
});
