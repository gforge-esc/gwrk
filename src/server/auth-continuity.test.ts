/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createCredentialCryptoAdapter } from "../adapters/auth/credential-crypto.js";
import { createHostedAuthFactory } from "../adapters/auth/hosted-auth-factory.js";
import * as gwrkPaths from "../adapters/config/paths.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import {
  createSqliteAuthStoreAdapter,
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";
import { openDatabase } from "../db/index.js";
import { computeProjectId } from "../domain/project-id.js";
import type { EnrolledProject } from "../domain/project-registry.js";
import type { NotificationPort } from "../ports/notification-port.js";
import type {
  ClockPort,
  WorkerExecutionPort,
} from "../ports/operations-port.js";
import { GwrkConfigSchema } from "../utils/config.js";
import { HarvestWatcher } from "./harvest-watcher.js";
import { startServer } from "./index.js";
import { SystemMonitor } from "./monitor.js";
import { SandboxManager } from "./sandbox.js";
import * as slackModule from "./slack.js";

const ORIGIN = "https://gwrk.gforge.ai";
const SECRETS_ROOT = "/etc/gwrk/secrets";
const CLIENT_ID = "continuity-pilot.apps.googleusercontent.com";
const WEBHOOK_SECRET = "continuity-webhook-secret";
const HMAC_KEY = Buffer.alloc(32, 42);
const BASE_NOW_MS = Date.parse("2026-11-24T12:00:00.000Z");

const HOSTED_AUTH_CONFIG = Object.freeze({
  mode: "hosted",
  publicOrigin: ORIGIN,
  googleClientId: CLIENT_ID,
  googleAllowlistFile: `${SECRETS_ROOT}/google-account-allowlist`,
  csrfHmacKeyFile: `${SECRETS_ROOT}/csrf-hmac-key`,
});

let jwks: { keys: Record<string, unknown>[] };
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "cont-k1",
    alg: "RS256",
    use: "sig",
  };
  jwks = { keys: [jwk] };
});

async function signGoogleIdToken(
  subject: string,
  email: string,
): Promise<string> {
  return new SignJWT({ email, email_verified: true })
    .setProtectedHeader({ alg: "RS256", kid: "cont-k1" })
    .setIssuer("https://accounts.google.com")
    .setAudience(CLIENT_ID)
    .setSubject(subject)
    .setIssuedAt(Math.floor(BASE_NOW_MS / 1000) - 5)
    .setExpirationTime(Math.floor(BASE_NOW_MS / 1000) + 3600)
    .sign(privateKey);
}

function signWebhook(secret: string, rawBody: Buffer): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function initRepo(dir: string, remoteUrl: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const env = {
    ...repositoryGitEnv(dir),
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Gwrk Test",
    GIT_AUTHOR_EMAIL: "gwrk-test@example.invalid",
    GIT_COMMITTER_NAME: "Gwrk Test",
    GIT_COMMITTER_EMAIL: "gwrk-test@example.invalid",
    GIT_TERMINAL_PROMPT: "0",
  };
  execFileSync("git", ["init", "--template=", "--initial-branch=develop"], {
    cwd: dir,
    env,
    stdio: "ignore",
  });
  execFileSync(
    "git",
    ["commit", "--no-gpg-sign", "--allow-empty", "-m", "init"],
    {
      cwd: dir,
      env,
      stdio: "ignore",
    },
  );
  execFileSync("git", ["remote", "add", "origin", remoteUrl], {
    cwd: dir,
    env,
    stdio: "ignore",
  });
  return computeProjectId({
    projectRoot: dir,
    remoteOriginUrl: remoteUrl,
    gitCommonDir: path.join(dir, ".git"),
  });
}

