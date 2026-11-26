/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App } from "@slack/bolt";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ServerFixture,
  createServerFixture,
} from "../../tests/helpers/server-fixture.js";
import {
  SYNTHETIC_CHANNEL_ALPHA,
  SYNTHETIC_PROJECT_ALPHA,
  SYNTHETIC_ROLES,
  SYNTHETIC_THREAD_ALPHA,
  SYNTHETIC_USER_MAINTAINER,
  SYNTHETIC_WORKSPACE_ID,
} from "../../tests/helpers/synthetic-slack.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import { resolveProjectId } from "../adapters/git/project-id.js";
import {
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";
import { createProjectRoutingService } from "../application/project-routing/index.js";
import { openDatabase } from "../db/index.js";
import { GwrkConfigSchema } from "../utils/config.js";
import { DispatchQueue } from "./dispatch.js";
import { GitManager } from "./git-manager.js";
import { HarvestWatcher } from "./harvest-watcher.js";
import { ScopedSandboxManager } from "./index.js";
import { SystemMonitor } from "./monitor.js";
import { SandboxManager } from "./sandbox.js";
import { registerSlackActions } from "./slack-actions.js";
import { handleSlashCommand } from "./slack-commands.js";

function initTestRepo(root: string, repoSlug?: string): string {
  mkdirSync(root, { recursive: true });
  const opts = { cwd: root, stdio: "ignore" as const, timeout: 5_000 };
  execFileSync("git", ["init", "--quiet", "--initial-branch=develop"], opts);
  if (repoSlug) {
    execFileSync(
      "git",
      ["remote", "add", "origin", `https://github.com/${repoSlug}.git`],
      opts,
    );
  }
  return realpathSync(root);
}

describe("durable HTTP ingress", () => {
  let fixture: ServerFixture | undefined;
  const tempDirs: string[] = [];

  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("commits a project-scoped operation before acknowledgement and replays its receipt", async () => {
    fixture = await createServerFixture("routes", {
      routes: ["dispatch"],
      pauseDispatch: true,
    });
    const projectId = resolveProjectId(fixture.projectRoot);
    createSqliteProjectRegistryAdapter({ db: fixture.db }).enrollProject({
      projectId,
      slug: fixture.projectId.toLowerCase(),
      name: "Synthetic ingress project",
      repoSlug: null,
      trunkBranch: "develop",
      localRoot: fixture.projectRoot,
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local"] },
      slack: null,
      legacyProjectIds: [],
      createdAt: "2026-11-23T12:00:00.000Z",
      updatedAt: "2026-11-23T12:00:00.000Z",
    });
    const payload = {
      projectId,
      featureId: "049-durable-ingress",
      phaseId: "phase-01",
      backend: "agy",
    };
    const first = await fixture.app.inject({
      method: "POST",
      url: "/api/dispatch",
      payload,
    });
    expect(first.statusCode).toBe(201);
    const store = createSqliteOperationsStoreAdapter({ db: fixture.db });
    const operation = store.getDispatchOperation(payload);
    expect(
      operation,
      "acknowledged work must already exist in SQLite",
    ).not.toBeNull();
    expect(first.json().operationId).toBe(operation?.operationId);
    expect(first.json().projectId).toBe(projectId);
    expect(operation?.recipient).toEqual({
      projectId,
      surface: "http",
    });
    expect(first.json().recipient).toEqual({
      projectId,
      surface: "http",
    });
    expect(
      store.getDispatchOperation({
        ...payload,
        projectId: "unrelated-project",
      }),
    ).toBeNull();
    const replay = await fixture.app.inject({
      method: "POST",
      url: "/api/dispatch",
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().operationId).toBe(operation?.operationId);
    expect(replay.json().deduplicated).toBe(true);

    // Project-scoped GET must return 404 for another project rather than leaking the default project's record
    const crossProjectLookup = await fixture.app.inject({
      method: "GET",
      url: `/api/dispatch/${payload.featureId}/${payload.phaseId}?projectId=unrelated-project`,
    });
    expect(crossProjectLookup.statusCode).toBe(404);

    const suppressed = await fixture.app.inject({
      method: "POST",
      url: "/api/dispatch",
      payload: { ...payload, phaseId: "phase-02", recipient: null },
    });
    expect(suppressed.statusCode).toBe(201);
    expect(suppressed.json().recipient).toBeNull();
    expect(
      store.getDispatchOperation({ ...payload, phaseId: "phase-02" })
        ?.recipient,
    ).toBeNull();
  });

  it("rejects unknown explicit projectId and cross-project recipient without persisting", async () => {
    fixture = await createServerFixture("routes", {
      routes: ["dispatch"],
      pauseDispatch: true,
    });
    const projectId = resolveProjectId(fixture.projectRoot);
    createSqliteProjectRegistryAdapter({ db: fixture.db }).enrollProject({
      projectId,
      slug: fixture.projectId.toLowerCase(),
      name: "Synthetic ingress project",
      repoSlug: null,
      trunkBranch: "develop",
      localRoot: fixture.projectRoot,
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local"] },
      slack: null,
      legacyProjectIds: [],
      createdAt: "2026-11-23T12:00:00.000Z",
      updatedAt: "2026-11-23T12:00:00.000Z",
    });

    const unknownProject = await fixture.app.inject({
      method: "POST",
      url: "/api/dispatch",
      payload: {
        projectId: "not-enrolled-project",
        featureId: "049-durable-ingress",
        phaseId: "phase-01",
      },
    });
    expect(unknownProject.statusCode).toBe(404);

    const badRecipient = await fixture.app.inject({
      method: "POST",
      url: "/api/dispatch",
      payload: {
        projectId,
        featureId: "049-durable-ingress",
        phaseId: "phase-01",
        recipient: {
          projectId: "other-project",
          surface: "http",
        },
      },
    });
    expect(badRecipient.statusCode).toBe(400);

    const store = createSqliteOperationsStoreAdapter({ db: fixture.db });
    expect(
      store.getDispatchOperation({
        projectId,
        featureId: "049-durable-ingress",
        phaseId: "phase-01",
      }),
    ).toBeNull();
  });

  it("persists Slack /gwrk dispatch and /gwrk ship receipts with stable operationId before acknowledgement", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "gwrk-durable-slack-cmd-"));
    tempDirs.push(tempRoot);
    const repoRoot = initTestRepo(
      join(tempRoot, "alpha"),
      SYNTHETIC_PROJECT_ALPHA.repoSlug ?? undefined,
    );
    const featureId = SYNTHETIC_THREAD_ALPHA.featureId;
    mkdirSync(join(repoRoot, "specs", featureId), { recursive: true });

    const db = openDatabase({ dbPath: join(tempRoot, "gwrk.db") });
    try {
      const projectId = resolveProjectId(repoRoot);
      const registry = createSqliteProjectRegistryAdapter({ db });
      const store = createSqliteOperationsStoreAdapter({ db });
      registry.enrollProject({
        ...SYNTHETIC_PROJECT_ALPHA,
        projectId,
        localRoot: repoRoot,
        legacyProjectIds: [],
      });
      for (const role of SYNTHETIC_ROLES) {
        if (role.projectId === SYNTHETIC_PROJECT_ALPHA.projectId) {
          registry.setRoleBinding({ ...role, projectId });
        }
      }
      registry.bindFeatureThread({
        ...SYNTHETIC_THREAD_ALPHA,
        projectId,
      });

      const config = GwrkConfigSchema.parse({
        project: { name: "alpha" },
        agents: { implement: "agy" },
      });
      const monitor = new SystemMonitor(config);
      const sandbox = new SandboxManager(repoRoot);
      const queue = new DispatchQueue(config, monitor, sandbox, repoRoot, {
        db,
        projectId,
      });
      queue.pause();

      const routingService = createProjectRoutingService({ registry });
      const context = {
        userId: SYNTHETIC_USER_MAINTAINER,
        channelId: SYNTHETIC_CHANNEL_ALPHA,
        workspaceId: SYNTHETIC_WORKSPACE_ID,
        projectRoot: repoRoot,
        buildServerUrl: "http://127.0.0.1:18790",
        queue,
        queueProjectId: projectId,
        monitor,
        git: new GitManager(repoRoot),
        routingService,
      };

      const dispatchRes = await handleSlashCommand(
        `dispatch ${featureId} 2`,
        context,
      );
      const savedDispatch = store.getDispatchOperation({
        projectId,
        featureId,
        phaseId: "phase-02",
      });
      expect(savedDispatch).not.toBeNull();
      expect(JSON.stringify(dispatchRes.blocks)).toContain(
        savedDispatch?.operationId,
      );
      expect(dispatchRes.thread_ts).toBe(SYNTHETIC_THREAD_ALPHA.rootTs);

      const shipRes = await handleSlashCommand(`ship ${featureId} 2`, context);
      expect(JSON.stringify(shipRes.blocks)).toContain(
        savedDispatch?.operationId,
      );

      const shipNew = await handleSlashCommand(`ship ${featureId} 3`, context);
      const savedShip = store.getDispatchOperation({
        projectId,
        featureId,
        phaseId: "phase-03",
      });
      expect(savedShip).not.toBeNull();
      expect(JSON.stringify(shipNew.blocks)).toContain(savedShip?.operationId);
      await queue.close();
    } finally {
      db.close();
    }
  });

  async function verifyActionAck(
    actionId: string,
    retryAfterAckFailure = false,
  ) {
    const tempRoot = mkdtempSync(join(tmpdir(), "gwrk-durable-slack-act-"));
    tempDirs.push(tempRoot);
    const repoRoot = initTestRepo(
      join(tempRoot, "alpha"),
      SYNTHETIC_PROJECT_ALPHA.repoSlug ?? undefined,
    );
    const featureId = SYNTHETIC_THREAD_ALPHA.featureId;
    mkdirSync(join(repoRoot, "specs", featureId), { recursive: true });

    const db = openDatabase({ dbPath: join(tempRoot, "gwrk.db") });
    try {
      const projectId = resolveProjectId(repoRoot);
      const registry = createSqliteProjectRegistryAdapter({ db });
      const store = createSqliteOperationsStoreAdapter({ db });
      registry.enrollProject({
        ...SYNTHETIC_PROJECT_ALPHA,
        projectId,
        localRoot: repoRoot,
        legacyProjectIds: [],
      });
      for (const role of SYNTHETIC_ROLES) {
        if (role.projectId === SYNTHETIC_PROJECT_ALPHA.projectId) {
          registry.setRoleBinding({ ...role, projectId });
        }
      }
      registry.bindFeatureThread({
        ...SYNTHETIC_THREAD_ALPHA,
        projectId,
      });

      const config = GwrkConfigSchema.parse({
        project: { name: "alpha" },
        agents: { implement: "agy" },
      });
      const monitor = new SystemMonitor(config);
      const sandbox = new SandboxManager(repoRoot);
      vi.spyOn(monitor, "isThrottled").mockReturnValue(false);
      let finishPrior!: () => void;
      const prior = new Promise<void>((resolve) => {
        finishPrior = resolve;
      });
      const launchPhaseShip = vi.fn(
        async ({ phaseId }: { phaseId: string }) => {
          if (phaseId === "phase-03") await prior;
          return { exitCode: 0, stderr: "" };
        },
      );
      const queue = new DispatchQueue(
        config,
        monitor,
        sandbox,
        repoRoot,
        { db, projectId },
        undefined,
        undefined,
        {
          worker: {
            launchPhaseShip,
            inspectRecoveredWork: vi.fn(),
            cleanupStaleSandbox: vi.fn(),
          },
          notifier: { notify: vi.fn() },
          heartbeatIntervalMs: null,
        },
      );
      queue.accept({ projectId, featureId, phaseId: "phase-03" });
      await vi.waitFor(() => expect(launchPhaseShip).toHaveBeenCalledOnce());
      launchPhaseShip.mockClear();

      const actionHandlers: Record<string, (args: unknown) => Promise<void>> =
        {};
      const mockApp = {
        action: vi.fn(
          (id: string, handler: (args: unknown) => Promise<void>) => {
            actionHandlers[id] = handler;
          },
        ),
        event: vi.fn(),
      } as unknown as App;

      await registerSlackActions(mockApp, {
        userId: "",
        channelId: "",
        projectRoot: repoRoot,
        buildServerUrl: "http://127.0.0.1:18790",
        queue,
        queueProjectId: projectId,
        monitor,
        git: new GitManager(repoRoot),
        routingService: createProjectRoutingService({ registry }),
      });

      let operationPresentAtAck = false;
      const ack = vi.fn(async () => {
        operationPresentAtAck =
          store.getDispatchOperation({
            projectId,
            featureId,
            phaseId: "phase-04",
          }) !== null;
        finishPrior();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect
          .soft(launchPhaseShip, "no worker until acknowledgment resolves")
          .not.toHaveBeenCalled();
      });
      const chat = { postMessage: vi.fn(), postEphemeral: vi.fn() };
      const body = {
        team: { id: SYNTHETIC_WORKSPACE_ID },
        channel: { id: SYNTHETIC_CHANNEL_ALPHA },
        user: { id: SYNTHETIC_USER_MAINTAINER },
        message: {
          ts: "1731320000.000900",
          thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
        },
        actions: [
          {
            action_id: actionId,
            value: JSON.stringify({
              projectId,
              featureId,
              phaseId: "phase-04",
              rootTs: SYNTHETIC_THREAD_ALPHA.rootTs,
            }),
          },
        ],
      };

      if (retryAfterAckFailure) {
        try {
          const request = { projectId, featureId, phaseId: "phase-04" };
          await expect(
            actionHandlers[actionId]({
              ack: vi.fn().mockRejectedValue(new Error("ack transport closed")),
              body,
              client: { chat },
              logger: { error: vi.fn() },
            }),
          ).rejects.toThrow("ack transport closed");
          const accepted = store.getDispatchOperation(request);
          expect(accepted).toMatchObject({
            status: "accepted",
            attemptCount: 0,
          });
          finishPrior();
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(launchPhaseShip).not.toHaveBeenCalled();

          const deniedAck = vi.fn().mockResolvedValue(undefined);
          await actionHandlers[actionId]({
            ack: deniedAck,
            body: { ...body, user: { id: "U_UNAUTHORIZED_REPLAY" } },
            client: { chat },
            logger: { error: vi.fn() },
          });
          expect(deniedAck).toHaveBeenCalledOnce();
          queue.resume();
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(store.getDispatchOperation(request)).toMatchObject({
            operationId: accepted?.operationId,
            status: "accepted",
            attemptCount: 0,
          });
          expect(launchPhaseShip).not.toHaveBeenCalled();

          const replayAck = vi.fn().mockResolvedValue(undefined);
          await actionHandlers[actionId]({
            ack: replayAck,
            body,
            client: { chat },
            logger: { error: vi.fn() },
          });
          expect(replayAck).toHaveBeenCalledOnce();
          queue.resume();
          await vi.waitFor(() =>
            expect(store.getDispatchOperation(request)).toMatchObject({
              operationId: accepted?.operationId,
              status: "completed",
              attemptCount: 1,
            }),
          );
          expect(launchPhaseShip).toHaveBeenCalledOnce();
        } finally {
          finishPrior();
          await queue.close();
        }
        return;
      }

      await actionHandlers[actionId]({
        ack,
        body,
        client: { chat },
        logger: { error: vi.fn() },
      });

      const op = store.getDispatchOperation({
        projectId,
        featureId,
        phaseId: "phase-04",
      });
      expect(ack).toHaveBeenCalledOnce();
      expect(
        operationPresentAtAck,
        "DispatchReceipt must be committed in SQLite before ack()",
      ).toBe(true);
      expect(op).not.toBeNull();
      expect(chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: SYNTHETIC_CHANNEL_ALPHA,
          thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
          text: expect.stringContaining(op?.operationId ?? ""),
        }),
      );

      await vi.waitFor(() => expect(launchPhaseShip).toHaveBeenCalledOnce());

      // Replayed click must be rejected without creating a second dispatch.
      chat.postMessage.mockClear();
      await actionHandlers[actionId]({
        ack: vi.fn(),
        body,
        client: { chat },
        logger: { error: vi.fn() },
      });
      expect(chat.postMessage).not.toHaveBeenCalled();
      expect(chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("already has a receipt"),
        }),
      );

      await queue.close();
    } finally {
      db.close();
    }
  }

  it.each(["retry_phase", "request_changes"])(
    "persists %s and waits for ack before launch",
    (actionId) => verifyActionAck(actionId),
  );

  it.each(["retry_phase", "request_changes"])(
    "releases the original %s operation after a successful acknowledgment on replay",
    (actionId) => verifyActionAck(actionId, true),
  );

  it("rolls back Slack action claim and skips ack() if durable dispatch persistence fails", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "gwrk-durable-slack-rb-"));
    tempDirs.push(tempRoot);
    const repoRoot = initTestRepo(
      join(tempRoot, "alpha"),
      SYNTHETIC_PROJECT_ALPHA.repoSlug ?? undefined,
    );
    const featureId = SYNTHETIC_THREAD_ALPHA.featureId;
    mkdirSync(join(repoRoot, "specs", featureId), { recursive: true });

    const db = openDatabase({ dbPath: join(tempRoot, "gwrk.db") });
    try {
      const projectId = resolveProjectId(repoRoot);
      const registry = createSqliteProjectRegistryAdapter({ db });
      registry.enrollProject({
        ...SYNTHETIC_PROJECT_ALPHA,
        projectId,
        localRoot: repoRoot,
        legacyProjectIds: [],
      });
      for (const role of SYNTHETIC_ROLES) {
        if (role.projectId === SYNTHETIC_PROJECT_ALPHA.projectId) {
          registry.setRoleBinding({ ...role, projectId });
        }
      }
      registry.bindFeatureThread({
        ...SYNTHETIC_THREAD_ALPHA,
        projectId,
      });

      const config = GwrkConfigSchema.parse({
        project: { name: "alpha" },
        agents: { implement: "agy" },
      });
      const monitor = new SystemMonitor(config);
      const sandbox = new SandboxManager(repoRoot);
      const queue = new DispatchQueue(config, monitor, sandbox, repoRoot, {
        db,
        projectId,
      });
      // Close queue so accept() throws inside the SQLite transaction
      await queue.close();

      const actionHandlers: Record<string, (args: unknown) => Promise<void>> =
        {};
      const mockApp = {
        action: vi.fn(
          (id: string, handler: (args: unknown) => Promise<void>) => {
            actionHandlers[id] = handler;
          },
        ),
        event: vi.fn(),
      } as unknown as App;

      await registerSlackActions(mockApp, {
        userId: "",
        channelId: "",
        projectRoot: repoRoot,
        buildServerUrl: "http://127.0.0.1:18790",
        queue,
        queueProjectId: projectId,
        monitor,
        git: new GitManager(repoRoot),
        routingService: createProjectRoutingService({ registry }),
      });

      const ack = vi.fn();
      const chat = { postMessage: vi.fn(), postEphemeral: vi.fn() };
      await expect(
        actionHandlers.request_changes({
          ack,
          body: {
            team: { id: SYNTHETIC_WORKSPACE_ID },
            channel: { id: SYNTHETIC_CHANNEL_ALPHA },
            user: { id: SYNTHETIC_USER_MAINTAINER },
            message: {
              ts: "1731320000.000999",
              thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
            },
            actions: [
              {
                action_id: "request_changes",
                value: JSON.stringify({
                  projectId,
                  featureId,
                  phaseId: "phase-05",
                  rootTs: SYNTHETIC_THREAD_ALPHA.rootTs,
                }),
              },
            ],
          },
          client: { chat },
          logger: { error: vi.fn() },
        }),
      ).rejects.toThrow("Dispatch queue is closed");

      expect(ack).not.toHaveBeenCalled();
      const receiptCount = (
        db.prepare("SELECT COUNT(*) AS c FROM slack_action_receipts").get() as {
          c: number;
        }
      ).c;
      expect(receiptCount).toBe(0);
    } finally {
      db.close();
    }
  });

  it("HarvestWatcher polls enrolled repositories from durable cursors and isolates PR numbers", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "gwrk-durable-watcher-"));
    tempDirs.push(tempRoot);
    const alphaRoot = initTestRepo(join(tempRoot, "alpha"), "org/alpha");
    const betaRoot = initTestRepo(join(tempRoot, "beta"), "org/beta");
    const db = openDatabase({ dbPath: join(tempRoot, "gwrk.db") });
    try {
      const alphaId = resolveProjectId(alphaRoot);
      const betaId = resolveProjectId(betaRoot);
      const registry = createSqliteProjectRegistryAdapter({ db });
      const store = createSqliteOperationsStoreAdapter({ db });

      for (const [id, slug, repo, root] of [
        [alphaId, "alpha", "org/alpha", alphaRoot],
        [betaId, "beta", "org/beta", betaRoot],
      ] as const) {
        registry.enrollProject({
          projectId: id,
          slug,
          name: slug,
          repoSlug: repo,
          trunkBranch: "develop",
          localRoot: root,
          mirrorPath: null,
          runnerPolicy: { allowedKinds: ["local"] },
          slack: null,
          legacyProjectIds: [],
          createdAt: "2026-11-23T12:00:00.000Z",
          updatedAt: "2026-11-23T12:00:00.000Z",
        });
      }

      const listTerminalPullRequests = vi.fn(
        async ({ repoSlug }: { repoSlug: string }) => {
          if (repoSlug === "org/alpha") {
            return [
              {
                repoSlug: "org/alpha",
                headRepoSlug: "org/alpha",
                prNumber: 55,
                prUrl: "https://github.com/org/alpha/pull/55",
                state: "CLOSED" as const,
                merged: false,
                baseBranch: "develop",
                headBranch: "feat/049-shared-phase-01",
                headSha: "1".repeat(40),
                mergeCommitSha: null,
                mergedAt: null,
                closedAt: "2026-11-23T12:20:00.000Z",
              },
            ];
          }
          return [
            {
              repoSlug: "org/beta",
              headRepoSlug: "org/beta",
              prNumber: 55,
              prUrl: "https://github.com/org/beta/pull/55",
              state: "CLOSED" as const,
              merged: false,
              baseBranch: "develop",
              headBranch: "feat/049-shared-phase-01",
              headSha: "2".repeat(40),
              mergeCommitSha: null,
              mergedAt: null,
              closedAt: "2026-11-23T12:25:00.000Z",
            },
          ];
        },
      );

      const config = GwrkConfigSchema.parse({ project: { name: "alpha" } });
      const watcher1 = new HarvestWatcher(
        config,
        null,
        alphaRoot,
        { db, projectId: alphaId },
        undefined,
        {
          github: {
            verifyWebhookSignature: () => true,
            listTerminalPullRequests,
            getPullRequest: vi.fn().mockResolvedValue(null),
          },
          executor: {
            discoverPhasesAtCheckout: vi.fn().mockResolvedValue(["phase-01"]),
            verifyGatesAtCheckout: vi.fn(),
            recordLearningAtCheckout: vi.fn().mockResolvedValue({
              linkedRunId: null,
              forecastMissing: false,
              summaryText: "closed",
            }),
          },
          clock: {
            nowIso: () => "2026-11-23T12:30:00.000Z",
            nowMs: () => Date.parse("2026-11-23T12:30:00.000Z"),
          },
        },
      );

      await watcher1.runCheck();

      expect(store.getHarvestCursor(alphaId)).toMatchObject({
        projectId: alphaId,
        lastTerminalAt: "2026-11-23T12:20:00.000Z",
        lastPrNumber: 55,
        lastError: null,
      });
      expect(store.getHarvestCursor(betaId)).toMatchObject({
        projectId: betaId,
        lastTerminalAt: "2026-11-23T12:25:00.000Z",
        lastPrNumber: 55,
        lastError: null,
      });

      const ops = db
        .prepare(
          "SELECT project_id, terminal_event, status FROM harvest_operations ORDER BY project_id",
        )
        .all() as Array<{
        project_id: string;
        terminal_event: string;
        status: string;
      }>;
      expect(ops).toHaveLength(2);
      expect(ops.every((o) => o.terminal_event === "closed_unmerged")).toBe(
        true,
      );
      expect(ops.every((o) => o.status === "closed_unmerged")).toBe(true);

      // Restart watcher and verify saved cursors are supplied as sinceIso
      listTerminalPullRequests.mockClear();
      const watcher2 = new HarvestWatcher(
        config,
        null,
        alphaRoot,
        { db, projectId: alphaId },
        undefined,
        {
          github: {
            verifyWebhookSignature: () => true,
            listTerminalPullRequests,
            getPullRequest: vi.fn().mockResolvedValue(null),
          },
          executor: {
            discoverPhasesAtCheckout: vi.fn().mockResolvedValue(["phase-01"]),
            verifyGatesAtCheckout: vi.fn(),
            recordLearningAtCheckout: vi.fn().mockResolvedValue({
              linkedRunId: null,
              forecastMissing: false,
              summaryText: "closed",
            }),
          },
        },
      );
      await watcher2.runCheck();

      expect(listTerminalPullRequests).toHaveBeenCalledWith(
        expect.objectContaining({
          repoSlug: "org/alpha",
          sinceIso: "2026-11-23T12:20:00.000Z",
        }),
      );
      expect(listTerminalPullRequests).toHaveBeenCalledWith(
        expect.objectContaining({
          repoSlug: "org/beta",
          sinceIso: "2026-11-23T12:25:00.000Z",
        }),
      );
    } finally {
      db.close();
    }
  });

  it("HarvestWatcher flushes pending durable outbox items for enrolled projects without repoSlug instead of falling back to legacy polling", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "gwrk-durable-local-watcher-"));
    tempDirs.push(tempRoot);
    const localRoot = initTestRepo(join(tempRoot, "local-only"));
    const db = openDatabase({ dbPath: join(tempRoot, "gwrk.db") });
    try {
      const localId = resolveProjectId(localRoot);
      const registry = createSqliteProjectRegistryAdapter({ db });
      const store = createSqliteOperationsStoreAdapter({ db });
      registry.enrollProject({
        projectId: localId,
        slug: "local-only",
        name: "Local Only",
        repoSlug: null,
        trunkBranch: "develop",
        localRoot,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local"] },
        slack: {
          workspaceId: "T_LOCAL",
          channelId: "C_LOCAL",
          sharedChannel: false,
        },
        legacyProjectIds: [],
        createdAt: "2026-11-23T12:00:00.000Z",
        updatedAt: "2026-11-23T12:00:00.000Z",
      });
      const outboxItem = store.enqueueOutbox({
        outboxId: "outbox-local-1",
        projectId: localId,
        dedupeKey: "local-dispatch-complete-1",
        ownerKind: "dispatch",
        ownerOperationId: "op-local-1",
        eventType: "review_ready",
        featureId: "049-local",
        phaseId: "phase-01",
        recipient: {
          projectId: localId,
          surface: "slack",
          workspaceId: "T_LOCAL",
          channelId: "C_LOCAL",
        },
        payload: { text: "Review ready for local project" },
        clientMetadataKey: "meta-local-1",
        nowIso: "2026-11-23T12:00:00.000Z",
      });

      const notify = vi.fn().mockResolvedValue({
        delivered: true,
        channelId: "C_LOCAL",
        messageTs: "1731320100.000100",
      });
      const config = GwrkConfigSchema.parse({
        project: { name: "local-only" },
      });
      const watcher = new HarvestWatcher(
        config,
        null,
        localRoot,
        { db, projectId: localId },
        undefined,
        { notifier: { notify } },
      );

      await watcher.runCheck();

      expect(notify).toHaveBeenCalledOnce();
      expect(store.getOutboxItem(outboxItem.outboxId)?.status).toBe(
        "delivered",
      );
    } finally {
      db.close();
    }
  });

  it("TR-001 cleans up a stale worktree in the target project root during recovery for another enrolled project", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "gwrk-durable-multiproj-wt-"));
    tempDirs.push(tempRoot);
    const makeCommittedRepo = (name: string) => {
      const dir = join(tempRoot, name);
      mkdirSync(dir, { recursive: true });
      const env = {
        ...repositoryGitEnv(tempRoot),
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
      };
      execFileSync("git", ["init", "--quiet", "--initial-branch=develop"], {
        cwd: dir,
        env,
        stdio: "ignore",
      });
      execFileSync(
        "git",
        ["commit", "--no-gpg-sign", "--allow-empty", "-m", "init"],
        { cwd: dir, env, stdio: "ignore" },
      );
      return realpathSync(dir);
    };
    const alphaRoot = makeCommittedRepo("alpha");
    const betaRoot = makeCommittedRepo("beta");
    const db = openDatabase({ dbPath: join(tempRoot, "gwrk.db") });
    try {
      const alphaId = resolveProjectId(alphaRoot);
      const betaId = resolveProjectId(betaRoot);
      const registry = createSqliteProjectRegistryAdapter({ db });
      const store = createSqliteOperationsStoreAdapter({ db });
      for (const [id, slug, root] of [
        [alphaId, "alpha", alphaRoot],
        [betaId, "beta", betaRoot],
      ] as const) {
        registry.enrollProject({
          projectId: id,
          slug,
          name: slug,
          repoSlug: null,
          trunkBranch: "develop",
          localRoot: root,
          mirrorPath: null,
          runnerPolicy: { allowedKinds: ["local"] },
          slack: null,
          legacyProjectIds: [],
          createdAt: "2026-11-23T10:00:00.000Z",
          updatedAt: "2026-11-23T10:00:00.000Z",
        });
      }

      // Seed an expired leased operation for beta with a real stale worktree in betaRoot
      const receipt = store.acceptDispatch({
        projectId: betaId,
        featureId: "049-beta-stale",
        phaseId: "phase-01",
        backend: "agy",
        trunkBranch: "develop",
        recipient: { projectId: betaId, surface: "http" },
        newOperationId: "op-beta-stale",
        nowIso: "2026-11-23T10:00:00.000Z",
      });
      store.claimDispatchLease({
        operationId: receipt.operationId,
        leaseOwner: "crashed-daemon",
        nowIso: "2026-11-23T10:00:01.000Z",
        leaseExpiresAt: "2026-11-23T10:05:00.000Z",
      });
      const betaSandbox = new ScopedSandboxManager(betaRoot, () =>
        repositoryGitEnv(betaRoot),
      );
      await betaSandbox.createSandbox({
        featureId: "049-beta-stale",
        phaseId: "phase-01",
        taskId: "ship",
        backend: "agy",
        projectRoot: betaRoot,
        baseBranch: "develop",
        branchName: receipt.branchName,
      });

      const config = GwrkConfigSchema.parse({
        project: { name: "alpha" },
        agents: { implement: "agy" },
      });
      const monitor = new SystemMonitor(config);
      const alphaGitEnv = () => repositoryGitEnv(alphaRoot);
      const alphaSandbox = new ScopedSandboxManager(alphaRoot, alphaGitEnv);
      const queue = new DispatchQueue(
        config,
        monitor,
        alphaSandbox,
        alphaRoot,
        { db, projectId: alphaId },
        alphaGitEnv,
        undefined,
        {
          clock: {
            nowIso: () => "2026-11-23T12:00:00.000Z",
            nowMs: () => Date.parse("2026-11-23T12:00:00.000Z"),
          },
          heartbeatIntervalMs: null,
        },
      );
      queue.pause();

      const summary = await queue.recoverOnStartup();
      await queue.close();

      expect(summary.requeuedCount).toBe(1);
      expect(
        store.getDispatchOperation({
          projectId: betaId,
          featureId: "049-beta-stale",
          phaseId: "phase-01",
        })?.status,
      ).toBe("accepted");
      const betaWorktrees = execFileSync(
        "git",
        ["worktree", "list", "--porcelain"],
        { cwd: betaRoot, env: repositoryGitEnv(betaRoot), encoding: "utf8" },
      ).match(/^worktree /gm);
      expect(betaWorktrees).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
