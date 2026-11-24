/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSyntheticNotificationPort,
  createSyntheticVcsPort,
} from "../../tests/helpers/synthetic-slack.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import {
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";
import { createProjectRoutingService } from "../application/project-routing/index.js";
import { getCompressionRecord, recordCompression } from "../db/compression.js";
import { getGateResults, recordGateResult } from "../db/gates.js";
import { openDatabase } from "../db/index.js";
import { listIssues, upsertIssue } from "../db/issues.js";
import { insertFeature, insertPhase } from "../db/plan.js";
import { finishRun, listRuns, startRun } from "../db/runs.js";
import {
  computeLegacyProjectIds,
  computeProjectId,
} from "../domain/project-id.js";
import type {
  DeliveryRecipient,
  EnrolledProject,
  SlackFeatureThread,
} from "../domain/project-registry.js";
import { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import { GwrkConfigSchema } from "../utils/config.js";
import { HarvestWatcher } from "./harvest-watcher.js";
import { startServer } from "./index.js";
import { SystemMonitor } from "./monitor.js";
import { SandboxManager } from "./sandbox.js";
import * as slackNotify from "./slack-notify.js";
import { presenceManager } from "./slack-presence.js";
import * as slackModule from "./slack.js";

vi.mock("../engine/ship-orchestrator.js", () => ({
  ShipOrchestrator: vi.fn(),
}));

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

function createRepo(root: string, trunk: string, remoteUrl: string): string {
  fs.mkdirSync(root, { recursive: true });
  const realRoot = fs.realpathSync(root);
  runGit(realRoot, "init", "--template=", `--initial-branch=${trunk}`);
  runGit(realRoot, "commit", "--no-gpg-sign", "--allow-empty", "-m", "init");
  runGit(realRoot, "remote", "add", "origin", remoteUrl);
  return realRoot;
}

describe("TR-024: two-repo isolation across identical feature IDs and synthetic Slack faults", () => {
  let workspaceDir: string;
  let alphaRoot: string;
  let betaRoot: string;
  let db: Database.Database;
  let registry: ProjectRegistryPort;
  let alphaProject: EnrolledProject;
  let betaProject: EnrolledProject;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    workspaceDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-two-repo-")),
    );
    alphaRoot = createRepo(
      path.join(workspaceDir, "alpha"),
      "main",
      "git@github.com:org/alpha.git",
    );
    betaRoot = createRepo(
      path.join(workspaceDir, "beta"),
      "develop",
      "git@github.com:org/beta.git",
    );

    vi.stubEnv("GWRK_HOME", path.join(workspaceDir, "isolated-home"));
    db = openDatabase({ dbPath: path.join(workspaceDir, "gwrk.db") });
    registry = createSqliteProjectRegistryAdapter({ db });

    const alphaFacts = {
      projectRoot: alphaRoot,
      remoteOriginUrl: "git@github.com:org/alpha.git",
      gitCommonDir: path.join(alphaRoot, ".git"),
    };
    const betaFacts = {
      projectRoot: betaRoot,
      remoteOriginUrl: "git@github.com:org/beta.git",
      gitCommonDir: path.join(betaRoot, ".git"),
    };

    const nowIso = "2026-11-23T00:00:00.000Z";
    alphaProject = registry.enrollProject({
      projectId: computeProjectId(alphaFacts),
      slug: "alpha",
      name: "Alpha",
      repoSlug: "org/alpha",
      trunkBranch: "main",
      localRoot: alphaRoot,
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local", "hosted"] },
      slack: {
        workspaceId: "T_SHARED",
        channelId: "C_SHARED",
        opsChannelId: "C_ALPHA_OPS",
        sharedChannel: true,
      },
      legacyProjectIds: computeLegacyProjectIds(alphaFacts),
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    betaProject = registry.enrollProject({
      projectId: computeProjectId(betaFacts),
      slug: "beta",
      name: "Beta",
      repoSlug: "org/beta",
      trunkBranch: "develop",
      localRoot: betaRoot,
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local", "hosted"] },
      slack: {
        workspaceId: "T_SHARED",
        channelId: "C_SHARED",
        opsChannelId: "C_BETA_OPS",
        sharedChannel: true,
      },
      legacyProjectIds: computeLegacyProjectIds(betaFacts),
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    registry.setRoleBinding({
      projectId: alphaProject.projectId,
      principalType: "google_sub",
      principalId: "iss:alpha-op",
      role: "operator",
    });
    registry.setRoleBinding({
      projectId: betaProject.projectId,
      principalType: "google_sub",
      principalId: "iss:beta-op",
      role: "operator",
    });
    registry.setRoleBinding({
      projectId: alphaProject.projectId,
      principalType: "slack_user",
      principalId: "T_SHARED:U_ALPHA",
      role: "maintainer",
    });
    registry.setRoleBinding({
      projectId: betaProject.projectId,
      principalType: "slack_user",
      principalId: "T_SHARED:U_BETA",
      role: "maintainer",
    });

    // Zero live network calls allowed across the entire isolation suite.
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected live network call"));
    presenceManager.stop();
  });

  afterEach(() => {
    presenceManager.stop();
    registry.close();
    db.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("isolates SQLite reads, writes, legacy aliases, plans, gates, issues and compression for identical feature IDs", () => {
    const featureId = "048-shared";
    const phaseId = "phase-01";

    insertFeature(
      {
        id: featureId,
        name: "Alpha Feature",
        status: "IN_PROGRESS",
        sp_total: 5,
      },
      alphaProject.projectId,
      db,
    );
    insertFeature(
      { id: featureId, name: "Beta Feature", status: "PLANNED", sp_total: 8 },
      betaProject.projectId,
      db,
    );
    insertPhase(
      {
        id: `${featureId}/${phaseId}`,
        feature_id: featureId,
        name: "Alpha P1",
        status: "IN_PROGRESS",
        health: "GREEN",
        sp_estimate: 5,
        seq: 1,
      },
      alphaProject.projectId,
      db,
    );
    insertPhase(
      {
        id: `${featureId}/${phaseId}`,
        feature_id: featureId,
        name: "Beta P1",
        status: "PENDING",
        health: "GREEN",
        sp_estimate: 8,
        seq: 1,
      },
      betaProject.projectId,
      db,
    );
    recordGateResult(
      {
        feature_id: featureId,
        phase_id: phaseId,
        task_id: "T001",
        gate_script: "gates/T001-gate.sh",
        passed: 1,
        exit_code: 0,
        output: "alpha pass",
      },
      alphaProject.projectId,
      db,
    );
    recordGateResult(
      {
        feature_id: featureId,
        phase_id: phaseId,
        task_id: "T001",
        gate_script: "gates/T001-gate.sh",
        passed: 0,
        exit_code: 1,
        output: "beta fail",
      },
      betaProject.projectId,
      db,
    );
    upsertIssue(
      {
        issue_number: 101,
        feature_id: featureId,
        title: "Alpha issue",
        body: null,
        state: "open",
        html_url: "https://github.com/org/alpha/issues/101",
        created_at: "2026-11-23T00:00:00.000Z",
        author: "alice",
      },
      alphaProject.projectId,
      db,
    );
    upsertIssue(
      {
        issue_number: 101,
        feature_id: featureId,
        title: "Beta issue",
        body: null,
        state: "closed",
        html_url: "https://github.com/org/beta/issues/101",
        created_at: "2026-11-23T00:00:00.000Z",
        author: "bob",
      },
      betaProject.projectId,
      db,
    );
    const alphaRunId = startRun(
      {
        feature_id: featureId,
        phase_id: phaseId,
        project_id: alphaProject.projectId,
        command: "gwrk ship",
        agent_backend: "claude",
      },
      db,
    );
    finishRun(alphaRunId, { exit_code: 0, duration_s: 10 }, db);
    recordCompression(
      {
        featureId,
        phaseId,
        forecast: {
          estimatedHours: 8,
          estimatedDays: 1,
          storyPoints: 5,
        },
        actuals: {
          activeCodingMinutes: 60,
          deliveryWindowHours: 2,
          firstImplCommit: "2026-11-23T00:00:00.000Z",
          prMergedAt: "2026-11-23T01:00:00.000Z",
          sessionCount: 1,
        },
        compression: {
          pointCompression: 8,
          totalCompression: 4,
          dormancyDays: 0,
        },
      },
      alphaProject.projectId,
      db,
    );

    expect(
      getGateResults(featureId, phaseId, alphaProject.projectId, db)[0]?.passed,
    ).toBe(1);
    expect(
      getGateResults(featureId, phaseId, betaProject.projectId, db)[0]?.passed,
    ).toBe(0);
    expect(
      listIssues(featureId, alphaProject.projectId, db).map((i) => i.title),
    ).toEqual(["Alpha issue"]);
    expect(
      listIssues(featureId, betaProject.projectId, db).map((i) => i.title),
    ).toEqual(["Beta issue"]);
    expect(listRuns(featureId, alphaProject.projectId, db)).toHaveLength(1);
    expect(listRuns(featureId, betaProject.projectId, db)).toHaveLength(0);
    expect(
      getCompressionRecord(featureId, phaseId, alphaProject.projectId, db),
    ).toBeDefined();
    expect(
      getCompressionRecord(featureId, phaseId, betaProject.projectId, db),
    ).toBeUndefined();

    // Legacy alias resolves Alpha without touching Beta
    const alphaAlias = alphaProject.legacyProjectIds[0];
    expect(registry.getProject(alphaAlias)?.projectId).toBe(
      alphaProject.projectId,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("isolates hosted HTTP dispatch, status, notify and health across two enrolled repos with matching feature IDs", async () => {
    vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(true);
    vi.spyOn(HarvestWatcher.prototype, "runCheck").mockResolvedValue(undefined);
    vi.spyOn(SandboxManager.prototype, "pruneSandboxes").mockResolvedValue(
      undefined,
    );
    vi.spyOn(slackModule, "getSlackApp").mockReturnValue(null);
    vi.spyOn(slackModule, "startSlackApp").mockResolvedValue(undefined);
    const notifySpy = vi
      .spyOn(slackNotify, "notifySlack")
      .mockResolvedValue({ delivered: true });
    vi.mocked(ShipOrchestrator).mockImplementation(
      () =>
        ({
          run: async () => 0,
          getResult: () => ({}),
        }) as unknown as ShipOrchestrator,
    );

    const notifier = createSyntheticNotificationPort();
    const vcs = createSyntheticVcsPort();
    const routingService = createProjectRoutingService({
      registry,
      notificationPort: notifier,
    });
    const config = GwrkConfigSchema.parse({
      project: { name: "multi-repo" },
      server: { host: "127.0.0.1", port: 0 },
    });

    const server = await startServer(config, {
      handleSignals: false,
      projectRoot: alphaRoot,
      pid: { writePid: vi.fn(), removePid: vi.fn() },
      ledger: { db, projectId: alphaProject.projectId },
      registry,
      routingService,
      vcs,
      notifier,
      transport: "hosted",
      runnerKind: "hosted",
      resolvePrincipal: (req) => {
        const sub = req.headers["x-verified-test-sub"];
        return typeof sub === "string"
          ? { principalType: "google_sub", principalId: sub }
          : undefined;
      },
    });

    try {
      // Unauthenticated hosted requests (even with spoofed forwarded headers) are denied
      const unauthDispatch = await server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: {
          "x-forwarded-user": "iss:alpha-op",
          "x-forwarded-for": "127.0.0.1",
        },
        payload: {
          projectId: alphaProject.projectId,
          featureId: "048-shared",
          phaseId: "phase-01",
        },
      });
      expect(unauthDispatch.statusCode).toBe(401);
      expect(unauthDispatch.json().code).toBe("REMOTE_AUTH_REQUIRED");

      // Alpha operator cannot dispatch Beta
      const crossDispatch = await server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { "x-verified-test-sub": "iss:alpha-op" },
        payload: {
          projectId: betaProject.projectId,
          featureId: "048-shared",
          phaseId: "phase-01",
        },
      });
      expect(crossDispatch.statusCode).toBe(403);
      expect(crossDispatch.json().code).toBe("UNAUTHORIZED_USER");

      // Both operators dispatch identical (048-shared, phase-01) concurrently into separate trunks & roots
      const alphaRes = await server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { "x-verified-test-sub": "iss:alpha-op" },
        payload: {
          projectId: "alpha",
          featureId: "048-shared",
          phaseId: "phase-01",
        },
      });
      expect(alphaRes.statusCode).toBe(201);
      const alphaReceipt = alphaRes.json();
      const operations = createSqliteOperationsStoreAdapter({ db });
      const alphaRecord = operations.getDispatchOperation({
        projectId: alphaProject.projectId,
        featureId: "048-shared",
        phaseId: "phase-01",
      });
      expect(alphaReceipt.operationId).toBe(alphaRecord?.operationId);
      expect(alphaRecord).not.toBeNull();
      expect(alphaRecord.projectId).toBe(alphaProject.projectId);
      expect(alphaRecord.trunkBranch).toBe("main");
      expect(registry.getProject(alphaRecord.projectId)?.localRoot).toBe(
        alphaRoot,
      );
      expect(alphaRecord.recipient).toEqual({
        projectId: alphaProject.projectId,
        surface: "http",
      });

      const betaRes = await server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { "x-verified-test-sub": "iss:beta-op" },
        payload: {
          projectId: "beta",
          featureId: "048-shared",
          phaseId: "phase-01",
          recipient: null,
        },
      });
      expect(betaRes.statusCode).toBe(201);
      const betaReceipt = betaRes.json();
      const betaRecord = operations.getDispatchOperation({
        projectId: betaProject.projectId,
        featureId: "048-shared",
        phaseId: "phase-01",
      });
      expect(betaReceipt.operationId).toBe(betaRecord?.operationId);
      expect(betaRecord).not.toBeNull();
      expect(betaRecord.projectId).toBe(betaProject.projectId);
      expect(betaRecord.trunkBranch).toBe("develop");
      expect(registry.getProject(betaRecord.projectId)?.localRoot).toBe(
        betaRoot,
      );
      // Explicit null recipient stays distinct from omitted recipient
      expect(betaRecord.recipient).toBeNull();
      expect(betaRecord.operationId).not.toBe(alphaRecord.operationId);

      // Scoped queue and status views stay strictly isolated
      const alphaStatus = await server.inject({
        method: "GET",
        url: `/api/status?projectId=${alphaProject.projectId}`,
        headers: { "x-verified-test-sub": "iss:alpha-op" },
      });
      expect(alphaStatus.statusCode).toBe(200);
      expect(alphaStatus.json().dispatch.queueDepth).toBe(1);

      const alphaQueue = await server.inject({
        method: "GET",
        url: `/api/dispatch/queue?projectId=${alphaProject.projectId}`,
        headers: { "x-verified-test-sub": "iss:alpha-op" },
      });
      expect(alphaQueue.statusCode).toBe(200);
      expect(alphaQueue.json().queued).toHaveLength(1);
      expect(alphaQueue.json().queued[0].projectId).toBe(
        alphaProject.projectId,
      );

      // Cross-project notify recipient mismatch fails closed
      const badNotify = await server.inject({
        method: "POST",
        url: "/api/notify",
        headers: { "x-verified-test-sub": "iss:alpha-op" },
        payload: {
          type: "done_done",
          projectId: alphaProject.projectId,
          feature: "048-shared",
          recipient: {
            projectId: betaProject.projectId,
            surface: "slack",
            workspaceId: "T_SHARED",
            channelId: "C_SHARED",
          },
        },
      });
      expect(badNotify.statusCode).toBe(403);
      expect(notifySpy).not.toHaveBeenCalled();

      // Health reports both projects ready, Slack connected, Telegram disabled
      const healthRes = await server.inject({
        method: "GET",
        url: "/api/health",
      });
      expect(healthRes.statusCode).toBe(200);
      const health = healthRes.json();
      expect(health.daemonLiveness).toBe("alive");
      expect(health.projectReadiness).toMatchObject({
        status: "ready",
        readyCount: 2,
        totalCount: 2,
      });
      expect(health.telegram).toEqual({
        enabled: false,
        reason: "disabled_in_pilot",
      });
    } finally {
      await server.close();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("isolates synthetic Slack routing, feature threads, replay receipts and away presence queues with zero live calls", async () => {
    const sent: Array<{
      projectId?: string;
      channel?: string;
      threadTs?: string;
      text: string;
    }> = [];
    let nextTs = 100;
    const routingService = createProjectRoutingService({
      registry,
      notificationPort: {
        async notify(payload) {
          sent.push({
            projectId: payload.projectId,
            channel: payload.channel,
            threadTs: payload.threadTs,
            text: payload.text,
          });
          const ts = `1732000000.000${nextTs++}`;
          return {
            delivered: true,
            channelId: payload.channel,
            messageTs: ts,
            threadTs: payload.threadTs ?? ts,
          };
        },
      },
    });

    // Synthetic Slack faults: wrong workspace, wrong channel, ambiguous shared channel, unauthorized user
    expect(
      routingService.authorizeCommand({
        workspaceId: "T_WRONG",
        channelId: "C_SHARED",
        isDirectMessage: false,
        actorUserId: "U_ALPHA",
        requiredAccess: "read",
      }),
    ).toMatchObject({ ok: false, code: "UNBOUND_WORKSPACE" });

    expect(
      routingService.authorizeCommand({
        workspaceId: "T_SHARED",
        channelId: "C_UNKNOWN",
        isDirectMessage: false,
        actorUserId: "U_ALPHA",
        requiredAccess: "read",
      }),
    ).toMatchObject({ ok: false, code: "UNBOUND_CHANNEL" });

    expect(
      routingService.authorizeCommand({
        workspaceId: "T_SHARED",
        channelId: "C_SHARED",
        isDirectMessage: false,
        actorUserId: "U_ALPHA",
        requiredAccess: "read",
      }),
    ).toMatchObject({
      ok: false,
      code: "AMBIGUOUS_PROJECT_SELECTION",
      candidateSlugs: ["alpha", "beta"],
    });

    expect(
      routingService.authorizeCommand({
        workspaceId: "T_SHARED",
        channelId: "C_SHARED",
        isDirectMessage: false,
        actorUserId: "U_ALPHA",
        requestedProject: "beta",
        requiredAccess: "operate",
      }),
    ).toMatchObject({ ok: false, code: "UNAUTHORIZED_USER" });

    // Distinct feature threads for identical feature ID "048-shared"
    const alphaDelivery = await routingService.deliverProjectEvent({
      projectId: alphaProject.projectId,
      featureId: "048-shared",
      eventType: "phase_start",
      message: { text: "Alpha started" },
      nowIso: "2026-11-23T01:00:00.000Z",
    });
    const betaDelivery = await routingService.deliverProjectEvent({
      projectId: betaProject.projectId,
      featureId: "048-shared",
      eventType: "phase_start",
      message: { text: "Beta started" },
      nowIso: "2026-11-23T01:00:01.000Z",
    });
    const alphaThread = registry.getFeatureThread(
      alphaProject.projectId,
      "048-shared",
    ) as SlackFeatureThread;
    const betaThread = registry.getFeatureThread(
      betaProject.projectId,
      "048-shared",
    ) as SlackFeatureThread;
    expect(alphaThread.rootTs).toBe(alphaDelivery.messageTs);
    expect(betaThread.rootTs).toBe(betaDelivery.messageTs);
    expect(alphaThread.rootTs).not.toBe(betaThread.rootTs);

    // Cross-project thread mismatch on click is rejected
    expect(
      routingService.authorizeAndClaimAction({
        workspaceId: "T_SHARED",
        channelId: "C_SHARED",
        isDirectMessage: false,
        actorUserId: "U_ALPHA",
        actionId: "approve_spec",
        payloadProjectId: alphaProject.projectId,
        featureId: "048-shared",
        threadTs: betaThread.rootTs,
        messageTs: betaThread.rootTs,
        requiredAccess: "maintain",
        nowIso: "2026-11-23T01:01:00.000Z",
      }),
    ).toMatchObject({ ok: false, code: "THREAD_PROJECT_MISMATCH" });

    // Authorized action claim succeeds once; replay is denied; Beta claim stays independent
    const firstAlphaClaim = routingService.authorizeAndClaimAction({
      workspaceId: "T_SHARED",
      channelId: "C_SHARED",
      isDirectMessage: false,
      actorUserId: "U_ALPHA",
      actionId: "approve_spec",
      payloadProjectId: alphaProject.projectId,
      featureId: "048-shared",
      threadTs: alphaThread.rootTs,
      messageTs: alphaThread.rootTs,
      requiredAccess: "maintain",
      nowIso: "2026-11-23T01:02:00.000Z",
    });
    expect(firstAlphaClaim.ok).toBe(true);

    const replayAlphaClaim = routingService.authorizeAndClaimAction({
      workspaceId: "T_SHARED",
      channelId: "C_SHARED",
      isDirectMessage: false,
      actorUserId: "U_ALPHA",
      actionId: "approve_spec",
      payloadProjectId: alphaProject.projectId,
      featureId: "048-shared",
      threadTs: alphaThread.rootTs,
      messageTs: alphaThread.rootTs,
      requiredAccess: "maintain",
      nowIso: "2026-11-23T01:02:01.000Z",
    });
    expect(replayAlphaClaim).toMatchObject({
      ok: false,
      code: "ACTION_REPLAYED",
    });

    const firstBetaClaim = routingService.authorizeAndClaimAction({
      workspaceId: "T_SHARED",
      channelId: "C_SHARED",
      isDirectMessage: false,
      actorUserId: "U_BETA",
      actionId: "approve_spec",
      payloadProjectId: betaProject.projectId,
      featureId: "048-shared",
      threadTs: betaThread.rootTs,
      messageTs: betaThread.rootTs,
      requiredAccess: "maintain",
      nowIso: "2026-11-23T01:02:02.000Z",
    });
    expect(firstBetaClaim.ok).toBe(true);

    // Away presence queues stay isolated per (projectId, recipientUserId)
    const sendSpy = vi
      .spyOn(slackNotify, "sendSlackMessage")
      .mockResolvedValue({ delivered: true });
    presenceManager.setUserPresence("U_ALPHA", "away");
    presenceManager.setUserPresence("U_BETA", "away");

    const alphaRecipient: DeliveryRecipient = {
      projectId: alphaProject.projectId,
      surface: "slack",
      workspaceId: "T_SHARED",
      channelId: "C_SHARED",
      threadTs: alphaThread.rootTs,
      actorUserId: "U_ALPHA",
    };
    const betaRecipient: DeliveryRecipient = {
      projectId: betaProject.projectId,
      surface: "slack",
      workspaceId: "T_SHARED",
      channelId: "C_SHARED",
      threadTs: betaThread.rootTs,
      actorUserId: "U_BETA",
    };

    await presenceManager.handleNotification(
      {
        type: "review_ready",
        feature: "048-shared",
        projectId: alphaProject.projectId,
        recipient: alphaRecipient,
        payload: {},
        timestamp: "2026-11-23T01:03:00.000Z",
      },
      {
        text: "Alpha review ready",
        channel: "C_SHARED",
        thread_ts: alphaThread.rootTs,
      },
      {
        projectId: alphaProject.projectId,
        recipient: alphaRecipient,
        registry,
      },
    );
    await presenceManager.handleNotification(
      {
        type: "review_ready",
        feature: "048-shared",
        projectId: betaProject.projectId,
        recipient: betaRecipient,
        payload: {},
        timestamp: "2026-11-23T01:03:01.000Z",
      },
      {
        text: "Beta review ready",
        channel: "C_SHARED",
        thread_ts: betaThread.rootTs,
      },
      { projectId: betaProject.projectId, recipient: betaRecipient, registry },
    );

    expect(
      presenceManager.getScopedQueue(alphaProject.projectId, "U_ALPHA")?.events,
    ).toHaveLength(1);
    expect(
      presenceManager.getScopedQueue(betaProject.projectId, "U_BETA")?.events,
    ).toHaveLength(1);

    await presenceManager.flushUserQueues("U_ALPHA");
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: alphaThread.rootTs }),
      expect.objectContaining({ projectId: alphaProject.projectId }),
    );
    expect(
      presenceManager.getScopedQueue(betaProject.projectId, "U_BETA")?.events,
    ).toHaveLength(1);

    // Harvest watcher keeps harvest receipts and thread recipients distinct for identical PR branch names
    const harvested: Array<{
      projectRoot: string;
      projectId: string;
      threadTs?: string;
    }> = [];
    const watcher = new HarvestWatcher(
      GwrkConfigSchema.parse({ project: { name: "multi-repo" } }),
      null,
      alphaRoot,
      { db, projectId: alphaProject.projectId },
      undefined,
      {
        registry,
        github: {
          verifyWebhookSignature: () => false,
          getPullRequest: async () => null,
          listTerminalPullRequests: async ({ cwd, repoSlug, baseBranch }) => [
            {
              repoSlug,
              headRepoSlug: repoSlug,
              prNumber: cwd === alphaRoot ? 11 : 22,
              prUrl: `https://github.com/${repoSlug}/pull/${cwd === alphaRoot ? 11 : 22}`,
              headBranch: "feat/048-shared-phase-02",
              baseBranch,
              state: "MERGED",
              merged: true,
              headSha: null,
              mergedAt: "2026-11-23T02:00:00.000Z",
              closedAt: "2026-11-23T02:00:00.000Z",
              mergeCommitSha: "a".repeat(40),
            },
          ],
        },
        vcs: createSyntheticVcsPort({
          fetchBranch: () => {},
          resolveRefSha: () => "a".repeat(40),
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
        executor: {
          discoverPhasesAtCheckout: async () => ["phase-02"],
          verifyGatesAtCheckout: async () => ({
            passed: 1,
            failed: 0,
            total: 1,
            failedTaskIds: [],
          }),
          recordLearningAtCheckout: async ({ checkoutDir, projectId }) => {
            harvested.push({ projectRoot: checkoutDir, projectId });
            return {
              linkedRunId: null,
              forecastMissing: false,
              summaryText: "Synthetic harvest",
            };
          },
        },
        notifier: {
          notify: async (payload) => {
            const record = harvested.find(
              ({ projectId }) => projectId === payload.projectId,
            );
            if (record) record.threadTs = payload.recipient?.threadTs;
            return { delivered: true };
          },
        },
      },
    );
    await watcher.runCheck();
    expect(harvested).toEqual([
      {
        projectRoot: alphaRoot,
        projectId: alphaProject.projectId,
        threadTs: alphaThread.rootTs,
      },
      {
        projectRoot: betaRoot,
        projectId: betaProject.projectId,
        threadTs: betaThread.rootTs,
      },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("TR-024 review regression (T040): executes unthrottled two-repo dispatches in each project's own worktree root and cleans up without error", async () => {
    vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(false);
    vi.spyOn(HarvestWatcher.prototype, "runCheck").mockResolvedValue(undefined);
    vi.spyOn(slackModule, "getSlackApp").mockReturnValue(null);
    vi.spyOn(slackModule, "startSlackApp").mockResolvedValue(undefined);
    vi.spyOn(slackNotify, "notifySlack").mockResolvedValue({ delivered: true });

    const observedCwds: Array<{ stateRoot: string; cwd: string }> = [];
    vi.mocked(ShipOrchestrator).mockImplementation((opts) => {
      observedCwds.push({
        stateRoot: opts.stateRoot ?? "",
        cwd: opts.cwd ?? "",
      });
      return {
        run: async () => 0,
        getResult: () => ({}),
      } as unknown as ShipOrchestrator;
    });

    const notifier = createSyntheticNotificationPort();
    const vcs = createSyntheticVcsPort();
    const routingService = createProjectRoutingService({
      registry,
      notificationPort: notifier,
    });
    const config = GwrkConfigSchema.parse({
      project: { name: "multi-repo" },
      server: { host: "127.0.0.1", port: 0 },
    });

    const server = await startServer(config, {
      handleSignals: false,
      projectRoot: alphaRoot,
      pid: { writePid: vi.fn(), removePid: vi.fn() },
      ledger: { db, projectId: alphaProject.projectId },
      registry,
      routingService,
      vcs,
      notifier,
      transport: "hosted",
      runnerKind: "hosted",
      resolvePrincipal: (req) => {
        const sub = req.headers["x-verified-test-sub"];
        return typeof sub === "string"
          ? { principalType: "google_sub", principalId: sub }
          : undefined;
      },
    });

    let closeError: unknown;
    try {
      const alphaRes = await server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { "x-verified-test-sub": "iss:alpha-op" },
        payload: {
          projectId: "alpha",
          featureId: "048-shared",
          phaseId: "phase-01",
        },
      });
      expect(alphaRes.statusCode).toBe(201);

      const betaRes = await server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { "x-verified-test-sub": "iss:beta-op" },
        payload: {
          projectId: "beta",
          featureId: "048-shared",
          phaseId: "phase-01",
        },
      });
      expect(betaRes.statusCode).toBe(201);

      await vi.waitFor(async () => {
        const aStatus = await server.inject({
          method: "GET",
          url: `/api/dispatch/048-shared/phase-01?projectId=${alphaProject.projectId}`,
          headers: { "x-verified-test-sub": "iss:alpha-op" },
        });
        const bStatus = await server.inject({
          method: "GET",
          url: `/api/dispatch/048-shared/phase-01?projectId=${betaProject.projectId}`,
          headers: { "x-verified-test-sub": "iss:beta-op" },
        });
        expect(aStatus.json().status).toBe("completed");
        expect(bStatus.json().status).toBe("completed");
      });

      const alphaRun = observedCwds.find((c) => c.stateRoot === alphaRoot);
      const betaRun = observedCwds.find((c) => c.stateRoot === betaRoot);
      expect(alphaRun?.cwd.startsWith(`${alphaRoot}${path.sep}`)).toBe(true);
      expect(betaRun?.cwd.startsWith(`${betaRoot}${path.sep}`)).toBe(true);

      expect(
        runGit(alphaRoot, "worktree", "list", "--porcelain").match(
          /^worktree /gm,
        ),
      ).toHaveLength(1);
      expect(
        runGit(betaRoot, "worktree", "list", "--porcelain").match(
          /^worktree /gm,
        ),
      ).toHaveLength(1);
    } finally {
      try {
        await server.close();
      } catch (err) {
        closeError = err;
      }
    }
    expect(closeError).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("TR-024 review regression (T040): resolves localDefaultProjectId when startServer receives a symlinked projectRoot", async () => {
    vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(true);
    vi.spyOn(HarvestWatcher.prototype, "runCheck").mockResolvedValue(undefined);
    vi.spyOn(SandboxManager.prototype, "pruneSandboxes").mockResolvedValue(
      undefined,
    );
    vi.spyOn(slackModule, "getSlackApp").mockReturnValue(null);
    vi.spyOn(slackModule, "startSlackApp").mockResolvedValue(undefined);

    const alphaLink = path.join(workspaceDir, "alpha-symlink");
    fs.symlinkSync(alphaRoot, alphaLink);

    const notifier = createSyntheticNotificationPort();
    const vcs = createSyntheticVcsPort();
    const routingService = createProjectRoutingService({
      registry,
      notificationPort: notifier,
    });
    const config = GwrkConfigSchema.parse({
      project: { name: "alpha" },
      server: { host: "127.0.0.1", port: 0 },
    });

    const server = await startServer(config, {
      handleSignals: false,
      projectRoot: alphaLink,
      pid: { writePid: vi.fn(), removePid: vi.fn() },
      ledger: { db, projectId: alphaProject.projectId },
      registry,
      routingService,
      vcs,
      notifier,
      transport: "trusted_local",
    });

    try {
      const statusRes = await server.inject({
        method: "GET",
        url: "/api/status",
      });
      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.json().projectId).toBe(alphaProject.projectId);

      const dispatchRes = await server.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: {
          featureId: "048-shared",
          phaseId: "phase-01",
        },
      });
      expect(dispatchRes.statusCode).toBe(201);
      expect(dispatchRes.json().projectId).toBe(alphaProject.projectId);
    } finally {
      await server.close();
    }
  });
});
