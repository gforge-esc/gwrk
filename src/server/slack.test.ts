/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { App } from "@slack/bolt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYNTHETIC_CHANNEL_ALPHA,
  SYNTHETIC_PROJECT_ALPHA,
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
    queue: { enqueue: vi.fn() } as unknown as DispatchQueue,
    monitor: {
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
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

  it("responds to a feature slash command in its stored thread", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const featureId = "048-project-identity-slack";
    const registry = createSyntheticRegistry({
      projects: [{ ...SYNTHETIC_PROJECT_ALPHA, localRoot: process.cwd() }],
      threads: [{ ...SYNTHETIC_THREAD_ALPHA, featureId }],
    });
    await startSlackApp({ ...mockDeps, registry });
    const app = getSlackApp()!;
    expect(app.command).toHaveBeenCalledWith("/gwrk", expect.any(Function));
    const handler = vi.mocked(app.command).mock.calls[0][1];
    const ack = vi.fn();
    const respond = vi.fn();
    await handler({
      command: {
        command: "/gwrk",
        text: `dispatch ${featureId} 3`,
        channel_id: SYNTHETIC_CHANNEL_ALPHA,
        user_id: SYNTHETIC_USER_MAINTAINER,
        team_id: SYNTHETIC_WORKSPACE_ID,
      },
      ack,
      respond,
    } as Parameters<typeof handler>[0]);
    expect(ack).toHaveBeenCalledOnce();
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
      ts: "1731320000.000100",
    };

    await handlers.app_mention({
      event: {
        ...message,
        type: "app_mention",
        text: "<@B_TEST> status of 003-slack",
        channel: SYNTHETIC_CHANNEL_ALPHA,
      },
      body: { team_id: SYNTHETIC_WORKSPACE_ID },
      context: {},
      say,
    });
    expect(say).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Checking status"),
      }),
    );

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

  it.each([
    { bot_id: "B_SELF" },
    { subtype: "bot_message" },
    { subtype: "message_changed" },
  ])("does not reply to DM events with %j", async (metadata) => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    await startSlackApp({ ...mockDeps, registry: createSyntheticRegistry() });
    const app = getSlackApp()!;
    const handlers = Object.fromEntries(vi.mocked(app.event).mock.calls);
    const say = vi.fn();
    await handlers.message({
      event: {
        ...metadata,
        type: "message",
        channel_type: "im",
        channel: "D_TEST",
        ts: "1731320000.000100",
      },
      body: { team_id: SYNTHETIC_WORKSPACE_ID },
      context: {},
      say,
    });
    expect(say).not.toHaveBeenCalled();
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
