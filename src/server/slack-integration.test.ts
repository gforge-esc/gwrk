/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { App } from "@slack/bolt";
import { type Mocked, beforeEach, describe, expect, it, vi } from "vitest";
import type { GwrkConfig } from "../utils/config.js";
import type { DispatchQueue } from "./dispatch.js";
import type { GitManager } from "./git-manager.js";
import type { LifecycleMonitor } from "./lifecycle.js";
import type { SystemMonitor } from "./monitor.js";
import type { NetworkMonitor } from "./network.js";
import type { SandboxManager } from "./sandbox.js";
import { startSlackApp } from "./slack.js";

// Mock @slack/bolt
vi.mock("@slack/bolt", () => {
  const App = vi.fn().mockImplementation(() => ({
    command: vi.fn(),
    action: vi.fn(),
    event: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    client: {
      auth: {
        test: vi.fn().mockResolvedValue({ user_id: "U_TEST" }),
      },
    },
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
  let mockQueue: Mocked<DispatchQueue>;
  let mockMonitor: Mocked<SystemMonitor>;
  let mockGit: Mocked<GitManager>;

  beforeEach(() => {
    mockQueue = {} as unknown as Mocked<DispatchQueue>;
    mockMonitor = {} as unknown as Mocked<SystemMonitor>;
    mockGit = {} as unknown as Mocked<GitManager>;
  });

  it("starts the Slack app and registers handlers", async () => {
    await startSlackApp({
      queue: mockQueue,
      monitor: mockMonitor,
      sandbox: {} as unknown as Mocked<SandboxManager>,
      lifecycle: {
        getStatus: () => "ready",
      } as unknown as Mocked<LifecycleMonitor>,
      network: {
        getStatus: () => "online",
      } as unknown as Mocked<NetworkMonitor>,
      git: mockGit,
      projectRoot: "/tmp",
      config: {
        server: { port: 18790, host: "localhost" },
        project: { slack: { channelId: "C_TEST" } },
      } as unknown as GwrkConfig,
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
