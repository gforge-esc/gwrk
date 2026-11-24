/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSyntheticVcsPort } from "../../tests/helpers/synthetic-slack.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import {
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";
import { openDatabase } from "../db/index.js";
import { listRuns, recordRun } from "../db/runs.js";
import { computeProjectId } from "../domain/project-id.js";
import type { EnrolledProject } from "../domain/project-registry.js";
import type {
  NotificationPayload,
  NotificationPort,
  NotificationReconcileQuery,
  NotificationReconcileResult,
} from "../ports/notification-port.js";
import type {
  ClockPort,
  GitHubHarvestPort,
  HarvestExecutionPort,
  WorkerExecutionPort,
} from "../ports/operations-port.js";
import { GwrkConfigSchema } from "../utils/config.js";
import { HarvestWatcher } from "./harvest-watcher.js";
import { startServer } from "./index.js";
import { SystemMonitor } from "./monitor.js";
import { SandboxManager } from "./sandbox.js";
import * as slackNotify from "./slack-notify.js";
import * as slackModule from "./slack.js";

function runGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...repositoryGitEnv(cwd),
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Gwrk Test",
      GIT_AUTHOR_EMAIL: "gwrk-test@example.invalid",
      GIT_COMMITTER_NAME: "Gwrk Test",
      GIT_COMMITTER_EMAIL: "gwrk-test@example.invalid",
      GIT_TERMINAL_PROMPT: "0",
    },
  }).trim();
}

function createRepo(
  root: string,
  trunk: string,
  remoteUrl: string,
): {
  root: string;
  headSha: string;
} {
  fs.mkdirSync(root, { recursive: true });
  const realRoot = fs.realpathSync(root);
  runGit(realRoot, "init", "--template=", `--initial-branch=${trunk}`);
  runGit(realRoot, "commit", "--no-gpg-sign", "--allow-empty", "-m", "init");
  runGit(realRoot, "remote", "add", "origin", remoteUrl);
  return { root: realRoot, headSha: runGit(realRoot, "rev-parse", "HEAD") };
}

function signWebhook(secret: string, body: Buffer): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function createRecoveryHostedAuth() {
  const tokens: Record<string, { principalId: string; credentialId: string }> =
    {
      "Bearer alpha-op-token": {
        principalId: "iss:alpha-op",
        credentialId: "cred-alpha-op",
      },
      "Bearer beta-op-token": {
        principalId: "iss:beta-op",
        credentialId: "cred-beta-op",
      },
    };
  return {
    authenticate: async ({
      authorizationHeader,
    }: {
      authorizationHeader?: string;
    }) => {
      if (!authorizationHeader) {
        return { ok: true as const, context: null, mechanism: "none" as const };
      }
      const match = tokens[authorizationHeader];
      if (!match) {
        return {
          ok: false as const,
          code: "AUTH_CREDENTIAL_REJECTED" as const,
          message: "Authentication denied",
        };
      }
      return {
        ok: true as const,
        context: {
          principalType: "google_sub" as const,
          principalId: match.principalId,
          credentialId: match.credentialId,
          expiresAt: "2026-12-31T00:00:00.000Z",
          authMethod: "api_key" as const,
        },
      };
    },
  };
}

