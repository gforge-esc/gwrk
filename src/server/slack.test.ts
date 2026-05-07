import { App } from "@slack/bolt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

    const mockDeps = {
      queue: { command: vi.fn() } as unknown as DispatchQueue,
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

    await startSlackApp(mockDeps);
    expect(console.log).toHaveBeenCalledWith("⚡️ Slack Bolt app is running!");

    await stopSlackApp();
    expect(console.log).toHaveBeenCalledWith("🛑 Slack Bolt app stopped.");
  });
});
