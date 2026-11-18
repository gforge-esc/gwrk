/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
  SYNTHETIC_THREAD_ALPHA,
  SYNTHETIC_USER_MAINTAINER,
  SYNTHETIC_WORKSPACE_ID,
  createSyntheticRegistry,
} from "../../tests/helpers/synthetic-slack";
import { createSqliteProjectRegistryAdapter } from "../adapters/sqlite/index";
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

vi.mock("../db/runs.js", () => ({ listRuns: vi.fn(() => []) }));

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
    const registry = createSyntheticRegistry({
      projects: [{ ...SYNTHETIC_PROJECT_ALPHA, localRoot: process.cwd() }],
      threads: [{ ...SYNTHETIC_THREAD_ALPHA, featureId }],
    });
    await startSlackApp({ ...mockDeps, projectRoot: process.cwd(), registry });
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

  it("limits registered queue commands to the startup project with matching feature IDs", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const featureId = SYNTHETIC_THREAD_ALPHA.featureId;
    const root = mkdtempSync(join(tmpdir(), "gwrk-slack-queue-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const alpha = {
      ...SYNTHETIC_PROJECT_ALPHA,
      localRoot: join(root, "alpha"),
    };
    const beta = { ...SYNTHETIC_PROJECT_BETA, localRoot: join(root, "beta") };
    for (const project of [alpha, beta]) {
      mkdirSync(join(project.localRoot, "specs", featureId), {
        recursive: true,
      });
    }
    await startSlackApp({
      ...mockDeps,
      projectRoot: alpha.localRoot,
      registry: createSyntheticRegistry({ projects: [alpha, beta] }),
    });
    const handler = vi.mocked(getSlackApp()!.command).mock.calls[0][1];
    async function run(text: string, channelId: string) {
      const respond = vi.fn();
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
      } as Parameters<typeof handler>[0]);
      return respond.mock.calls[0][0];
    }

    const dispatch = `dispatch ${featureId} phase-03`;
    const alphaResponse = await run(dispatch, SYNTHETIC_CHANNEL_ALPHA);
    expect(alphaResponse.response_type).toBe("in_channel");
    expect(mockDeps.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
      featureId,
      phaseId: "phase-03",
    });
    vi.mocked(mockDeps.queue.enqueue).mockClear();

    for (const command of [dispatch, `status ${featureId}`, "pause"]) {
      const response = await run(command, SYNTHETIC_CHANNEL_BETA);
      expect.soft(response.response_type).toBe("ephemeral");
      expect.soft(JSON.stringify(response.blocks)).toContain("queue");
    }
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
});
