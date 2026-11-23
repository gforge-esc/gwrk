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

  it("persists /gwrk dispatch receipt before ack() and launches worker only after ack()", async () => {
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
    const launchPhaseShip = vi.fn(async () => {
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
    onTestFinished(() => queue.close());
    await queue.recoverOnStartup();
    await new Promise((resolve) => setTimeout(resolve, 10));

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
      workerLaunchedBeforeAck = launchPhaseShip.mock.calls.length > 0;
      events.push("ack");
    });
    const respond = vi.fn();
    await handler({
      command: {
        command: "/gwrk",
        text: `dispatch ${featureId} 2`,
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
  });
});
