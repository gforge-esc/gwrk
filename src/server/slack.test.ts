/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "@slack/bolt";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import {
  SYNTHETIC_CHANNEL_ALPHA,
  SYNTHETIC_CHANNEL_BETA,
  SYNTHETIC_PROJECT_ALPHA,
  SYNTHETIC_PROJECT_BETA,
  SYNTHETIC_ROLES,
  SYNTHETIC_THREAD_ALPHA,
  SYNTHETIC_USER_MAINTAINER,
  SYNTHETIC_WORKSPACE_ID,
  createSyntheticRegistry,
} from "../../tests/helpers/synthetic-slack";
import { resolveProjectId } from "../adapters/git/project-id.js";
import { createSqliteProjectRegistryAdapter } from "../adapters/sqlite/index";
import { getStats, listRuns } from "../db/runs.js";
import type { GwrkConfig } from "../utils/config";
import * as slackClient from "../utils/slack-client";
import type { DispatchQueue } from "./dispatch";
import type { GitManager } from "./git-manager";
import type { LifecycleMonitor } from "./lifecycle";
import type { SystemMonitor } from "./monitor";
import type { NetworkMonitor } from "./network";
import type { SandboxManager } from "./sandbox";
import {
  getSlackApp,
  resetSlackApp,
  startSlackApp,
  stopSlackApp,
} from "./slack";
import { registerSlackActions } from "./slack-actions";
import { registerSlackHomeHandler } from "./slack-home";

vi.mock("../adapters/sqlite/index", () => ({
  createSqliteProjectRegistryAdapter: vi.fn(),
}));

vi.mock("../db/runs.js", () => ({
  getStats: vi.fn(() => []),
  listRuns: vi.fn(() => []),
}));

vi.mock("@slack/bolt", () => {
  const mockApp = {
    start: vi.fn().mockResolvedValue({}),
    stop: vi.fn().mockResolvedValue({}),
    command: vi.fn(),
    event: vi.fn(),
    action: vi.fn(),
    client: {
      auth: {
        test: vi
          .fn()
          .mockResolvedValue({ team: "test-team", user_id: "U_TEST" }),
      },
    },
  };
  return {
    App: vi.fn(() => mockApp),
  };
});

vi.mock("../utils/slack-client", () => {
  return {
    loadSlackConfig: vi.fn(),
  };
});

vi.mock("./slack-actions", () => ({
  registerSlackActions: vi.fn().mockResolvedValue({}),
}));

vi.mock("./slack-home", () => ({
  registerSlackHomeHandler: vi.fn().mockResolvedValue({}),
}));

vi.mock("./slack-presence", () => ({
  presenceManager: {
    init: vi.fn().mockResolvedValue({}),
    stop: vi.fn(),
  },
}));

function initCheckout(
  project: typeof SYNTHETIC_PROJECT_ALPHA,
  root: string,
  featureId: string,
) {
  mkdirSync(join(root, "specs", featureId), { recursive: true });
  const localRoot = realpathSync(root);
  const options = { cwd: localRoot, stdio: "ignore" as const, timeout: 5_000 };
  execFileSync("git", ["init", "--quiet"], options);
  execFileSync(
    "git",
    ["remote", "add", "origin", `https://github.com/${project.repoSlug}.git`],
    options,
  );
  return { ...project, localRoot, projectId: resolveProjectId(localRoot) };
}

function rolesFor(
  alpha: typeof SYNTHETIC_PROJECT_ALPHA,
  beta = SYNTHETIC_PROJECT_BETA,
) {
  return SYNTHETIC_ROLES.map((role) => ({
    ...role,
    projectId:
      role.projectId === SYNTHETIC_PROJECT_ALPHA.projectId
        ? alpha.projectId
        : beta.projectId,
  }));
}