describe("FR-017 / TR-018: hosted auth restart continuity and post-revocation denial", () => {
  let tmpDir: string;
  let alphaRoot: string;
  let betaRoot: string;
  let dbPath: string;
  let alphaProject: EnrolledProject;
  let betaProject: EnrolledProject;

  beforeEach(() => {
    tmpDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-auth-continuity-")),
    );
    alphaRoot = path.join(tmpDir, "alpha");
    betaRoot = path.join(tmpDir, "beta");
    dbPath = path.join(tmpDir, "gwrk.db");

    vi.stubEnv("GWRK_HOME", path.join(tmpDir, "home"));
    vi.stubEnv("GWRK_DIR", "");
    vi.stubEnv("GWRK_DB_PATH", "");
    vi.stubEnv("GWRK_RUNTIME_DIR", "");

    const alphaId = initRepo(alphaRoot, "git@github.com:org/alpha.git");
    const betaId = initRepo(betaRoot, "git@github.com:org/beta.git");

    const seedDb = openDatabase({ dbPath });
    try {
      const registry = createSqliteProjectRegistryAdapter({ db: seedDb });
      const createdAt = new Date(BASE_NOW_MS - 10_000).toISOString();
      alphaProject = registry.enrollProject({
        projectId: alphaId,
        slug: "alpha",
        name: "Alpha Pilot",
        repoSlug: "org/alpha",
        trunkBranch: "develop",
        localRoot: alphaRoot,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local", "hosted"] },
        slack: {
          workspaceId: "W_PILOT",
          channelId: "C_ALPHA",
          sharedChannel: false,
        },
        legacyProjectIds: [],
        createdAt,
        updatedAt: createdAt,
      });
      betaProject = registry.enrollProject({
        projectId: betaId,
        slug: "beta",
        name: "Beta Pilot",
        repoSlug: "org/beta",
        trunkBranch: "develop",
        localRoot: betaRoot,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local", "hosted"] },
        slack: {
          workspaceId: "W_PILOT",
          channelId: "C_BETA",
          sharedChannel: false,
        },
        legacyProjectIds: [],
        createdAt,
        updatedAt: createdAt,
      });
    } finally {
      seedDb.close();
    }

    vi.spyOn(gwrkPaths, "usesHostedRuntime").mockReturnValue(false);
    vi.spyOn(HarvestWatcher.prototype, "start").mockImplementation(() => {});
    vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(true);
    vi.spyOn(SandboxManager.prototype, "pruneSandboxes").mockResolvedValue(
      undefined,
    );
    vi.spyOn(slackModule, "getSlackApp").mockReturnValue(null);
    vi.spyOn(slackModule, "startSlackApp").mockResolvedValue(undefined);
    vi.spyOn(slackModule, "stopSlackApp").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function parseHostedConfig() {
    return GwrkConfigSchema.parse({
      project: { name: "continuity-pilot" },
      server: {
        host: "127.0.0.1",
        port: 0,
        githubWebhookSecret: WEBHOOK_SECRET,
        auth: HOSTED_AUTH_CONFIG,
      },
    });
  }

  function createFakeNotifier(): NotificationPort {
    return {
      notify: vi.fn().mockResolvedValue({
        delivered: true,
        channelId: "C_ALPHA",
        messageTs: "1732449600.000100",
      }),
      getDeliveryStatus: async () => ({
        mode: "socket_connected",
        workspaceId: "W_PILOT",
        connected: true,
      }),
    };
  }

  function createFakeWorker(): WorkerExecutionPort {
    return {
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
  }

  async function bootHostedServer(input: {
    clock: ClockPort;
    getAccounts: () => readonly string[];
  }) {
    const config = parseHostedConfig();
    const db = openDatabase({ dbPath });
    const registry = createSqliteProjectRegistryAdapter({ db });
    const operationsStore = createSqliteOperationsStoreAdapter({ db });
    const authStore = createSqliteAuthStoreAdapter({ db });

    const factory = createHostedAuthFactory({
      store: authStore,
      clock: input.clock,
      effects: {
        resolveGroupId: async () => 1479,
        createFiles: () => ({
          readAllowlist: async () => input.getAccounts(),
          readCsrfHmacKey: async () => Buffer.from(HMAC_KEY),
        }),
        jwksFetch: async () => Response.json(jwks),
        logoutFetch: async () =>
          new Response(null, {
            status: 302,
            headers: {
              "Set-Cookie":
                "__Host-gwrk_session=; Path=/; Secure; HttpOnly; Max-Age=0",
            },
          }),
      },
    });

    const authInit = await factory.initialize({
      auth: Reflect.get(config.server, "auth"),
      secretsRoot: SECRETS_ROOT,
    });
    expect(authInit).toMatchObject({ ok: true, mode: "hosted" });
    if (!authInit.ok || authInit.mode !== "hosted") {
      db.close();
      throw new Error("Expected hosted auth initialization to succeed");
    }

    const server = await startServer(config, {
      handleSignals: false,
      projectRoot: alphaRoot,
      pid: { writePid: vi.fn(), removePid: vi.fn() },
      ledger: { db, projectId: alphaProject.projectId },
      registry,
      operationsStore,
      clock: input.clock,
      notifier: createFakeNotifier(),
      worker: createFakeWorker(),
      autoResumeWebhook: false,
      transport: "hosted",
      runnerKind: "hosted",
      hostedAuth: authInit.hostedAuth,
    });

    return {
      server,
      db,
      authStore,
      operationsStore,
      close: async () => {
        await server.close();
        if (db.open) db.close();
      },
    };
  }

  it("AUTH-18: preserves accepted scoped dispatch, harvest operation IDs, and recipient receipts across restart while denying revoked credentials and logged-out sessions", async () => {
    let nowMs = BASE_NOW_MS;
    const clock: ClockPort = {
      nowMs: () => nowMs,
      nowIso: () => new Date(nowMs).toISOString(),
    };
    let accounts: readonly string[] = ["operator@example.test"];

    const crypto = createCredentialCryptoAdapter();
    const opKey = crypto.generateApiCredential("cont-alpha-op");
    const readerKey = crypto.generateApiCredential("cont-alpha-reader");
    const seedDb = openDatabase({ dbPath });
    try {
      const authStore = createSqliteAuthStoreAdapter({ db: seedDb });
      for (const [id, gen, role] of [
        ["cont-alpha-op", opKey, "operator"],
        ["cont-alpha-reader", readerKey, "viewer"],
      ] as const) {
        authStore.createCredentialWithGrants({
          credentialId: id,
          verifierSha256: gen.verifierSha256,
          label: id,
          issuer: "local-admin",
          audienceOrigin: ORIGIN,
          createdAt: new Date(BASE_NOW_MS - 1_000).toISOString(),
          expiresAt: new Date(BASE_NOW_MS + 7_200_000).toISOString(),
          grants: [{ projectId: alphaProject.projectId, role }],
        });
      }
    } finally {
      seedDb.close();
    }

    const googleToken1 = await signGoogleIdToken(
      "cont-sub-1",
      "operator@example.test",
    );
    const webhookPayload = Buffer.from(
      JSON.stringify({
        action: "closed",
        repository: { full_name: "org/alpha" },
        pull_request: {
          number: 51,
          html_url: "https://github.com/org/alpha/pull/51",
          merged: true,
          merged_at: "2026-11-24T12:00:00Z",
          merge_commit_sha: "a".repeat(40),
          head: {
            ref: "feat/051-hosted-aws-pilot-phase-06",
            sha: "b".repeat(40),
            repo: { full_name: "org/alpha" },
          },
          base: { ref: "develop", repo: { full_name: "org/alpha" } },
        },
      }),
      "utf8",
    );
    const webhookSig = signWebhook(WEBHOOK_SECRET, webhookPayload);

    let dispatchOperationId = "";
    let harvestOperationId = "";

    // Boot 1: accept scoped dispatch, accept signed harvest, log out Google session, revoke operator key.
    const boot1 = await bootHostedServer({
      clock,
      getAccounts: () => accounts,
    });
    try {
      const dispatchRes = await boot1.server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { authorization: `Bearer ${opKey.rawCredential}` },
        payload: {
          projectId: alphaProject.projectId,
          featureId: "051-hosted-aws-pilot",
          phaseId: "phase-06",
          recipient: {
            projectId: alphaProject.projectId,
            surface: "slack",
            workspaceId: "W_PILOT",
            channelId: "C_ALPHA",
          },
        },
      });
      expect(dispatchRes.statusCode).toBe(201);
      const dispatchReceipt = dispatchRes.json();
      dispatchOperationId = dispatchReceipt.operationId;
      expect(dispatchOperationId).toBeTruthy();
      expect(dispatchReceipt.recipient).toMatchObject({
        projectId: alphaProject.projectId,
        surface: "slack",
        workspaceId: "W_PILOT",
        channelId: "C_ALPHA",
      });

      const harvestRes = await boot1.server.inject({
        method: "POST",
        url: "/webhook/github",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "auth18-harvest-delivery-1",
          "x-hub-signature-256": webhookSig,
        },
        payload: webhookPayload,
      });
      expect(harvestRes.statusCode).toBe(200);
      expect(harvestRes.json().status).toBe("accepted");
      harvestOperationId = harvestRes.json().operationId;
      expect(harvestOperationId).toBeTruthy();

      // Establish and revoke a Google browser session via origin-first logout.
      const sessionRes = await boot1.server.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: {
          "x-gwrk-auth-mode": "google_id_token",
          authorization: `Bearer ${googleToken1}`,
        },
      });
      expect(sessionRes.statusCode).toBe(200);
      const csrfToken = sessionRes.json().csrfToken as string;
      const rawSetCookie = sessionRes.headers["set-cookie"];
      const csrfCookie = (
        Array.isArray(rawSetCookie) ? rawSetCookie[0] : String(rawSetCookie)
      ).split(";", 1)[0];

      const logoutRes = await boot1.server.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: {
          origin: ORIGIN,
          "x-gwrk-auth-mode": "google_id_token",
          authorization: `Bearer ${googleToken1}`,
          "x-gwrk-csrf-token": csrfToken,
          cookie: `${csrfCookie}; __Host-gwrk_session=active`,
        },
      });
      expect(logoutRes.statusCode).toBe(200);

      // Revoke the operator API key after durable acceptance commits.
      boot1.authStore.revokeApiCredential({
        credentialId: "cont-alpha-op",
        revokedAt: clock.nowIso(),
        reason: "post-acceptance-rotation",
      });
    } finally {
      await boot1.close();
    }

    // Boot 2: reopen the same ledger and verify durable continuity + persisted revocations.
    nowMs += 5_000;
    const boot2 = await bootHostedServer({
      clock,
      getAccounts: () => accounts,
    });
    try {
      // Active reader credential survives restart and reads preserved dispatch + recipient.
      const queueRes = await boot2.server.inject({
        method: "GET",
        url: `/api/dispatch/queue?projectId=${encodeURIComponent(alphaProject.projectId)}`,
        headers: { authorization: `Bearer ${readerKey.rawCredential}` },
      });
      expect(queueRes.statusCode).toBe(200);
      const dispatchRow = boot2.operationsStore.getDispatchOperation({
        projectId: alphaProject.projectId,
        featureId: "051-hosted-aws-pilot",
        phaseId: "phase-06",
      });
      expect(dispatchRow).not.toBeNull();
      expect(dispatchRow?.operationId).toBe(dispatchOperationId);
      expect(dispatchRow?.recipient).toMatchObject({
        projectId: alphaProject.projectId,
        surface: "slack",
        workspaceId: "W_PILOT",
        channelId: "C_ALPHA",
      });

      // Cross-project access remains denied for the surviving reader credential.
      const crossProject = await boot2.server.inject({
        method: "GET",
        url: `/api/health?projectId=${encodeURIComponent(betaProject.projectId)}`,
        headers: { authorization: `Bearer ${readerKey.rawCredential}` },
      });
      expect(crossProject.statusCode).toBe(403);

      // Replaying the signed harvest delivery after restart reuses the exact harvest operation ID.
      const harvestReplay = await boot2.server.inject({
        method: "POST",
        url: "/webhook/github",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "auth18-harvest-delivery-1",
          "x-hub-signature-256": webhookSig,
        },
        payload: webhookPayload,
      });
      expect(harvestReplay.statusCode).toBe(200);
      expect(harvestReplay.json().operationId).toBe(harvestOperationId);
      expect(harvestReplay.json().deduplicatedTransport).toBe(true);

      // Revoked API key stays denied across restart with zero new dispatch rows.
      const revokedCall = await boot2.server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { authorization: `Bearer ${opKey.rawCredential}` },
        payload: {
          projectId: alphaProject.projectId,
          featureId: "051-hosted-aws-pilot",
          phaseId: "phase-07",
        },
      });
      expect(revokedCall.statusCode).toBe(401);
      expect(revokedCall.json().code).toBe("AUTH_CREDENTIAL_REJECTED");
      expect(
        boot2.db
          .prepare("SELECT COUNT(*) AS count FROM dispatch_operations")
          .get(),
      ).toEqual({ count: 1 });

      // Logged-out Google session stays denied across restart.
      const replayedGoogle = await boot2.server.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: {
          "x-gwrk-auth-mode": "google_id_token",
          authorization: `Bearer ${googleToken1}`,
        },
      });
      expect(replayedGoogle.statusCode).toBe(401);
      expect(replayedGoogle.json().code).toBe("AUTH_SESSION_REVOKED");

      // Removing the account from the live allowlist denies a fresh Google token without restart.
      accounts = ["other@example.test"];
      const freshGoogle = await signGoogleIdToken(
        "cont-sub-2",
        "operator@example.test",
      );
      const deniedAfterAllowlistChange = await boot2.server.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: {
          "x-gwrk-auth-mode": "google_id_token",
          authorization: `Bearer ${freshGoogle}`,
        },
      });
      expect(deniedAfterAllowlistChange.statusCode).toBe(403);
      expect(deniedAfterAllowlistChange.json().code).toBe(
        "AUTH_ACCOUNT_DENIED",
      );
    } finally {
      await boot2.close();
    }
  });
});
