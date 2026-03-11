import { App } from "@slack/bolt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchQueue } from "./dispatch.js";
import type { GitManager } from "./git-manager.js";
import type { SystemMonitor } from "./monitor.js";
import { startSlackApp } from "./slack.js";

// Mock @slack/bolt
vi.mock("@slack/bolt", () => {
  const App = vi.fn().mockImplementation(() => ({
    command: vi.fn(),
    action: vi.fn(),
    event: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  }));
  return { App };
});

// Mock slack-client
vi.mock("../utils/slack-client.js", () => ({
  loadSlackConfig: vi.fn().mockReturnValue({
    botToken: "xoxb-test",
    appToken: "xapp-test",
  }),
}));

// Mock presenceManager
vi.mock("./slack-presence.js", () => ({
  presenceManager: {
    init: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  },
}));

describe("slack-integration", () => {
  let mockQueue: any;
  let mockMonitor: any;
  let mockGit: any;

  beforeEach(() => {
    mockQueue = {} as any;
    mockMonitor = {} as any;
    mockGit = {} as any;
  });

  it("starts the Slack app and registers handlers", async () => {
    await startSlackApp({
      queue: mockQueue as unknown as DispatchQueue,
      monitor: mockMonitor as unknown as SystemMonitor,
      sandbox: {} as any,
      lifecycle: { getStatus: () => "ready" } as any,
      network: { getStatus: () => "online" } as any,
      git: mockGit as unknown as GitManager,
      projectRoot: "/tmp",
      config: {
        server: { port: 18790, host: "localhost" },
      } as any,
    });

    const mockAppInstance = vi.mocked(App).mock.results[0].value;
    expect(mockAppInstance.command).toHaveBeenCalledWith(
      "/gwrk",
      expect.any(Function),
    );
    expect(mockAppInstance.action).toHaveBeenCalledWith(
      "merge_pr",
      expect.any(Function),
    );
    expect(mockAppInstance.event).toHaveBeenCalledWith(
      "reaction_added",
      expect.any(Function),
    );
    expect(mockAppInstance.start).toHaveBeenCalled();
  });
});