describe("Slack Server Integration", () => {
  const mockDeps = {
    queue: {
      enqueue: vi.fn(),
      getQueue: vi.fn(() => ({ active: [], queued: [], paused: false })),
      getDispatch: vi.fn(),
      pause: vi.fn(),
    } as unknown as DispatchQueue,
    monitor: {
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      getResources: vi.fn(() => ({ cpuPercent: 0, memPercent: 0 })),
    } as unknown as SystemMonitor,
    sandbox: { checkDocker: vi.fn() } as unknown as SandboxManager,
    lifecycle: {
      start: vi.fn(),
      stop: vi.fn(),
      getStatus: vi.fn(() => "ready"),
    } as unknown as LifecycleMonitor,
    network: {
      start: vi.fn(),
      stop: vi.fn(),
      getStatus: vi.fn(() => "online"),
    } as unknown as NetworkMonitor,
    git: { projectRoot: "/tmp" } as unknown as GitManager,
    projectRoot: "/tmp",
    config: {
      server: { host: "localhost", port: 3000 },
      project: { slack: { channelId: "C_TEST" } },
    } as unknown as GwrkConfig,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    resetSlackApp();
  });

  afterEach(async () => {
    await stopSlackApp();
    vi.restoreAllMocks();
  });

  it("should initialize Bolt App with correct config", () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });

    const app = getSlackApp();
    expect(app).toBeDefined();
    expect(App).toHaveBeenCalledWith({
      token: "xoxb-test",
      appToken: "xapp-test",
      socketMode: true,
    });
  });

  it("should return null if slack is not configured", () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue(null);
    const app = getSlackApp();
    expect(app).toBeNull();
  });

  it("should start and stop the app", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });

    await startSlackApp({ ...mockDeps, registry: createSyntheticRegistry() });
    expect(console.log).toHaveBeenCalledWith("⚡️ Slack Bolt app is running!");

    await stopSlackApp();
    expect(console.log).toHaveBeenCalledWith("🛑 Slack Bolt app stopped.");
  });

  async function runFeatureSlashCommand(commandText: string) {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const featureId = "048-project-identity-slack";
    const root = mkdtempSync(join(tmpdir(), "gwrk-slack-thread-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const alpha = initCheckout(SYNTHETIC_PROJECT_ALPHA, root, featureId);
    const registry = createSyntheticRegistry({
      projects: [alpha],
      roles: rolesFor(alpha),
      threads: [
        { ...SYNTHETIC_THREAD_ALPHA, featureId, projectId: alpha.projectId },
      ],
    });
    await startSlackApp({
      ...mockDeps,
      projectRoot: alpha.localRoot,
      registry,
    });
    const app = getSlackApp()!;
    expect(app.command).toHaveBeenCalledWith("/gwrk", expect.any(Function));
    const handler = vi.mocked(app.command).mock.calls[0][1];
    const ack = vi.fn();
    const respond = vi.fn();
    const postEphemeral = vi.fn();
    await handler({
      command: {
        command: "/gwrk",
        text: commandText.replace("<feature>", featureId),
        channel_id: SYNTHETIC_CHANNEL_ALPHA,
        user_id: SYNTHETIC_USER_MAINTAINER,
        team_id: SYNTHETIC_WORKSPACE_ID,
      },
      ack,
      respond,
      client: { chat: { postEphemeral } },
    } as Parameters<typeof handler>[0]);
    expect(ack).toHaveBeenCalledOnce();
    return { featureId, respond, postEphemeral };
  }

  it("responds to a public dispatch in its stored thread", async () => {
    const { featureId, respond, postEphemeral } = await runFeatureSlashCommand(
      "dispatch <feature> 3",
    );
    expect(mockDeps.queue.enqueue).toHaveBeenCalledWith({
      featureId,
      phaseId: "phase-03",
    });
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        response_type: "in_channel",
        thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
        replace_original: false,
      }),
    );
    expect(postEphemeral).not.toHaveBeenCalled();
  });

  it("posts threaded status privately to the caller in the authorized channel", async () => {
    const { featureId, respond, postEphemeral } =
      await runFeatureSlashCommand("status <feature>");
    expect.soft(respond).not.toHaveBeenCalled();
    expect(postEphemeral).toHaveBeenCalledExactlyOnceWith({
      channel: SYNTHETIC_CHANNEL_ALPHA,
      user: SYNTHETIC_USER_MAINTAINER,
      thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
      blocks: expect.arrayContaining([
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Feature ${featureId}:* No dispatch runs found.`,
          },
        },
      ]),
    });
  });

  it("uses the response URL for unthreaded help", async () => {
    const { respond, postEphemeral } = await runFeatureSlashCommand("help");
    expect(respond).toHaveBeenCalledOnce();
    const [response] = respond.mock.calls[0];
    expect(response.response_type).toBe("ephemeral");
    expect(response.blocks[0].type).toBe("header");
    expect(response).not.toHaveProperty("thread_ts");
    expect(response).not.toHaveProperty("replace_original");
    expect(postEphemeral).not.toHaveBeenCalled();
  });

  it("dispatches from the canonical startup path of an enrolled mirror", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const root = mkdtempSync(join(tmpdir(), "gwrk-slack-mirror-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const featureId = SYNTHETIC_THREAD_ALPHA.featureId;
    const alpha = initCheckout(
      SYNTHETIC_PROJECT_ALPHA,
      join(root, "alpha"),
      featureId,
    );
    const mirror = initCheckout(
      SYNTHETIC_PROJECT_ALPHA,
      join(root, "mirror"),
      featureId,
    );
    const mirrorPath = join(realpathSync(root), "mirror-link");
    symlinkSync(mirror.localRoot, mirrorPath, "dir");
    const sqlite = await vi.importActual<
      typeof import("../adapters/sqlite/index")
    >("../adapters/sqlite/index");
    const registry = sqlite.createSqliteProjectRegistryAdapter({
      dbPath: ":memory:",
    });
    onTestFinished(() => registry.close());
    registry.enrollProject({ ...alpha, mirrorPath, legacyProjectIds: [] });
    for (const role of rolesFor(alpha)) {
      if (role.projectId === alpha.projectId) registry.setRoleBinding(role);
    }
    registry.bindFeatureThread({
      ...SYNTHETIC_THREAD_ALPHA,
      projectId: alpha.projectId,
    });
    await startSlackApp({
      ...mockDeps,
      projectRoot: mirror.localRoot,
      registry,
    });

    const handler = vi.mocked(getSlackApp()!.command).mock.calls[0][1];
    const respond = vi.fn();
    const postEphemeral = vi.fn();
    await handler({
      command: {
        command: "/gwrk",
        text: `dispatch ${featureId} 3`,
        channel_id: SYNTHETIC_CHANNEL_ALPHA,
        user_id: SYNTHETIC_USER_MAINTAINER,
        team_id: SYNTHETIC_WORKSPACE_ID,
      },
      ack: vi.fn(),
      respond,
      client: { chat: { postEphemeral } },
    } as Parameters<typeof handler>[0]);

    const [, actionContext] = vi.mocked(registerSlackActions).mock.calls[0];
    expect.soft(actionContext.queueProjectId).toBe(alpha.projectId);
    expect.soft(mockDeps.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
      featureId,
      phaseId: "phase-03",
    });
    expect(respond).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        response_type: "in_channel",
        thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
        replace_original: false,
      }),
    );
  });

  it("limits registered queue commands to the startup project with matching feature IDs", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const featureId = SYNTHETIC_THREAD_ALPHA.featureId;
    const root = mkdtempSync(join(tmpdir(), "gwrk-slack-queue-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const alpha = initCheckout(
      SYNTHETIC_PROJECT_ALPHA,
      join(root, "alpha"),
      featureId,
    );
    const beta = initCheckout(
      SYNTHETIC_PROJECT_BETA,
      join(root, "beta"),
      featureId,
    );
    const betaThread = {
      ...SYNTHETIC_THREAD_ALPHA,
      projectId: beta.projectId,
      channelId: SYNTHETIC_CHANNEL_BETA,
      rootTs: "1731320010.000100",
    };
    await startSlackApp({
      ...mockDeps,
      projectRoot: alpha.localRoot,
      registry: createSyntheticRegistry({
        projects: [alpha, beta],
        roles: rolesFor(alpha, beta),
        threads: [betaThread],
      }),
    });
    const handler = vi.mocked(getSlackApp()!.command).mock.calls[0][1];
    async function run(text: string, channelId: string) {
      const respond = vi.fn();
      const postEphemeral = vi.fn();
      await handler({
        command: {
          command: "/gwrk",
          text,
          channel_id: channelId,
          user_id: SYNTHETIC_USER_MAINTAINER,
          team_id: SYNTHETIC_WORKSPACE_ID,
        },
        ack: vi.fn(),
        respond,
        client: { chat: { postEphemeral } },
      } as Parameters<typeof handler>[0]);
      return { respond, postEphemeral };
    }

    const dispatch = `dispatch ${featureId} phase-03`;
    const alphaDispatch = await run(dispatch, SYNTHETIC_CHANNEL_ALPHA);
    expect(alphaDispatch.respond).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ response_type: "in_channel" }),
    );
    expect(alphaDispatch.postEphemeral).not.toHaveBeenCalled();
    expect(mockDeps.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
      featureId,
      phaseId: "phase-03",
    });
    vi.mocked(mockDeps.queue.enqueue).mockClear();

    const queueWarning = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: ":warning: The dispatch queue is unavailable for this project.",
        },
      },
    ];
    const betaDispatch = await run(dispatch, SYNTHETIC_CHANNEL_BETA);
    expect.soft(betaDispatch.respond).not.toHaveBeenCalled();
    expect.soft(betaDispatch.postEphemeral).toHaveBeenCalledExactlyOnceWith({
      channel: betaThread.channelId,
      user: SYNTHETIC_USER_MAINTAINER,
      thread_ts: betaThread.rootTs,
      blocks: queueWarning,
    });
    const betaPause = await run("pause", SYNTHETIC_CHANNEL_BETA);
    expect.soft(betaPause.respond).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        response_type: "ephemeral",
        blocks: queueWarning,
      }),
    );
    expect(betaPause.postEphemeral).not.toHaveBeenCalled();
    vi.mocked(listRuns).mockReturnValueOnce([
      {
        feature_id: featureId,
        project_id: beta.projectId,
        command: "ship",
        phase_id: "phase-07",
        gate_result: "Beta ledger gate",
      },
    ]);
    const status = await run(
      `status ${featureId} --project beta`,
      SYNTHETIC_CHANNEL_BETA,
    );
    expect.soft(status.respond).not.toHaveBeenCalled();
    expect.soft(status.postEphemeral).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        channel: betaThread.channelId,
        user: SYNTHETIC_USER_MAINTAINER,
        thread_ts: betaThread.rootTs,
      }),
    );
    expect
      .soft(listRuns)
      .toHaveBeenCalledExactlyOnceWith(featureId, beta.projectId);
    expect
      .soft(JSON.stringify(status.postEphemeral.mock.calls))
      .toContain("Beta ledger gate");
    const summary = await run("status --project beta", SYNTHETIC_CHANNEL_BETA);
    expect
      .soft(summary.respond)
      .toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ response_type: "ephemeral" }),
      );
    expect(summary.postEphemeral).not.toHaveBeenCalled();
    expect.soft(getStats).toHaveBeenCalledExactlyOnceWith(beta.projectId);
    expect(mockDeps.queue.enqueue).not.toHaveBeenCalled();
    expect(mockDeps.queue.getQueue).not.toHaveBeenCalled();
    expect(mockDeps.queue.getDispatch).not.toHaveBeenCalled();
    expect(mockDeps.queue.pause).not.toHaveBeenCalled();
  });

  it("uses the Events API envelope for mentions and Bolt context for DMs", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    await startSlackApp({ ...mockDeps, registry: createSyntheticRegistry() });
    const app = getSlackApp()!;
    const handlers = Object.fromEntries(vi.mocked(app.event).mock.calls);
    const say = vi.fn();
    const message = {
      user: SYNTHETIC_USER_MAINTAINER,
      ts: "1731320000.000200",
    };

    for (const threadTs of [undefined, SYNTHETIC_THREAD_ALPHA.rootTs]) {
      await handlers.app_mention({
        event: {
          ...message,
          type: "app_mention",
          text: "<@B_TEST> status of 003-slack",
          channel: SYNTHETIC_CHANNEL_ALPHA,
          ...(threadTs ? { thread_ts: threadTs } : {}),
        },
        body: { team_id: SYNTHETIC_WORKSPACE_ID },
        context: {},
        say,
      });
      expect.soft(say).toHaveBeenLastCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Checking status"),
          thread_ts: threadTs ?? message.ts,
        }),
      );
    }

    await handlers.message({
      event: {
        ...message,
        type: "message",
        text: "hello --project alpha",
        channel_type: "im",
        channel: "D_TEST",
      },
      body: {},
      context: { teamId: SYNTHETIC_WORKSPACE_ID },
      say,
    });
    expect(say).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "Direct message received for *Project Alpha*",
        ),
      }),
    );
  });

  it("replies only to the human DM when the workspace is on the envelope", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    await startSlackApp({ ...mockDeps, registry: createSyntheticRegistry() });
    const app = getSlackApp()!;
    const handlers = Object.fromEntries(vi.mocked(app.event).mock.calls);
    const say = vi.fn();
    const humanMessage = {
      type: "message",
      text: "hello --project alpha",
      channel_type: "im",
      channel: "D_TEST",
      user: SYNTHETIC_USER_MAINTAINER,
      ts: "1731320000.000100",
    };
    const envelope = {
      body: { type: "event_callback", team_id: SYNTHETIC_WORKSPACE_ID },
      context: {},
      say,
    };
    await handlers.message({ ...envelope, event: humanMessage });
    for (const metadata of [
      { bot_id: "B_SELF" },
      { subtype: "bot_message" },
      { subtype: "message_changed" },
    ]) {
      await handlers.message({
        ...envelope,
        event: { ...humanMessage, ...metadata },
      });
    }
    expect(say).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "Direct message received for *Project Alpha*",
        ),
      }),
    );
  });

  it("asserts no handler executes work when the registry throws", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });

    vi.mocked(createSqliteProjectRegistryAdapter).mockImplementation(() => {
      throw new Error("Registry initialization failure");
    });

    await startSlackApp(mockDeps);

    const boltApp = getSlackApp();
    expect(boltApp).toBeDefined();
    expect(boltApp?.command).not.toHaveBeenCalled();
    expect(boltApp?.event).not.toHaveBeenCalled();
    expect(registerSlackActions).not.toHaveBeenCalled();
    expect(registerSlackHomeHandler).not.toHaveBeenCalled();
    expect(boltApp?.start).not.toHaveBeenCalled();
  });

  async function verifySlashAck(command: string) {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const featureId = SYNTHETIC_THREAD_ALPHA.featureId;
    const root = mkdtempSync(join(tmpdir(), "gwrk-slack-preack-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const alpha = initCheckout(
      SYNTHETIC_PROJECT_ALPHA,
      join(root, "alpha"),
      featureId,
    );
    const { openDatabase } =
      await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
    const sqlite = await vi.importActual<
      typeof import("../adapters/sqlite/index.js")
    >("../adapters/sqlite/index.js");
    const { DispatchQueue } =
      await vi.importActual<typeof import("./dispatch.js")>("./dispatch.js");
    const { GwrkConfigSchema } =
      await vi.importActual<typeof import("../utils/config.js")>(
        "../utils/config.js",
      );
    const db = openDatabase({ dbPath: join(root, "gwrk.db") });
    onTestFinished(() => db.close());
    const registry = sqlite.createSqliteProjectRegistryAdapter({ db });
    const store = sqlite.createSqliteOperationsStoreAdapter({ db });
    registry.enrollProject({ ...alpha, legacyProjectIds: [] });
    for (const role of rolesFor(alpha)) {
      if (role.projectId === alpha.projectId) registry.setRoleBinding(role);
    }
    registry.bindFeatureThread({
      ...SYNTHETIC_THREAD_ALPHA,
      featureId,
      projectId: alpha.projectId,
    });

    const events: string[] = [];
    let finishPriorWorker!: () => void;
    const priorWorker = new Promise<void>((resolve) => {
      finishPriorWorker = resolve;
    });
    const launchPhaseShip = vi.fn(async ({ phaseId }: { phaseId: string }) => {
      if (phaseId === "phase-01") {
        await priorWorker;
        return { exitCode: 0, stderr: "" };
      }
      events.push("worker_launched");
      return { exitCode: 0, stderr: "" };
    });
    const config = GwrkConfigSchema.parse({
      project: { name: "alpha" },
      agents: { implement: "agy" },
    });
    const queue = new DispatchQueue(
      config,
      { isThrottled: () => false } as unknown as SystemMonitor,
      mockDeps.sandbox,
      alpha.localRoot,
      { db, projectId: alpha.projectId },
      undefined,
      undefined,
      {
        store,
        registry,
        worker: {
          inspectRecoveredWork: vi.fn(),
          launchPhaseShip,
          cleanupStaleSandbox: vi.fn(),
        },
        heartbeatIntervalMs: null,
      },
    );
    onTestFinished(() => {
      finishPriorWorker();
      return queue.close();
    });
    await queue.recoverOnStartup();
    await new Promise((resolve) => setTimeout(resolve, 10));

    if (command === "ship") {
      queue.accept({
        projectId: alpha.projectId,
        featureId,
        phaseId: "phase-01",
      });
      await vi.waitFor(() => expect(launchPhaseShip).toHaveBeenCalledOnce());
      launchPhaseShip.mockClear();
    }

    await startSlackApp({
      ...mockDeps,
      queue,
      projectRoot: alpha.localRoot,
      config,
      registry,
    });
    const handler = vi.mocked(getSlackApp()!.command).mock.calls[0][1];
    let persistedBeforeAck = false;
    let workerLaunchedBeforeAck = false;
    const ack = vi.fn(async () => {
      persistedBeforeAck =
        store.getDispatchOperation({
          projectId: alpha.projectId,
          featureId,
          phaseId: "phase-02",
        }) !== null;
      finishPriorWorker();
      await new Promise<void>((resolve) => setImmediate(resolve));
      workerLaunchedBeforeAck = launchPhaseShip.mock.calls.length > 0;
      events.push("ack");
    });
    const respond = vi.fn();
    await handler({
      command: {
        command: "/gwrk",
        text: `${command} ${featureId} 2`,
        channel_id: SYNTHETIC_CHANNEL_ALPHA,
        user_id: SYNTHETIC_USER_MAINTAINER,
        team_id: SYNTHETIC_WORKSPACE_ID,
      },
      ack,
      respond,
      client: { chat: { postEphemeral: vi.fn() } },
    } as Parameters<typeof handler>[0]);

    expect(ack).toHaveBeenCalledOnce();
    expect(persistedBeforeAck).toBe(true);
    expect(workerLaunchedBeforeAck).toBe(false);
    await vi.waitFor(() => {
      expect(launchPhaseShip).toHaveBeenCalledOnce();
    });
    expect(events).toEqual(["ack", "worker_launched"]);
  }

  it.each(["dispatch", "ship"])(
    "persists /gwrk %s receipt before ack() and launches worker only after ack()",
    verifySlashAck,
  );

  it("supports scoped status and durable dispatch across three enrolled projects on a shared durable queue", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const featureId = "052-rollout-smoke";
    const root = mkdtempSync(join(tmpdir(), "gwrk-slack-three-proj-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));

    const alpha = initCheckout(
      SYNTHETIC_PROJECT_ALPHA,
      join(root, "gwrk"),
      featureId,
    );
    const beta = initCheckout(
      {
        ...SYNTHETIC_PROJECT_BETA,
        slug: "right-side-up",
        name: "Right Side Up!",
        repoSlug: "gforge-esc/right-side-up",
        slack: {
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: "C_SHARED_ROLLOUT",
          sharedChannel: true,
        },
      },
      join(root, "right-side-up"),
      featureId,
    );
    const gamma = initCheckout(
      {
        ...SYNTHETIC_PROJECT_BETA,
        projectId: "proj-gamma-placeholder",
        slug: "aftermath-afterglow",
        name: "Aftermath, Afterglow",
        repoSlug: "dgonzo/aftermath-afterglow",
        trunkBranch: "main",
        slack: {
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: "C_SHARED_ROLLOUT",
          sharedChannel: true,
        },
      },
      join(root, "aftermath-afterglow"),
      featureId,
    );

    const { openDatabase } =
      await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
    const sqlite = await vi.importActual<
      typeof import("../adapters/sqlite/index.js")
    >("../adapters/sqlite/index.js");
    const { DispatchQueue } =
      await vi.importActual<typeof import("./dispatch.js")>("./dispatch.js");
    const { GwrkConfigSchema } =
      await vi.importActual<typeof import("../utils/config.js")>(
        "../utils/config.js",
      );

    const db = openDatabase({ dbPath: join(root, "gwrk.db") });
    onTestFinished(() => db.close());
    const registry = sqlite.createSqliteProjectRegistryAdapter({ db });
    const store = sqlite.createSqliteOperationsStoreAdapter({ db });

    for (const proj of [alpha, beta, gamma]) {
      registry.enrollProject({ ...proj, legacyProjectIds: [] });
      registry.setRoleBinding({
        projectId: proj.projectId,
        principalType: "slack_user",
        principalId: `${SYNTHETIC_WORKSPACE_ID}:${SYNTHETIC_USER_MAINTAINER}`,
        role: "maintainer",
      });
    }

    const config = GwrkConfigSchema.parse({
      project: { name: "gwrk" },
      agents: { implement: "agy" },
    });
    const queue = new DispatchQueue(
      config,
      { isThrottled: () => true } as unknown as SystemMonitor,
      mockDeps.sandbox,
      alpha.localRoot,
      { db, projectId: alpha.projectId },
      undefined,
      undefined,
      {
        store,
        registry,
        worker: {
          inspectRecoveredWork: vi.fn(),
          launchPhaseShip: vi.fn(async () => ({ exitCode: 0, stderr: "" })),
          cleanupStaleSandbox: vi.fn(),
        },
        heartbeatIntervalMs: null,
      },
    );
    onTestFinished(() => queue.close());

    await startSlackApp({
      ...mockDeps,
      queue,
      projectRoot: alpha.localRoot,
      config,
      registry,
    });
    const handler = vi.mocked(getSlackApp()!.command).mock.calls[0][1];

    for (const proj of [beta, gamma]) {
      const statusRespond = vi.fn();
      await handler({
        command: {
          command: "/gwrk",
          text: `status --project ${proj.slug}`,
          channel_id: "C_SHARED_ROLLOUT",
          user_id: SYNTHETIC_USER_MAINTAINER,
          team_id: SYNTHETIC_WORKSPACE_ID,
        },
        ack: vi.fn(),
        respond: statusRespond,
        client: { chat: { postEphemeral: vi.fn() } },
      } as Parameters<typeof handler>[0]);
      expect(statusRespond).toHaveBeenCalledOnce();
      const statusBlocks = JSON.stringify(
        statusRespond.mock.calls[0][0].blocks,
      );
      expect(statusBlocks).toContain(`*Project:* \`${proj.slug}\``);

      const dispatchRespond = vi.fn();
      await handler({
        command: {
          command: "/gwrk",
          text: `dispatch ${featureId} 1 --project ${proj.slug}`,
          channel_id: "C_SHARED_ROLLOUT",
          user_id: SYNTHETIC_USER_MAINTAINER,
          team_id: SYNTHETIC_WORKSPACE_ID,
        },
        ack: vi.fn(),
        respond: dispatchRespond,
        client: { chat: { postEphemeral: vi.fn() } },
      } as Parameters<typeof handler>[0]);
      expect(dispatchRespond).toHaveBeenCalledOnce();
      const op = store.getDispatchOperation({
        projectId: proj.projectId,
        featureId,
        phaseId: "phase-01",
      });
      expect(op).not.toBeNull();
      expect(JSON.stringify(dispatchRespond.mock.calls[0][0].blocks)).toContain(
        op?.operationId ?? "",
      );
    }
  });

  it("rejects non-startup project dispatch and ship on a registry-backed real DispatchQueue without operationsStore instead of falling back to startup Alpha", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const featureId = "052-rollout-smoke";
    const root = mkdtempSync(join(tmpdir(), "gwrk-slack-nondurable-realq-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));

    const alpha = initCheckout(
      SYNTHETIC_PROJECT_ALPHA,
      join(root, "alpha"),
      featureId,
    );
    const beta = initCheckout(
      SYNTHETIC_PROJECT_BETA,
      join(root, "beta"),
      featureId,
    );
    const betaOperator = "U_BETA_ONLY_OPERATOR";
    const betaThread = {
      ...SYNTHETIC_THREAD_ALPHA,
      featureId,
      projectId: beta.projectId,
      channelId: SYNTHETIC_CHANNEL_BETA,
      rootTs: "1731320010.000100",
    };

    const sqlite = await vi.importActual<
      typeof import("../adapters/sqlite/index.js")
    >("../adapters/sqlite/index.js");
    const { DispatchQueue } =
      await vi.importActual<typeof import("./dispatch.js")>("./dispatch.js");
    const { GwrkConfigSchema } =
      await vi.importActual<typeof import("../utils/config.js")>(
        "../utils/config.js",
      );

    const registry = sqlite.createSqliteProjectRegistryAdapter({
      dbPath: ":memory:",
    });
    onTestFinished(() => registry.close());
    registry.enrollProject({ ...alpha, legacyProjectIds: [] });
    registry.enrollProject({ ...beta, legacyProjectIds: [] });
    registry.setRoleBinding({
      projectId: alpha.projectId,
      principalType: "slack_user",
      principalId: `${SYNTHETIC_WORKSPACE_ID}:${SYNTHETIC_USER_MAINTAINER}`,
      role: "maintainer",
    });
    registry.setRoleBinding({
      projectId: beta.projectId,
      principalType: "slack_user",
      principalId: `${SYNTHETIC_WORKSPACE_ID}:${betaOperator}`,
      role: "operator",
    });
    registry.bindFeatureThread(betaThread);

    const config = GwrkConfigSchema.parse({
      project: { name: "alpha" },
      agents: { implement: "agy" },
    });
    // Real DispatchQueue backed by registry, WITHOUT ledger or operationsStore
    const queue = new DispatchQueue(
      config,
      { isThrottled: () => true } as unknown as SystemMonitor,
      mockDeps.sandbox,
      alpha.localRoot,
      undefined,
      undefined,
      undefined,
      registry,
    );
    onTestFinished(() => queue.close());

    await startSlackApp({
      ...mockDeps,
      queue,
      projectRoot: alpha.localRoot,
      config,
      registry,
    });
    const handler = vi.mocked(getSlackApp()!.command).mock.calls[0][1];

    for (const subcmd of ["dispatch", "ship"]) {
      const ack = vi.fn();
      const respond = vi.fn();
      const postEphemeral = vi.fn();
      await handler({
        command: {
          command: "/gwrk",
          text: `${subcmd} ${featureId} 1 --project beta`,
          channel_id: SYNTHETIC_CHANNEL_BETA,
          user_id: betaOperator,
          team_id: SYNTHETIC_WORKSPACE_ID,
        },
        ack,
        respond,
        client: { chat: { postEphemeral } },
      } as Parameters<typeof handler>[0]);

      expect(ack).toHaveBeenCalledOnce();
      expect(respond).not.toHaveBeenCalled();
      expect(postEphemeral).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          channel: SYNTHETIC_CHANNEL_BETA,
          user: betaOperator,
          thread_ts: betaThread.rootTs,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: ":warning: The dispatch queue is unavailable for this project.",
              },
            },
          ],
        }),
      );
    }

    // Zero fallback to startup Alpha!
    expect(queue.getQueue().active).toHaveLength(0);
    expect(queue.getQueue().queued).toHaveLength(0);

    // Startup single-project legacy behavior for Alpha remains intact
    const alphaAck = vi.fn();
    const alphaRespond = vi.fn();
    await handler({
      command: {
        command: "/gwrk",
        text: `dispatch ${featureId} 1`,
        channel_id: SYNTHETIC_CHANNEL_ALPHA,
        user_id: SYNTHETIC_USER_MAINTAINER,
        team_id: SYNTHETIC_WORKSPACE_ID,
      },
      ack: alphaAck,
      respond: alphaRespond,
      client: { chat: { postEphemeral: vi.fn() } },
    } as Parameters<typeof handler>[0]);
    expect(alphaAck).toHaveBeenCalledOnce();
    expect(alphaRespond).toHaveBeenCalledOnce();
    expect(queue.getQueue(alpha.projectId).queued).toHaveLength(1);
    expect(queue.getQueue(alpha.projectId).queued[0].projectId).toBe(
      alpha.projectId,
    );
  });

  it("denies global /gwrk pause on a shared multi-project queue for both Beta and startup Alpha operators while preserving isolated single-project pause", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const featureId = "052-rollout-smoke";
    const root = mkdtempSync(join(tmpdir(), "gwrk-slack-pause-scope-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));

    const alpha = initCheckout(
      SYNTHETIC_PROJECT_ALPHA,
      join(root, "alpha"),
      featureId,
    );
    const beta = initCheckout(
      {
        ...SYNTHETIC_PROJECT_BETA,
        slug: "right-side-up",
        name: "Right Side Up!",
        repoSlug: "gforge-esc/right-side-up",
        slack: {
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: "C_SHARED_ROLLOUT",
          sharedChannel: true,
        },
      },
      join(root, "beta"),
      featureId,
    );
    const gamma = initCheckout(
      {
        ...SYNTHETIC_PROJECT_BETA,
        projectId: "proj-gamma-placeholder",
        slug: "aftermath-afterglow",
        name: "Aftermath, Afterglow",
        repoSlug: "dgonzo/aftermath-afterglow",
        trunkBranch: "main",
        slack: {
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: "C_SHARED_ROLLOUT",
          sharedChannel: true,
        },
      },
      join(root, "gamma"),
      featureId,
    );

    const { openDatabase } =
      await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
    const sqlite = await vi.importActual<
      typeof import("../adapters/sqlite/index.js")
    >("../adapters/sqlite/index.js");
    const { DispatchQueue } =
      await vi.importActual<typeof import("./dispatch.js")>("./dispatch.js");
    const { GwrkConfigSchema } =
      await vi.importActual<typeof import("../utils/config.js")>(
        "../utils/config.js",
      );

    const db = openDatabase({ dbPath: join(root, "shared.db") });
    onTestFinished(() => db.close());
    const registry = sqlite.createSqliteProjectRegistryAdapter({ db });
    const store = sqlite.createSqliteOperationsStoreAdapter({ db });

    for (const proj of [alpha, beta, gamma]) {
      registry.enrollProject({ ...proj, legacyProjectIds: [] });
    }
    const alphaOnlyOp = "U_ALPHA_ONLY_OP";
    const betaOnlyOp = "U_BETA_ONLY_OP";
    registry.setRoleBinding({
      projectId: alpha.projectId,
      principalType: "slack_user",
      principalId: `${SYNTHETIC_WORKSPACE_ID}:${alphaOnlyOp}`,
      role: "operator",
    });
    registry.setRoleBinding({
      projectId: beta.projectId,
      principalType: "slack_user",
      principalId: `${SYNTHETIC_WORKSPACE_ID}:${betaOnlyOp}`,
      role: "operator",
    });

    const launchPhaseShip = vi.fn(async () => ({ exitCode: 0, stderr: "" }));
    const config = GwrkConfigSchema.parse({
      project: { name: "gwrk" },
      agents: { implement: "agy" },
    });
    const sharedQueue = new DispatchQueue(
      config,
      { isThrottled: () => false } as unknown as SystemMonitor,
      mockDeps.sandbox,
      alpha.localRoot,
      { db, projectId: alpha.projectId },
      undefined,
      undefined,
      {
        store,
        registry,
        worker: {
          inspectRecoveredWork: vi.fn(),
          launchPhaseShip,
          cleanupStaleSandbox: vi.fn(),
        },
        notifier: { notify: vi.fn() } as never,
        heartbeatIntervalMs: null,
      },
    );
    onTestFinished(() => sharedQueue.close());
    await sharedQueue.recoverOnStartup();

    await startSlackApp({
      ...mockDeps,
      queue: sharedQueue,
      projectRoot: alpha.localRoot,
      config,
      registry,
    });
    const handler = vi.mocked(getSlackApp()!.command).mock.calls[0][1];

    // 1. Beta-only operator cannot pause shared queue
    const betaAck = vi.fn();
    const betaRespond = vi.fn();
    await handler({
      command: {
        command: "/gwrk",
        text: "pause --project right-side-up",
        channel_id: "C_SHARED_ROLLOUT",
        user_id: betaOnlyOp,
        team_id: SYNTHETIC_WORKSPACE_ID,
      },
      ack: betaAck,
      respond: betaRespond,
      client: { chat: { postEphemeral: vi.fn() } },
    } as Parameters<typeof handler>[0]);
    expect(betaAck).toHaveBeenCalledOnce();
    expect(betaRespond).toHaveBeenCalledOnce();
    expect(betaRespond.mock.calls[0][0].response_type).toBe("ephemeral");
    expect(JSON.stringify(betaRespond.mock.calls[0][0].blocks)).toContain(
      ":warning:",
    );
    expect(sharedQueue.getQueue().paused).toBe(false);

    // 2. Startup Alpha-only operator also cannot pause shared multi-project queue
    const alphaAck = vi.fn();
    const alphaRespond = vi.fn();
    await handler({
      command: {
        command: "/gwrk",
        text: "pause",
        channel_id: SYNTHETIC_CHANNEL_ALPHA,
        user_id: alphaOnlyOp,
        team_id: SYNTHETIC_WORKSPACE_ID,
      },
      ack: alphaAck,
      respond: alphaRespond,
      client: { chat: { postEphemeral: vi.fn() } },
    } as Parameters<typeof handler>[0]);
    expect(alphaAck).toHaveBeenCalledOnce();
    expect(alphaRespond).toHaveBeenCalledOnce();
    expect(alphaRespond.mock.calls[0][0].response_type).toBe("ephemeral");
    expect(JSON.stringify(alphaRespond.mock.calls[0][0].blocks)).toContain(
      ":warning:",
    );
    expect(sharedQueue.getQueue().paused).toBe(false);

    // 3. Foreign Gamma work still claims and runs on the shared queue
    sharedQueue.accept({
      projectId: gamma.projectId,
      featureId,
      phaseId: "phase-01",
    });
    await vi.waitFor(() => {
      expect(launchPhaseShip).toHaveBeenCalledWith(
        expect.objectContaining({
          projectRoot: gamma.localRoot,
          featureId,
          phaseId: "phase-01",
        }),
      );
    });

    await stopSlackApp();
    resetSlackApp();

    // 4. Isolated single-project durable queue still allows pause
    const soloDb = openDatabase({ dbPath: join(root, "solo.db") });
    onTestFinished(() => soloDb.close());
    const soloRegistry = sqlite.createSqliteProjectRegistryAdapter({
      db: soloDb,
    });
    const soloStore = sqlite.createSqliteOperationsStoreAdapter({ db: soloDb });
    soloRegistry.enrollProject({ ...alpha, legacyProjectIds: [] });
    soloRegistry.setRoleBinding({
      projectId: alpha.projectId,
      principalType: "slack_user",
      principalId: `${SYNTHETIC_WORKSPACE_ID}:${alphaOnlyOp}`,
      role: "operator",
    });
    const soloQueue = new DispatchQueue(
      config,
      { isThrottled: () => false } as unknown as SystemMonitor,
      mockDeps.sandbox,
      alpha.localRoot,
      { db: soloDb, projectId: alpha.projectId },
      undefined,
      undefined,
      {
        store: soloStore,
        registry: soloRegistry,
        worker: {
          inspectRecoveredWork: vi.fn(),
          launchPhaseShip: vi.fn(async () => ({ exitCode: 0, stderr: "" })),
          cleanupStaleSandbox: vi.fn(),
        },
        notifier: { notify: vi.fn() } as never,
        heartbeatIntervalMs: null,
      },
    );
    onTestFinished(() => soloQueue.close());
    await startSlackApp({
      ...mockDeps,
      queue: soloQueue,
      projectRoot: alpha.localRoot,
      config,
      registry: soloRegistry,
    });
    const soloHandler = vi.mocked(getSlackApp()!.command).mock.calls.at(-1)![1];
    const soloAck = vi.fn();
    const soloRespond = vi.fn();
    await soloHandler({
      command: {
        command: "/gwrk",
        text: "pause",
        channel_id: SYNTHETIC_CHANNEL_ALPHA,
        user_id: alphaOnlyOp,
        team_id: SYNTHETIC_WORKSPACE_ID,
      },
      ack: soloAck,
      respond: soloRespond,
      client: { chat: { postEphemeral: vi.fn() } },
    } as Parameters<typeof soloHandler>[0]);
    expect(soloAck).toHaveBeenCalledOnce();
    expect(JSON.stringify(soloRespond.mock.calls[0][0].blocks)).toContain(
      "Dispatch queue paused",
    );
    expect(soloQueue.getQueue().paused).toBe(true);
  });

  it("handles DM /gwrk dispatch and ship and intake errors on a real durable DispatchQueue with ack() and zero wrong-project side effects", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const featureId = "052-rollout-smoke";
    const root = mkdtempSync(join(tmpdir(), "gwrk-slack-dm-intake-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));

    const alpha = initCheckout(
      SYNTHETIC_PROJECT_ALPHA,
      join(root, "gwrk"),
      featureId,
    );
    const beta = initCheckout(
      {
        ...SYNTHETIC_PROJECT_BETA,
        slug: "right-side-up",
        name: "Right Side Up!",
        repoSlug: "gforge-esc/right-side-up",
        slack: {
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: "C_SHARED_ROLLOUT",
          sharedChannel: true,
        },
      },
      join(root, "right-side-up"),
      featureId,
    );
    const gamma = initCheckout(
      {
        ...SYNTHETIC_PROJECT_BETA,
        projectId: "proj-gamma-placeholder",
        slug: "aftermath-afterglow",
        name: "Aftermath, Afterglow",
        repoSlug: "dgonzo/aftermath-afterglow",
        trunkBranch: "main",
        slack: {
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: "C_SHARED_ROLLOUT",
          sharedChannel: true,
        },
      },
      join(root, "aftermath-afterglow"),
      featureId,
    );

    const { openDatabase } =
      await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
    const sqlite = await vi.importActual<
      typeof import("../adapters/sqlite/index.js")
    >("../adapters/sqlite/index.js");
    const { DispatchQueue, DispatchIntakeError } =
      await vi.importActual<typeof import("./dispatch.js")>("./dispatch.js");
    const { GwrkConfigSchema } =
      await vi.importActual<typeof import("../utils/config.js")>(
        "../utils/config.js",
      );
    const { createProjectRoutingService } = await vi.importActual<
      typeof import("../application/project-routing/index.js")
    >("../application/project-routing/index.js");
    const { handleSlashCommand } = await vi.importActual<
      typeof import("./slack-commands.js")
    >("./slack-commands.js");

    const db = openDatabase({ dbPath: join(root, "gwrk.db") });
    onTestFinished(() => db.close());
    const registry = sqlite.createSqliteProjectRegistryAdapter({ db });
    const store = sqlite.createSqliteOperationsStoreAdapter({ db });

    const betaOnlyOp = "U_BETA_DM_OP";
    for (const proj of [alpha, beta, gamma]) {
      registry.enrollProject({ ...proj, legacyProjectIds: [] });
    }
    registry.setRoleBinding({
      projectId: beta.projectId,
      principalType: "slack_user",
      principalId: `${SYNTHETIC_WORKSPACE_ID}:${betaOnlyOp}`,
      role: "operator",
    });
    registry.setRoleBinding({
      projectId: gamma.projectId,
      principalType: "slack_user",
      principalId: `${SYNTHETIC_WORKSPACE_ID}:${SYNTHETIC_USER_MAINTAINER}`,
      role: "maintainer",
    });

    const config = GwrkConfigSchema.parse({
      project: { name: "gwrk" },
      agents: { implement: "agy" },
    });
    const queue = new DispatchQueue(
      config,
      { isThrottled: () => true } as unknown as SystemMonitor,
      mockDeps.sandbox,
      alpha.localRoot,
      { db, projectId: alpha.projectId },
      undefined,
      undefined,
      {
        store,
        registry,
        worker: {
          inspectRecoveredWork: vi.fn(),
          launchPhaseShip: vi.fn(async () => ({ exitCode: 0, stderr: "" })),
          cleanupStaleSandbox: vi.fn(),
        },
        notifier: { notify: vi.fn() } as never,
        heartbeatIntervalMs: null,
      },
    );
    onTestFinished(() => queue.close());

    await startSlackApp({
      ...mockDeps,
      queue,
      projectRoot: alpha.localRoot,
      config,
      registry,
    });
    const handler = vi.mocked(getSlackApp()!.command).mock.calls[0][1];

    // 1. DM /gwrk dispatch acknowledges once, responds in DM, and binds durable recipient to project channel
    const dmAck = vi.fn();
    const dmRespond = vi.fn();
    await handler({
      command: {
        command: "/gwrk",
        text: `dispatch ${featureId} 1 --project right-side-up`,
        channel_id: "D_TEST_DM",
        user_id: betaOnlyOp,
        team_id: SYNTHETIC_WORKSPACE_ID,
      },
      ack: dmAck,
      respond: dmRespond,
      client: { chat: { postEphemeral: vi.fn() } },
    } as Parameters<typeof handler>[0]);

    expect(dmAck).toHaveBeenCalledOnce();
    expect(dmRespond).toHaveBeenCalledOnce();
    expect(dmRespond.mock.calls[0][0].response_type).toBe("in_channel");
    expect(dmRespond.mock.calls[0][0]).not.toHaveProperty("thread_ts");
    const betaOp1 = store.getDispatchOperation({
      projectId: beta.projectId,
      featureId,
      phaseId: "phase-01",
    });
    expect(betaOp1).not.toBeNull();
    expect(betaOp1?.recipient).toEqual({
      projectId: beta.projectId,
      surface: "slack",
      workspaceId: SYNTHETIC_WORKSPACE_ID,
      channelId: "C_SHARED_ROLLOUT",
      actorUserId: betaOnlyOp,
    });
    expect(
      store.getDispatchOperation({
        projectId: alpha.projectId,
        featureId,
        phaseId: "phase-01",
      }),
    ).toBeNull();

    // 2. DM threadTs is never copied into the bound project channel recipient
    const routingService = createProjectRoutingService({ registry });
    const dmThreadResponse = await handleSlashCommand(
      `ship ${featureId} 2 --project right-side-up`,
      {
        userId: betaOnlyOp,
        channelId: "D_TEST_DM",
        workspaceId: SYNTHETIC_WORKSPACE_ID,
        threadTs: "1731399999.000777",
        projectRoot: alpha.localRoot,
        buildServerUrl: "http://localhost:3000",
        queue,
        queueProjectId: alpha.projectId,
        monitor: mockDeps.monitor,
        git: mockDeps.git,
        routingService,
      },
    );
    expect(dmThreadResponse.response_type).toBe("in_channel");
    expect(dmThreadResponse.thread_ts).toBe("1731399999.000777");
    const betaOp2 = store.getDispatchOperation({
      projectId: beta.projectId,
      featureId,
      phaseId: "phase-02",
    });
    expect(betaOp2).not.toBeNull();
    expect(betaOp2?.recipient?.channelId).toBe("C_SHARED_ROLLOUT");
    expect(betaOp2?.recipient?.threadTs).toBeUndefined();

    // 3. Unverified thread in shared channel throws DispatchIntakeError inside real queue.accept,
    // which handleSlashCommand catches cleanly without falling through to enqueue
    const sharedThreadErr = await handleSlashCommand(
      `dispatch ${featureId} 3 --project aftermath-afterglow`,
      {
        userId: SYNTHETIC_USER_MAINTAINER,
        channelId: "C_SHARED_ROLLOUT",
        workspaceId: SYNTHETIC_WORKSPACE_ID,
        threadTs: "1731388888.000111",
        projectRoot: alpha.localRoot,
        buildServerUrl: "http://localhost:3000",
        queue,
        queueProjectId: alpha.projectId,
        monitor: mockDeps.monitor,
        git: mockDeps.git,
        routingService,
      },
    );
    expect(sharedThreadErr.response_type).toBe("ephemeral");
    expect(JSON.stringify(sharedThreadErr.blocks)).toContain(
      "Unverified thread hint is not allowed in a shared Slack channel",
    );

    // 4. Throwing DispatchIntakeError in /gwrk command handler still calls ack() once and leaves zero side effects
    const acceptSpy = vi.spyOn(queue, "accept").mockImplementationOnce(() => {
      throw new DispatchIntakeError(
        403,
        "Recipient channel does not match authorized project.",
      );
    });
    const errAck = vi.fn();
    const errRespond = vi.fn();
    await handler({
      command: {
        command: "/gwrk",
        text: `ship ${featureId} 4 --project aftermath-afterglow`,
        channel_id: "C_SHARED_ROLLOUT",
        user_id: SYNTHETIC_USER_MAINTAINER,
        team_id: SYNTHETIC_WORKSPACE_ID,
      },
      ack: errAck,
      respond: errRespond,
      client: { chat: { postEphemeral: vi.fn() } },
    } as Parameters<typeof handler>[0]);
    acceptSpy.mockRestore();

    expect(errAck).toHaveBeenCalledOnce();
    expect(errRespond).toHaveBeenCalledOnce();
    expect(errRespond.mock.calls[0][0].response_type).toBe("ephemeral");
    expect(JSON.stringify(errRespond.mock.calls[0][0].blocks)).toContain(
      "Recipient channel does not match authorized project.",
    );
    for (const proj of [alpha, beta, gamma]) {
      expect(
        store.getDispatchOperation({
          projectId: proj.projectId,
          featureId,
          phaseId: "phase-03",
        }),
      ).toBeNull();
      expect(
        store.getDispatchOperation({
          projectId: proj.projectId,
          featureId,
          phaseId: "phase-04",
        }),
      ).toBeNull();
    }
    expect(queue.getQueue(alpha.projectId).queued).toHaveLength(0);
    expect(queue.getQueue(gamma.projectId).queued).toHaveLength(0);
  });

  it("reports real queued and active phase-01 feature status per project without leaking same-feature operations across projects", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const featureId = "052-rollout-smoke";
    const root = mkdtempSync(join(tmpdir(), "gwrk-slack-feat-status-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));

    const alpha = initCheckout(
      SYNTHETIC_PROJECT_ALPHA,
      join(root, "gwrk"),
      featureId,
    );
    const beta = initCheckout(
      {
        ...SYNTHETIC_PROJECT_BETA,
        slug: "right-side-up",
        name: "Right Side Up!",
        repoSlug: "gforge-esc/right-side-up",
        slack: {
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: "C_SHARED_ROLLOUT",
          sharedChannel: true,
        },
      },
      join(root, "right-side-up"),
      featureId,
    );
    const gamma = initCheckout(
      {
        ...SYNTHETIC_PROJECT_BETA,
        projectId: "proj-gamma-placeholder",
        slug: "aftermath-afterglow",
        name: "Aftermath, Afterglow",
        repoSlug: "dgonzo/aftermath-afterglow",
        trunkBranch: "main",
        slack: {
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: "C_SHARED_ROLLOUT",
          sharedChannel: true,
        },
      },
      join(root, "aftermath-afterglow"),
      featureId,
    );

    const { openDatabase } =
      await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
    const sqlite = await vi.importActual<
      typeof import("../adapters/sqlite/index.js")
    >("../adapters/sqlite/index.js");
    const { DispatchQueue } =
      await vi.importActual<typeof import("./dispatch.js")>("./dispatch.js");
    const { GwrkConfigSchema } =
      await vi.importActual<typeof import("../utils/config.js")>(
        "../utils/config.js",
      );

    const db = openDatabase({ dbPath: join(root, "gwrk.db") });
    onTestFinished(() => db.close());
    const registry = sqlite.createSqliteProjectRegistryAdapter({ db });
    const store = sqlite.createSqliteOperationsStoreAdapter({ db });

    const betaViewer = "U_BETA_VIEWER";
    const gammaViewer = "U_GAMMA_VIEWER";
    for (const proj of [alpha, beta, gamma]) {
      registry.enrollProject({ ...proj, legacyProjectIds: [] });
    }
    registry.setRoleBinding({
      projectId: beta.projectId,
      principalType: "slack_user",
      principalId: `${SYNTHETIC_WORKSPACE_ID}:${betaViewer}`,
      role: "viewer",
    });
    registry.setRoleBinding({
      projectId: gamma.projectId,
      principalType: "slack_user",
      principalId: `${SYNTHETIC_WORKSPACE_ID}:${gammaViewer}`,
      role: "viewer",
    });

    let throttled = true;
    let releaseBetaWorker!: () => void;
    const betaWorkerGate = new Promise<void>((resolve) => {
      releaseBetaWorker = resolve;
    });
    const launchPhaseShip = vi.fn(
      async ({ projectRoot }: { projectRoot: string }) => {
        if (projectRoot === beta.localRoot) {
          await betaWorkerGate;
        }
        return { exitCode: 0, stderr: "" };
      },
    );

    const config = GwrkConfigSchema.parse({
      project: { name: "gwrk" },
      agents: { implement: "agy" },
    });
    const queue = new DispatchQueue(
      config,
      { isThrottled: () => throttled } as unknown as SystemMonitor,
      mockDeps.sandbox,
      alpha.localRoot,
      { db, projectId: alpha.projectId },
      undefined,
      undefined,
      {
        store,
        registry,
        worker: {
          inspectRecoveredWork: vi.fn(),
          launchPhaseShip,
          cleanupStaleSandbox: vi.fn(),
        },
        notifier: { notify: vi.fn() } as never,
        heartbeatIntervalMs: null,
      },
    );
    onTestFinished(() => {
      releaseBetaWorker();
      return queue.close();
    });

    // Enqueue phase-02 on Alpha and phase-01 on Beta for the SAME featureId
    queue.accept({
      projectId: alpha.projectId,
      featureId,
      phaseId: "phase-02",
    });
    queue.accept({
      projectId: beta.projectId,
      featureId,
      phaseId: "phase-01",
    });

    await startSlackApp({
      ...mockDeps,
      queue,
      projectRoot: alpha.localRoot,
      config,
      registry,
    });
    const handler = vi.mocked(getSlackApp()!.command).mock.calls[0][1];

    // 1. Beta viewer sees Beta's queued phase-01, NOT Alpha's phase-02 and NOT "No dispatch runs found."
    const betaQueuedRespond = vi.fn();
    await handler({
      command: {
        command: "/gwrk",
        text: `status ${featureId} --project right-side-up`,
        channel_id: "C_SHARED_ROLLOUT",
        user_id: betaViewer,
        team_id: SYNTHETIC_WORKSPACE_ID,
      },
      ack: vi.fn(),
      respond: betaQueuedRespond,
      client: { chat: { postEphemeral: vi.fn() } },
    } as Parameters<typeof handler>[0]);
    const betaQueuedText = JSON.stringify(
      betaQueuedRespond.mock.calls[0][0].blocks,
    );
    expect(betaQueuedText).toContain(
      `*Feature ${featureId}:* queued (phase-01)`,
    );
    expect(betaQueuedText).not.toContain("phase-02");
    expect(betaQueuedText).not.toContain("No dispatch runs found.");

    // 2. Gamma viewer sees NO dispatch runs for the same featureId
    const gammaRespond = vi.fn();
    await handler({
      command: {
        command: "/gwrk",
        text: `status ${featureId} --project aftermath-afterglow`,
        channel_id: "C_SHARED_ROLLOUT",
        user_id: gammaViewer,
        team_id: SYNTHETIC_WORKSPACE_ID,
      },
      ack: vi.fn(),
      respond: gammaRespond,
      client: { chat: { postEphemeral: vi.fn() } },
    } as Parameters<typeof handler>[0]);
    const gammaText = JSON.stringify(gammaRespond.mock.calls[0][0].blocks);
    expect(gammaText).toContain(
      `*Feature ${featureId}:* No dispatch runs found.`,
    );
    expect(gammaText).not.toContain("phase-01");
    expect(gammaText).not.toContain("phase-02");

    // 3. Unthrottle and verify Beta viewer sees running (phase-01) while active
    throttled = false;
    await queue.recoverOnStartup();
    await vi.waitFor(() => {
      expect(launchPhaseShip).toHaveBeenCalledWith(
        expect.objectContaining({ projectRoot: beta.localRoot }),
      );
    });

    const betaRunningRespond = vi.fn();
    await handler({
      command: {
        command: "/gwrk",
        text: `status ${featureId} --project right-side-up`,
        channel_id: "C_SHARED_ROLLOUT",
        user_id: betaViewer,
        team_id: SYNTHETIC_WORKSPACE_ID,
      },
      ack: vi.fn(),
      respond: betaRunningRespond,
      client: { chat: { postEphemeral: vi.fn() } },
    } as Parameters<typeof handler>[0]);
    const betaRunningText = JSON.stringify(
      betaRunningRespond.mock.calls[0][0].blocks,
    );
    expect(betaRunningText).toContain(
      `*Feature ${featureId}:* running (phase-01)`,
    );
    expect(betaRunningText).not.toContain("phase-02");

    releaseBetaWorker();
  });
});