describe("TR-005: unattended restart recovery, two-repo PR collisions and synthetic GitHub/Slack faults", () => {
  let workspaceDir: string;
  let dbPath: string;
  let alpha: { root: string; headSha: string };
  let beta: { root: string; headSha: string };
  let alphaProject: EnrolledProject;
  let betaProject: EnrolledProject;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const webhookSecret = "unattended-webhook-secret";

  function enrollTwoRepos(db: Database.Database) {
    const registry = createSqliteProjectRegistryAdapter({ db });
    const nowIso = "2026-11-23T08:00:00.000Z";
    const alphaEnrolled = registry.enrollProject({
      projectId: computeProjectId({
        projectRoot: alpha.root,
        remoteOriginUrl: "git@github.com:org/alpha.git",
        gitCommonDir: path.join(alpha.root, ".git"),
      }),
      slug: "alpha",
      name: "Alpha",
      repoSlug: "org/alpha",
      trunkBranch: "main",
      localRoot: alpha.root,
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local", "hosted"] },
      slack: {
        workspaceId: "T_PILOT",
        channelId: "C_ALPHA",
        sharedChannel: false,
      },
      legacyProjectIds: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    const betaEnrolled = registry.enrollProject({
      projectId: computeProjectId({
        projectRoot: beta.root,
        remoteOriginUrl: "git@github.com:org/beta.git",
        gitCommonDir: path.join(beta.root, ".git"),
      }),
      slug: "beta",
      name: "Beta",
      repoSlug: "org/beta",
      trunkBranch: "develop",
      localRoot: beta.root,
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local", "hosted"] },
      slack: {
        workspaceId: "T_PILOT",
        channelId: "C_BETA",
        sharedChannel: false,
      },
      legacyProjectIds: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    registry.setRoleBinding({
      projectId: alphaEnrolled.projectId,
      principalType: "google_sub",
      principalId: "iss:alpha-op",
      role: "operator",
    });
    registry.setRoleBinding({
      projectId: betaEnrolled.projectId,
      principalType: "google_sub",
      principalId: "iss:beta-op",
      role: "operator",
    });
    return { registry, alphaEnrolled, betaEnrolled };
  }

  beforeEach(() => {
    workspaceDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-unattended-")),
    );
    dbPath = path.join(workspaceDir, "gwrk.db");
    vi.stubEnv("GWRK_HOME", path.join(workspaceDir, "isolated-home"));
    vi.stubEnv("GWRK_DIR", "");
    vi.stubEnv("GWRK_DB_PATH", "");
    vi.stubEnv("GWRK_RUNTIME_DIR", "");

    alpha = createRepo(
      path.join(workspaceDir, "alpha"),
      "main",
      "git@github.com:org/alpha.git",
    );
    beta = createRepo(
      path.join(workspaceDir, "beta"),
      "develop",
      "git@github.com:org/beta.git",
    );

    const seedDb = openDatabase({ dbPath });
    try {
      const enrolled = enrollTwoRepos(seedDb);
      alphaProject = enrolled.alphaEnrolled;
      betaProject = enrolled.betaEnrolled;
    } finally {
      seedDb.close();
    }

    vi.spyOn(HarvestWatcher.prototype, "start").mockImplementation(() => {});
    vi.spyOn(SandboxManager.prototype, "pruneSandboxes").mockResolvedValue(
      undefined,
    );
    vi.spyOn(slackModule, "getSlackApp").mockReturnValue(null);
    vi.spyOn(slackModule, "startSlackApp").mockResolvedValue(undefined);
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected live network call"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("recovers accepted-before-launch and started-worker stale leases across daemon restart without duplicate launch or legacy notifier calls", async () => {
    const legacyNotifySpy = vi
      .spyOn(slackNotify, "notifySlack")
      .mockResolvedValue({ delivered: true });

    const config = GwrkConfigSchema.parse({
      project: { name: "unattended" },
      server: {
        host: "127.0.0.1",
        port: 0,
        githubWebhookSecret: webhookSecret,
      },
    });

    // Boot 1: accept alpha dispatch while throttled (simulating pre-launch crash),
    // and seed an expired running dispatch for beta whose worker already opened a PR.
    const throttledSpy = vi
      .spyOn(SystemMonitor.prototype, "isThrottled")
      .mockReturnValue(true);

    let nowMs = Date.parse("2026-11-23T10:00:00.000Z");
    const clock: ClockPort = {
      nowIso: () => new Date(nowMs).toISOString(),
      nowMs: () => nowMs,
    };

    let alphaOperationId = "";
    let betaStaleFence: {
      operationId: string;
      leaseOwner: string;
      leaseEpoch: number;
    } | null = null;

    const db1 = openDatabase({ dbPath });
    try {
      const registry1 = createSqliteProjectRegistryAdapter({ db: db1 });
      const ops1 = createSqliteOperationsStoreAdapter({ db: db1 });
      const server1 = await startServer(config, {
        handleSignals: false,
        projectRoot: alpha.root,
        pid: { writePid: vi.fn(), removePid: vi.fn() },
        ledger: { db: db1, projectId: alphaProject.projectId },
        registry: registry1,
        operationsStore: ops1,
        clock,
        notifier: {
          notify: vi.fn().mockResolvedValue({
            delivered: true,
            channelId: "C_ALPHA",
            messageTs: "1732300100.000001",
          }),
          getDeliveryStatus: async () => ({
            mode: "socket_connected",
            connected: true,
          }),
        },
        transport: "hosted",
        runnerKind: "hosted",
        hostedAuth: createRecoveryHostedAuth(),
      });

      try {
        const acceptRes = await server1.inject({
          method: "POST",
          url: "/api/dispatch",
          headers: { authorization: "Bearer alpha-op-token" },
          payload: {
            projectId: "alpha",
            featureId: "049-shared",
            phaseId: "phase-01",
          },
        });
        expect(acceptRes.statusCode).toBe(201);
        alphaOperationId = acceptRes.json().operationId;

        // Seed beta dispatch that crashed mid-worker (expired running lease)
        const betaReceipt = ops1.acceptDispatch({
          projectId: betaProject.projectId,
          featureId: "049-shared",
          phaseId: "phase-01",
          backend: "claude",
          trunkBranch: "develop",
          recipient: {
            projectId: betaProject.projectId,
            surface: "slack",
            workspaceId: "T_PILOT",
            channelId: "C_BETA",
          },
          newOperationId: "disp-beta-crashed",
          nowIso: clock.nowIso(),
        });
        const claimed = ops1.claimDispatchLease({
          operationId: betaReceipt.operationId,
          leaseOwner: "dead-worker-1",
          nowIso: clock.nowIso(),
          leaseExpiresAt: new Date(nowMs + 1_000).toISOString(),
        });
        expect(claimed).not.toBeNull();
        betaStaleFence = claimed?.fence ?? null;
      } finally {
        await server1.close();
      }
    } finally {
      db1.close();
    }

    // Advance clock past beta's lease expiry, reopen SQLite, and boot Server 2 unthrottled.
    nowMs += 60_000;
    throttledSpy.mockReturnValue(false);

    const launched: Array<{
      projectRoot: string;
      featureId: string;
      phaseId: string;
    }> = [];
    const inspected: string[] = [];
    const sentNotifications: NotificationPayload[] = [];

    const db2 = openDatabase({ dbPath });
    try {
      const registry2 = createSqliteProjectRegistryAdapter({ db: db2 });
      const ops2 = createSqliteOperationsStoreAdapter({ db: db2 });
      const worker2: WorkerExecutionPort = {
        inspectRecoveredWork: async (input) => {
          inspected.push(input.operationId);
          // Beta's crashed worker had already opened PR #99 -> must reconcile without relaunch!
          if (input.operationId === "disp-beta-crashed") {
            return {
              workerState: "stopped",
              pullRequestLookup: "complete",
              openPullRequest: {
                operationId: input.operationId,
                prNumber: 99,
                prUrl: "https://github.com/org/beta/pull/99",
              },
              mergedPullRequest: null,
              completedManifestRunId: null,
              sandboxDir: null,
            };
          }
          return {
            workerState: "stopped",
            pullRequestLookup: "complete",
            openPullRequest: null,
            mergedPullRequest: null,
            completedManifestRunId: null,
            sandboxDir: null,
          };
        },
        launchPhaseShip: async (input) => {
          launched.push({
            projectRoot: input.projectRoot,
            featureId: input.featureId,
            phaseId: input.phaseId,
          });
          const runId = recordRun(
            {
              feature_id: input.featureId,
              phase_id: input.phaseId,
              project_id: alphaProject.projectId,
              command: "gwrk ship",
              status: "completed",
              exit_code: 0,
            },
            db2,
          );
          return {
            exitCode: 0,
            stderr: "",
            prNumber: 42,
            prUrl: "https://github.com/org/alpha/pull/42",
            runId,
          };
        },
        cleanupStaleSandbox: async () => {},
      };

      const notifier2: NotificationPort = {
        notify: async (payload) => {
          sentNotifications.push(payload);
          return {
            delivered: true,
            channelId: payload.channel ?? "C_ALPHA",
            messageTs: `1732300200.00000${sentNotifications.length}`,
            threadTs: payload.threadTs,
          };
        },
        getDeliveryStatus: async () => ({
          mode: "socket_connected",
          connected: true,
        }),
      };

      const server2 = await startServer(config, {
        handleSignals: false,
        projectRoot: alpha.root,
        pid: { writePid: vi.fn(), removePid: vi.fn() },
        ledger: { db: db2, projectId: alphaProject.projectId },
        registry: registry2,
        operationsStore: ops2,
        worker: worker2,
        notifier: notifier2,
        clock,
        heartbeatIntervalMs: null,
        transport: "hosted",
        runnerKind: "hosted",
        hostedAuth: createRecoveryHostedAuth(),
      });

      try {
        // Wait for alpha's pre-launch queued dispatch to complete once
        await vi.waitFor(() => {
          const alphaOp = ops2.getDispatchOperation({
            projectId: alphaProject.projectId,
            featureId: "049-shared",
            phaseId: "phase-01",
          });
          expect(alphaOp?.status).toBe("completed");
        });

        // Beta's crashed worker was reconciled from PR #99 BEFORE launching and never relaunched
        expect(inspected).toContain("disp-beta-crashed");
        expect(launched).toEqual([
          {
            projectRoot: alpha.root,
            featureId: "049-shared",
            phaseId: "phase-01",
          },
        ]);

        const alphaOp = ops2.getDispatchOperation({
          projectId: alphaProject.projectId,
          featureId: "049-shared",
          phaseId: "phase-01",
        });
        expect(alphaOp?.operationId).toBe(alphaOperationId);
        expect(alphaOp?.lastRunId).not.toBeNull();

        const betaOp = ops2.getDispatchOperation({
          projectId: betaProject.projectId,
          featureId: "049-shared",
          phaseId: "phase-01",
        });
        expect(betaOp?.status).toBe("completed");
        expect(betaOp?.prNumber).toBe(99);

        // Stale lease owner from Boot 1 is fenced out
        expect(betaStaleFence).not.toBeNull();
        if (betaStaleFence) {
          const fenced = ops2.completeDispatchAttempt({
            fence: betaStaleFence,
            nowIso: clock.nowIso(),
            operationStatus: "failed",
            attemptStatus: "failed",
            error: "stale crash write",
          });
          expect(fenced).toEqual({ ok: false, code: "LEASE_FENCED" });
        }

        // Durable outbox delivered notification; legacy notifySlack was NOT called
        expect(legacyNotifySpy).not.toHaveBeenCalled();
        expect(sentNotifications.length).toBeGreaterThanOrEqual(1);
      } finally {
        await server2.close();
      }
    } finally {
      db2.close();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("isolates colliding PR #42 webhooks across two repos, survives uncertain Slack fault across restart, and reconciles without resend", async () => {
    vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(true);

    const config = GwrkConfigSchema.parse({
      project: { name: "unattended-harvest" },
      server: {
        host: "127.0.0.1",
        port: 0,
        githubWebhookSecret: webhookSecret,
      },
    });

    let nowMs = Date.parse("2026-11-23T11:00:00.000Z");
    const clock: ClockPort = {
      nowIso: () => new Date(nowMs).toISOString(),
      nowMs: () => nowMs,
    };

    const deletedBranches: Array<{ cwd: string; branch: string; sha: string }> =
      [];
    const syntheticVcs = createSyntheticVcsPort({
      fetchBranch: () => {},
      resolveRefSha: (cwd) =>
        cwd === alpha.root ? alpha.headSha : beta.headSha,
      isCommitAncestorOfRef: () => true,
      createDetachedCheckout: async (cwd, commitSha) => ({
        checkoutDir: cwd,
        commitSha,
      }),
      removeDetachedCheckout: async () => {},
      getRemoteBranchSha: async (cwd) =>
        cwd === alpha.root ? "1".repeat(40) : "2".repeat(40),
      deleteRemoteBranchAtTip: async (cwd, branch, expectedSha) => {
        deletedBranches.push({ cwd, branch, sha: expectedSha });
        return { deleted: true };
      },
    });

    const deliveredByMetadataKey = new Map<
      string,
      { channelId: string; messageTs: string; threadTs?: string }
    >();
    let notifyCalls = 0;

    // Boot 1: Slack receives the post on the wire, records it under clientMetadataKey,
    // but drops the HTTP response (throwing timeout -> uncertain outbox item).
    const faultyNotifier: NotificationPort = {
      notify: async (payload) => {
        notifyCalls++;
        if (payload.clientMetadataKey) {
          deliveredByMetadataKey.set(payload.clientMetadataKey, {
            channelId: payload.channel ?? "C_UNKNOWN",
            messageTs: `1732310000.00000${notifyCalls}`,
            threadTs: payload.threadTs,
          });
        }
        throw new Error("Simulated Slack response timeout");
      },
      getDeliveryStatus: async () => ({
        mode: "socket_connected",
        connected: true,
      }),
    };

    const makeExecutor = (db: Database.Database): HarvestExecutionPort => ({
      discoverPhasesAtCheckout: async () => ["phase-01"],
      verifyGatesAtCheckout: async () => ({
        passed: 1,
        failed: 0,
        total: 1,
        failedTaskIds: [],
      }),
      recordLearningAtCheckout: async (input) => {
        const existing = listRuns(input.featureId, input.projectId, db)[0];
        const linkedRunId =
          existing?.id ??
          recordRun(
            {
              feature_id: input.featureId,
              phase_id: input.phaseId ?? undefined,
              project_id: input.projectId,
              command: "ship",
              status: "merged",
              pr_number: input.prNumber ?? undefined,
              merge_commit_sha: input.mergeCommitSha ?? undefined,
            },
            db,
          );
        return {
          linkedRunId,
          forecastMissing: false,
          summaryText: `Harvest ${input.projectId} PR #${input.prNumber}`,
        };
      },
    });

    const makeWebhookBody = (
      repoSlug: string,
      trunk: string,
      mergeSha: string,
      headSha: string,
    ) =>
      Buffer.from(
        JSON.stringify(
          {
            action: "closed",
            repository: { full_name: repoSlug },
            pull_request: {
              number: 42,
              html_url: `https://github.com/${repoSlug}/pull/42`,
              merged: true,
              merge_commit_sha: mergeSha,
              merged_at: "2026-11-23T11:00:00.000Z",
              closed_at: "2026-11-23T11:00:00.000Z",
              base: { ref: trunk, repo: { full_name: repoSlug } },
              head: {
                ref: "feat/049-shared-phase-01",
                sha: headSha,
                repo: { full_name: repoSlug },
              },
            },
          },
          null,
          2,
        ),
      );

    let alphaHarvestOpId = "";
    let betaHarvestOpId = "";
    let alphaRunId: number | null = null;
    let betaRunId: number | null = null;

    const db1 = openDatabase({ dbPath });
    try {
      const registry1 = createSqliteProjectRegistryAdapter({ db: db1 });
      const ops1 = createSqliteOperationsStoreAdapter({ db: db1 });
      const server1 = await startServer(config, {
        handleSignals: false,
        projectRoot: alpha.root,
        pid: { writePid: vi.fn(), removePid: vi.fn() },
        ledger: { db: db1, projectId: alphaProject.projectId },
        registry: registry1,
        operationsStore: ops1,
        vcs: syntheticVcs,
        notifier: faultyNotifier,
        harvestExecutor: makeExecutor(db1),
        clock,
        heartbeatIntervalMs: null,
        transport: "hosted",
        runnerKind: "hosted",
        hostedAuth: createRecoveryHostedAuth(),
      });

      try {
        const alphaBody = makeWebhookBody(
          "org/alpha",
          "main",
          alpha.headSha,
          "1".repeat(40),
        );
        const betaBody = makeWebhookBody(
          "org/beta",
          "develop",
          beta.headSha,
          "2".repeat(40),
        );

        const alphaHook = await server1.inject({
          method: "POST",
          url: "/webhook/github",
          headers: {
            "content-type": "application/json",
            "x-github-event": "pull_request",
            "x-github-delivery": "delivery-alpha-42",
            "x-hub-signature-256": signWebhook(webhookSecret, alphaBody),
          },
          payload: alphaBody,
        });
        expect(alphaHook.statusCode).toBe(200);
        alphaHarvestOpId = alphaHook.json().operationId;

        const betaHook = await server1.inject({
          method: "POST",
          url: "/webhook/github",
          headers: {
            "content-type": "application/json",
            "x-github-event": "pull_request",
            "x-github-delivery": "delivery-beta-42",
            "x-hub-signature-256": signWebhook(webhookSecret, betaBody),
          },
          payload: betaBody,
        });
        expect(betaHook.statusCode).toBe(200);
        betaHarvestOpId = betaHook.json().operationId;
        expect(alphaHarvestOpId).not.toBe(betaHarvestOpId);

        // Wait for both harvests to hit uncertain Slack delivery
        await vi.waitFor(() => {
          expect(
            ops1.getOperationsStatus(alphaProject.projectId).delivery
              .uncertainCount,
          ).toBe(1);
          expect(
            ops1.getOperationsStatus(betaProject.projectId).delivery
              .uncertainCount,
          ).toBe(1);
        });

        // Verify /api/status and /api/health reflect uncertain deliveries and pending stages
        const alphaStatusRes = await server1.inject({
          method: "GET",
          url: `/api/status?projectId=${alphaProject.projectId}`,
          headers: { authorization: "Bearer alpha-op-token" },
        });
        expect(alphaStatusRes.statusCode).toBe(200);
        expect(alphaStatusRes.json().operations.delivery.uncertainCount).toBe(
          1,
        );
        expect(alphaStatusRes.json().operations.harvest.pendingStages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              operationId: alphaHarvestOpId,
              stage: "slack_delivery",
              status: "uncertain",
            }),
          ]),
        );

        for (const [project, token] of [
          [alphaProject, "Bearer alpha-op-token"],
          [betaProject, "Bearer beta-op-token"],
        ] as const) {
          const healthRes = await server1.inject({
            method: "GET",
            url: `/api/health?projectId=${project.projectId}`,
            headers: { authorization: token },
          });
          expect(healthRes.statusCode).toBe(200);
          const health1 = healthRes.json();
          expect(health1.daemonLiveness).toBe("alive");
          expect(health1.status).toBe("degraded");
          expect(health1.outbox.status).toBe("degraded");
          expect(health1.outbox.uncertainCount).toBe(1);
          expect(health1.telegram).toEqual({
            enabled: false,
            reason: "disabled_in_pilot",
          });
        }

        alphaRunId =
          listRuns("049-shared", alphaProject.projectId, db1)[0]?.id ?? null;
        betaRunId =
          listRuns("049-shared", betaProject.projectId, db1)[0]?.id ?? null;
        expect(alphaRunId).not.toBeNull();
        expect(betaRunId).not.toBeNull();
        expect(alphaRunId).not.toBe(betaRunId);
      } finally {
        await server1.close();
      }
    } finally {
      db1.close();
    }

    expect(notifyCalls).toBe(2);
    expect(deliveredByMetadataKey.size).toBe(2);

    // Boot 2: advance clock past harvest lease expiry and restart with working reconcileDelivery.
    // Reconciliation MUST find the previously delivered Slack receipts by clientMetadataKey
    // and MUST NOT call notify() again!
    nowMs += 10 * 60_000;
    const reconciledQueries: NotificationReconcileQuery[] = [];
    const recoveredNotifier: NotificationPort = {
      notify: vi
        .fn()
        .mockRejectedValue(
          new Error("Should not resend after found reconcile"),
        ),
      reconcileDelivery: async (
        query: NotificationReconcileQuery,
      ): Promise<NotificationReconcileResult> => {
        reconciledQueries.push(query);
        const found = deliveredByMetadataKey.get(query.clientMetadataKey);
        if (found) {
          return {
            status: "found",
            receipt: {
              delivered: true,
              channelId: found.channelId,
              messageTs: found.messageTs,
              threadTs: found.threadTs,
            },
          };
        }
        return { status: "confirmed_absent" };
      },
      getDeliveryStatus: async () => ({
        mode: "socket_connected",
        connected: true,
      }),
    };

    const db2 = openDatabase({ dbPath });
    try {
      const registry2 = createSqliteProjectRegistryAdapter({ db: db2 });
      const ops2 = createSqliteOperationsStoreAdapter({ db: db2 });
      const server2 = await startServer(config, {
        handleSignals: false,
        projectRoot: alpha.root,
        pid: { writePid: vi.fn(), removePid: vi.fn() },
        ledger: { db: db2, projectId: alphaProject.projectId },
        registry: registry2,
        operationsStore: ops2,
        vcs: syntheticVcs,
        notifier: recoveredNotifier,
        harvestExecutor: makeExecutor(db2),
        clock,
        heartbeatIntervalMs: null,
        transport: "hosted",
        runnerKind: "hosted",
        hostedAuth: createRecoveryHostedAuth(),
      });

      try {
        // Startup recovery reconciled both uncertain Slack sends without resending
        expect(reconciledQueries).toHaveLength(2);
        expect(recoveredNotifier.notify).not.toHaveBeenCalled();

        // Both repos completed harvest with preserved operation identity and run linkage
        const alphaStatus = ops2.getOperationsStatus(alphaProject.projectId);
        const betaStatus = ops2.getOperationsStatus(betaProject.projectId);
        expect(alphaStatus.delivery.uncertainCount).toBe(0);
        expect(alphaStatus.delivery.pendingCount).toBe(0);
        expect(alphaStatus.harvest.pendingOperations).toBe(0);
        expect(alphaStatus.harvest.lastMergeCommitSha).toBe(alpha.headSha);

        expect(betaStatus.delivery.uncertainCount).toBe(0);
        expect(betaStatus.delivery.pendingCount).toBe(0);
        expect(betaStatus.harvest.pendingOperations).toBe(0);
        expect(betaStatus.harvest.lastMergeCommitSha).toBe(beta.headSha);

        // Both branches cleaned up against their own repo roots & expected SHAs
        expect(deletedBranches).toEqual(
          expect.arrayContaining([
            {
              cwd: alpha.root,
              branch: "feat/049-shared-phase-01",
              sha: "1".repeat(40),
            },
            {
              cwd: beta.root,
              branch: "feat/049-shared-phase-01",
              sha: "2".repeat(40),
            },
          ]),
        );

        // Run linkage preserved without duplicate runs
        expect(
          listRuns("049-shared", alphaProject.projectId, db2),
        ).toHaveLength(1);
        expect(listRuns("049-shared", alphaProject.projectId, db2)[0]?.id).toBe(
          alphaRunId,
        );
        expect(listRuns("049-shared", betaProject.projectId, db2)).toHaveLength(
          1,
        );
        expect(listRuns("049-shared", betaProject.projectId, db2)[0]?.id).toBe(
          betaRunId,
        );

        // Health recovered to ok
        for (const [project, token] of [
          [alphaProject, "Bearer alpha-op-token"],
          [betaProject, "Bearer beta-op-token"],
        ] as const) {
          const healthRes = await server2.inject({
            method: "GET",
            url: `/api/health?projectId=${project.projectId}`,
            headers: { authorization: token },
          });
          expect(healthRes.statusCode).toBe(200);
          const health2 = healthRes.json();
          expect(health2.status).toBe("ok");
          expect(health2.daemonLiveness).toBe("alive");
          expect(health2.outbox.status).toBe("ok");
          expect(health2.harvest.status).toBe("ok");
        }
      } finally {
        await server2.close();
      }
    } finally {
      db2.close();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("cancels in-flight bounded notification transport cleanly on server shutdown without hanging", async () => {
    vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(true);
    const config = GwrkConfigSchema.parse({
      project: { name: "shutdown-cancel" },
      server: {
        host: "127.0.0.1",
        port: 0,
        githubWebhookSecret: webhookSecret,
      },
    });

    const db = openDatabase({ dbPath });
    try {
      const registry = createSqliteProjectRegistryAdapter({ db });
      const ops = createSqliteOperationsStoreAdapter({ db });
      let notifyStartedResolve!: () => void;
      const notifyStarted = new Promise<void>((resolve) => {
        notifyStartedResolve = resolve;
      });
      let releaseNotify!: () => void;
      const notifyGate = new Promise<void>((resolve) => {
        releaseNotify = resolve;
      });

      const server = await startServer(config, {
        handleSignals: false,
        projectRoot: alpha.root,
        pid: { writePid: vi.fn(), removePid: vi.fn() },
        ledger: { db, projectId: alphaProject.projectId },
        registry,
        operationsStore: ops,
        vcs: createSyntheticVcsPort({
          fetchBranch: () => {},
          resolveRefSha: () => alpha.headSha,
          isCommitAncestorOfRef: () => true,
          createDetachedCheckout: async (cwd, commitSha) => ({
            checkoutDir: cwd,
            commitSha,
          }),
          removeDetachedCheckout: async () => {},
          getRemoteBranchSha: async () => null,
          deleteRemoteBranchAtTip: async () => ({
            deleted: false,
            reason: "missing",
          }),
        }),
        harvestExecutor: {
          discoverPhasesAtCheckout: async () => ["phase-01"],
          verifyGatesAtCheckout: async () => ({
            passed: 1,
            failed: 0,
            total: 1,
            failedTaskIds: [],
          }),
          recordLearningAtCheckout: async () => ({
            linkedRunId: null,
            forecastMissing: false,
            summaryText: "Slow delivery",
          }),
        },
        notifier: {
          notify: async () => {
            notifyStartedResolve();
            await notifyGate;
            throw new Error("aborted on shutdown");
          },
          getDeliveryStatus: async () => ({
            mode: "socket_connected",
            connected: true,
          }),
        },
        heartbeatIntervalMs: null,
        transport: "hosted",
        runnerKind: "hosted",
      });

      const hookBody = Buffer.from(
        JSON.stringify({
          action: "closed",
          repository: { full_name: "org/alpha" },
          pull_request: {
            number: 88,
            html_url: "https://github.com/org/alpha/pull/88",
            merged: true,
            merge_commit_sha: alpha.headSha,
            merged_at: "2026-11-23T12:00:00.000Z",
            closed_at: "2026-11-23T12:00:00.000Z",
            base: { ref: "main", repo: { full_name: "org/alpha" } },
            head: {
              ref: "feat/049-cancel-phase-01",
              sha: "3".repeat(40),
              repo: { full_name: "org/alpha" },
            },
          },
        }),
      );

      const res = await server.inject({
        method: "POST",
        url: "/webhook/github",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "delivery-cancel-88",
          "x-hub-signature-256": signWebhook(webhookSecret, hookBody),
        },
        payload: hookBody,
      });
      expect(res.statusCode).toBe(200);
      await notifyStarted;

      const closePromise = server.close();
      releaseNotify();
      await closePromise;

      // Uncertain delivery preserved in SQLite for next restart
      expect(
        ops.getOperationsStatus(alphaProject.projectId).delivery.uncertainCount,
      ).toBe(1);
    } finally {
      db.close();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
