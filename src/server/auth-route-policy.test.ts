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
const NOW = Date.parse("2026-11-23T19:30:00.000Z");
const GOOGLE_TOKEN = "CANARY_ROUTE_POLICY_GOOGLE_TOKEN";
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

async function createRoutePolicyFixture() {
  vi.clearAllMocks();
  vi.spyOn(gwrkPaths, "usesHostedRuntime").mockReturnValue(false);
  vi.spyOn(HarvestWatcher.prototype, "start").mockImplementation(() => {});
  vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(true);

  const tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-route-policy-")),
  );
  const repoDir = path.join(tmpDir, "policy-repo");
  const projectId = initFixtureRepo(
    repoDir,
    "git@github.com:org/route-policy-app.git",
  );

  const db = openDatabase({ dbPath: path.join(tmpDir, "gwrk.db") });
  const registry = createSqliteProjectRegistryAdapter({ db });
  const operationsStore = createSqliteOperationsStoreAdapter({ db });
  const authStore = createSqliteAuthStoreAdapter({ db });
  const crypto = createCredentialCryptoAdapter();

  const project = registry.enrollProject({
    projectId,
    slug: "route-policy-slug",
    name: "Route Policy Project",
    repoSlug: "org/route-policy-app",
    trunkBranch: "main",
    localRoot: repoDir,
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["local", "hosted"] },
    slack: {
      workspaceId: "W_POLICY",
      channelId: "C_POLICY",
      sharedChannel: false,
    },
    legacyProjectIds: [],
    createdAt: iso(NOW - 10_000),
    updatedAt: iso(NOW - 10_000),
  });

  const operatorKey = crypto.generateApiCredential("cred-route-policy-op");
  authStore.createCredentialWithGrants({
    credentialId: "cred-route-policy-op",
    verifierSha256: operatorKey.verifierSha256,
    label: "route-policy-op",
    issuer: "local-admin",
    audienceOrigin: ORIGIN,
    createdAt: iso(NOW - 1000),
    expiresAt: iso(NOW + 3600_000),
    grants: [{ projectId: project.projectId, role: "operator" }],
  });

  registry.setRoleBinding({
    projectId: project.projectId,
    principalType: "google_sub",
    principalId: "https://accounts.google.com:policy-user",
    role: "operator",
  });

  const clock = { nowMs: () => NOW, nowIso: () => iso(NOW) };
  const google: GoogleIdentityVerifierPort = {
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
          subject: "policy-user",
          principalId: "https://accounts.google.com:policy-user",
          email: "policy-user@example.test",
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
    hmacKey: Buffer.alloc(32, 37),
    clock,
  });
  const issueCsrfSpy = vi.spyOn(csrf, "issueToken");

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
      .mockResolvedValue({ ok: true, deliveryId: "policy-notify" }),
    getDeliveryStatus: vi.fn().mockResolvedValue({
      mode: "socket_connected" as const,
      workspaceId: "W_POLICY",
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
    project: { name: "route-policy-fixture" },
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

  const dispatchCount = (): number =>
    (
      db.prepare("SELECT COUNT(*) AS count FROM dispatch_operations").get() as {
        count: number;
      }
    ).count;

  return {
    server,
    db,
    registry,
    notifier: fakeNotifier,
    project,
    operatorKey: operatorKey.rawCredential,
    issueCsrfSpy,
    dispatchCount,
  };
}

describe("FR-010 US-006 TR-012: hosted default-deny route policy, HEAD parity, disabled CORS, and JSON API denials", () => {
  it.each(["status", "dispatch", "notify"] as const)(
    "FR-010: scoped %s 403 has a nonempty request ID and zero accepted effects",
    async (route) => {
      const f = await createRoutePolicyFixture();
      const hiddenRoot = `${f.project.localRoot}-hidden`;
      const hiddenId = initFixtureRepo(
        hiddenRoot,
        "git@github.com:private/hidden-policy.git",
      );
      const hidden = f.registry.enrollProject({
        ...f.project,
        projectId: hiddenId,
        slug: "hidden-policy-slug",
        name: "Hidden Policy Project",
        repoSlug: "private/hidden-policy",
        localRoot: hiddenRoot,
        legacyProjectIds: [],
      });
      const payload =
        route === "notify"
          ? {
              projectId: hidden.projectId,
              type: "phase_completed",
              feature: { id: "051-policy-denied", name: "Denied" },
            }
          : {
              projectId: hidden.projectId,
              featureId: "051-policy-denied",
              phaseId: "phase-05",
            };
      const response = await f.server.inject({
        method: route === "status" ? "GET" : "POST",
        url:
          route === "status"
            ? `/api/status?projectId=${hidden.projectId}`
            : `/api/${route}`,
        headers: { authorization: `Bearer ${f.operatorKey}` },
        ...(route === "status" ? {} : { payload }),
      });
      expect(response.statusCode).toBe(403);
      expect(f.dispatchCount()).toBe(0);
      expect(f.notifier.notify).not.toHaveBeenCalled();
      expect(slackNotify.notifySlack).not.toHaveBeenCalled();
      for (const table of [
        "dispatch_operations",
        "harvest_operations",
        "harvest_deliveries",
      ]) {
        expect(
          (
            f.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
              count: number;
            }
          ).count,
        ).toBe(0);
      }
      expect(response.json()).toMatchObject({
        ok: false,
        requestId: expect.any(String),
      });
      expect(response.json().requestId.trim().length).toBeGreaterThan(0);
    },
  );

  it("FR-010: ambiguous project denial omits candidateSlugs and unauthorized project metadata", async () => {
    const f = await createRoutePolicyFixture();
    const hiddenRoot = `${f.project.localRoot}-hidden`;
    const hiddenId = initFixtureRepo(
      hiddenRoot,
      "git@github.com:private/hidden-policy.git",
    );
    const hidden = f.registry.enrollProject({
      ...f.project,
      projectId: hiddenId,
      slug: "hidden-policy-slug",
      name: "Hidden Policy Project",
      repoSlug: "private/hidden-policy",
      localRoot: hiddenRoot,
      legacyProjectIds: [],
    });
    const response = await f.server.inject({
      method: "GET",
      url: "/api/status",
      headers: { authorization: `Bearer ${f.operatorKey}` },
    });
    expect(f.dispatchCount()).toBe(0);
    expect(f.notifier.notify).not.toHaveBeenCalled();
    expect(slackNotify.notifySlack).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      code: "AMBIGUOUS_PROJECT_SELECTION",
    });
    expect(response.json()).not.toHaveProperty("candidateSlugs");
    for (const metadata of [
      hidden.projectId,
      hidden.slug,
      hidden.name,
      hidden.repoSlug,
      hidden.localRoot,
    ]) {
      expect(response.body).not.toContain(metadata);
    }
  });

  it.each([undefined, `sha256=${"0".repeat(64)}`])(
    "AUTH-13: valid enrolled API key cannot replace missing or invalid webhook HMAC %s",
    async (signature) => {
      const f = await createRoutePolicyFixture();
      const control = await f.server.inject({
        method: "GET",
        url: `/api/status?projectId=${f.project.projectId}`,
        headers: { authorization: `Bearer ${f.operatorKey}` },
      });
      expect(control.statusCode).toBe(200);
      const response = await f.server.inject({
        method: "POST",
        url: "/webhook/github",
        headers: {
          authorization: `Bearer ${f.operatorKey}`,
          "x-github-event": "pull_request",
          "x-github-delivery": "policy-no-api-fallback",
          ...(signature === undefined
            ? {}
            : { "x-hub-signature-256": signature }),
        },
        payload: {
          action: "closed",
          repository: { full_name: f.project.repoSlug },
          pull_request: {
            merged: true,
            number: 1,
            head: { ref: "feature/051-policy" },
            base: { ref: "main" },
          },
        },
      });
      expect(response.statusCode).toBe(401);
      expect(f.dispatchCount()).toBe(0);
      expect(f.notifier.notify).not.toHaveBeenCalled();
      expect(slackNotify.notifySlack).not.toHaveBeenCalled();
      for (const table of ["harvest_operations", "harvest_deliveries"]) {
        expect(
          (
            f.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
              count: number;
            }
          ).count,
        ).toBe(0);
      }
    },
  );

  it("FR-010: denies unclassified routes and returns JSON on API paths", async () => {
    const f = await createRoutePolicyFixture();

    const unclassified = [
      { url: "/unclassified", expectedCode: "ROUTE_NOT_FOUND" },
      { url: "/api/unknown", expectedCode: "ROUTE_NOT_FOUND" },
      { url: "/api/auth/keys", expectedCode: "ROUTE_NOT_FOUND" },
      { url: "/api/dispatch/a/b/c", expectedCode: "ROUTE_NOT_FOUND" },
      { url: "/internal/metrics", expectedCode: "ROUTE_NOT_FOUND" },
      { url: "/oauth2/sign_out", expectedCode: "ROUTE_NOT_PUBLIC" },
    ];

    for (const probe of unclassified) {
      for (const headers of [
        {},
        { authorization: `Bearer ${f.operatorKey}` },
      ]) {
        const res = await f.server.inject({
          method: "GET",
          url: probe.url,
          headers,
        });
        expect(res.statusCode, probe.url).toBe(404);
        expect(res.headers.location).toBeUndefined();
        expect(res.headers["content-type"]).toContain("application/json");
        expect(res.json()).toMatchObject({
          ok: false,
          code: probe.expectedCode,
          requestId: expect.any(String),
        });
      }
    }

    const apiPaths = [
      {
        method: "GET" as const,
        url: `/api/status?projectId=${f.project.projectId}`,
      },
      { method: "POST" as const, url: "/api/dispatch" },
      {
        method: "GET" as const,
        url: `/api/dispatch/queue?projectId=${f.project.projectId}`,
      },
      {
        method: "GET" as const,
        url: `/api/dispatch/051-pilot/phase-05?projectId=${f.project.projectId}`,
      },
      { method: "POST" as const, url: "/api/notify" },
      {
        method: "GET" as const,
        url: `/api/health?projectId=${f.project.projectId}`,
      },
      { method: "GET" as const, url: "/api/auth/session" },
      { method: "POST" as const, url: "/api/auth/logout" },
    ];

    for (const probe of apiPaths) {
      const res = await f.server.inject(probe);
      expect(res.statusCode, `${probe.method} ${probe.url}`).toBe(401);
      expect(res.headers.location).toBeUndefined();
      expect(res.headers["content-type"]).toContain("application/json");
      expect(res.json()).toMatchObject({
        ok: false,
        code: "AUTH_REQUIRED",
        requestId: expect.any(String),
      });
    }

    expect(f.dispatchCount()).toBe(0);
    expect(slackNotify.notifySlack).not.toHaveBeenCalled();
  });

  it("FR-010: denies unsupported HTTP methods on declared routes with HTTP 405 JSON and zero effects", async () => {
    const f = await createRoutePolicyFixture();

    const unsupported: Array<{
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      url: string;
    }> = [
      { method: "POST", url: "/" },
      { method: "POST", url: "/health" },
      { method: "PUT", url: "/api/status" },
      { method: "DELETE", url: "/api/status" },
      { method: "GET", url: "/api/dispatch" },
      { method: "PATCH", url: "/api/dispatch" },
      { method: "DELETE", url: "/api/dispatch/queue" },
      { method: "GET", url: "/api/notify" },
      { method: "POST", url: "/api/health" },
      { method: "POST", url: "/api/auth/session" },
      { method: "GET", url: "/api/auth/logout" },
      { method: "GET", url: "/webhook/github" },
    ];

    for (const probe of unsupported) {
      const res = await f.server.inject({
        method: probe.method,
        url: probe.url,
        headers: { authorization: `Bearer ${f.operatorKey}` },
      });
      expect(res.statusCode, `${probe.method} ${probe.url}`).toBe(405);
      expect(res.headers.location).toBeUndefined();
      expect(res.headers["content-type"]).toContain("application/json");
      expect(res.json()).toMatchObject({
        ok: false,
        code: "METHOD_NOT_ALLOWED",
        requestId: expect.any(String),
      });
    }

    expect(f.dispatchCount()).toBe(0);
    expect(slackNotify.notifySlack).not.toHaveBeenCalled();
  });

  it("FR-010: HEAD follows read route policy without CSRF issuance and denies write-only routes", async () => {
    const f = await createRoutePolicyFixture();

    expect(
      (await f.server.inject({ method: "HEAD", url: "/" })).statusCode,
    ).toBe(200);
    expect(
      (await f.server.inject({ method: "HEAD", url: "/health" })).statusCode,
    ).toBe(200);

    for (const url of [
      `/api/status?projectId=${f.project.projectId}`,
      `/api/dispatch/queue?projectId=${f.project.projectId}`,
      `/api/health?projectId=${f.project.projectId}`,
    ]) {
      const unauth = await f.server.inject({ method: "HEAD", url });
      expect(unauth.statusCode, `unauth HEAD ${url}`).toBe(401);
      expect(unauth.headers.location).toBeUndefined();

      const auth = await f.server.inject({
        method: "HEAD",
        url,
        headers: { authorization: `Bearer ${f.operatorKey}` },
      });
      expect(auth.statusCode, `auth HEAD ${url}`).toBe(200);
      expect(auth.body).toBe("");
    }

    const headSessionUnauth = await f.server.inject({
      method: "HEAD",
      url: "/api/auth/session",
    });
    expect(headSessionUnauth.statusCode).toBe(401);

    const headSessionAuth = await f.server.inject({
      method: "HEAD",
      url: "/api/auth/session",
      headers: {
        authorization: `Bearer ${GOOGLE_TOKEN}`,
        "x-gwrk-auth-mode": "google_id_token",
      },
    });
    expect(headSessionAuth.statusCode).toBe(200);
    expect(headSessionAuth.headers["cache-control"]).toBe("no-store");
    expect(headSessionAuth.headers["set-cookie"]).toBeUndefined();
    expect(headSessionAuth.body).toBe("");
    expect(f.issueCsrfSpy).not.toHaveBeenCalled();

    for (const writeOnlyUrl of [
      "/api/dispatch",
      "/api/notify",
      "/api/auth/logout",
      "/webhook/github",
    ]) {
      const res = await f.server.inject({
        method: "HEAD",
        url: writeOnlyUrl,
        headers: { authorization: `Bearer ${f.operatorKey}` },
      });
      expect(res.statusCode, `HEAD ${writeOnlyUrl}`).toBe(405);
    }
  });

  it("FR-010: keeps CORS disabled for cross-origin credentialed preflight and API requests", async () => {
    const f = await createRoutePolicyFixture();

    for (const url of [
      "/api/status",
      "/api/dispatch",
      "/api/health",
      "/api/auth/session",
    ]) {
      const preflight = await f.server.inject({
        method: "OPTIONS",
        url,
        headers: {
          origin: "https://evil.example.test",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization, x-gwrk-csrf-token",
        },
      });
      expect([404, 405]).toContain(preflight.statusCode);
      expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
      expect(
        preflight.headers["access-control-allow-credentials"],
      ).toBeUndefined();
    }

    const crossOriginRead = await f.server.inject({
      method: "GET",
      url: `/api/status?projectId=${f.project.projectId}`,
      headers: {
        authorization: `Bearer ${f.operatorKey}`,
        origin: "https://evil.example.test",
      },
    });
    expect(crossOriginRead.statusCode).toBe(200);
    expect(
      crossOriginRead.headers["access-control-allow-origin"],
    ).toBeUndefined();
    expect(
      crossOriginRead.headers["access-control-allow-credentials"],
    ).toBeUndefined();
  });
});
