/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { App } from "@slack/bolt";
import {
  type Mocked,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { GwrkConfig } from "../utils/config.js";
import { MessageBuilder } from "./slack-messages.js";
import { type SlackEvent, presenceManager } from "./slack-presence.js";
import { getSlackApp } from "./slack.js";

// Mock dependencies
vi.mock("./slack.js", () => ({
  getSlackApp: vi.fn(),
}));

vi.mock("../utils/config.js", () => ({
  loadConfig: vi.fn(() => ({
    project: { slack: { channelId: "C123" } },
    server: { slack: { presencePollIntervalMs: 1000 } },
  })),
}));

vi.mock("./slack-notify.js", () => ({
  notifySlack: vi.fn(),
  sendSlackMessage: vi.fn(),
}));

describe("PresenceManager", () => {
  let mockApp: Mocked<App>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockApp = {
      client: {
        users: {
          list: vi.fn().mockResolvedValue({
            ok: true,
            members: [
              { id: "U123", name: "human-user", is_bot: false },
              { id: "B123", name: "bot-user", is_bot: true },
            ],
          }),
          getPresence: vi
            .fn()
            .mockResolvedValue({ ok: true, presence: "active" }),
        },
        chat: {
          postMessage: vi.fn().mockResolvedValue({ ok: true }),
        },
      },
    } as unknown as Mocked<App>;

    vi.mocked(getSlackApp).mockReturnValue(mockApp);
  });

  afterEach(() => {
    presenceManager.stop();
    vi.useRealTimers();
  });

  const mockConfig = {
    project: { name: "test" },
    agents: { define: "gemini", implement: "codex-cloud" },
    server: {
      port: 0,
      host: "localhost",
      slack: { presencePollIntervalMs: 1000 },
    },
  } as unknown as GwrkConfig;

  it("should initialize and poll presence", async () => {
    await presenceManager.init(mockConfig);
    expect(mockApp.client.users.list).toHaveBeenCalled();
    expect(mockApp.client.users.getPresence).toHaveBeenCalledWith({
      user: "U123",
    });
  });

  it("should deliver notifications immediately when active", async () => {
    await presenceManager.init(mockConfig);
    mockApp.client.users.getPresence.mockResolvedValue({
      ok: true,
      presence: "active",
      // biome-ignore lint/suspicious/noExplicitAny: complex mock
    } as any);
    await vi.runOnlyPendingTimersAsync();

    const event: SlackEvent = {
      type: "phase_start",
      feature: "feat-1",
      payload: {},
      timestamp: "...",
    };
    const message = MessageBuilder.phaseStart({
      id: "test",
      featureId: "feat-1",
      phaseId: "phase-01",
      backend: "gemini",
      status: "running",
      branchName: "main",
      attempts: [],
      createdAt: new Date().toISOString(),
    });

    const { notifySlack } = await import("./slack-notify.js");
    await presenceManager.handleNotification(event, message);

    expect(notifySlack).toHaveBeenCalled();
  });

  it("should queue notifications when away and flush when returning to active", async () => {
    await presenceManager.init(mockConfig);

    // Set to away
    mockApp.client.users.getPresence.mockResolvedValue({
      ok: true,
      presence: "away",
      // biome-ignore lint/suspicious/noExplicitAny: complex mock
    } as any);
    await vi.runOnlyPendingTimersAsync();

    const event: SlackEvent = {
      type: "phase_start",
      feature: "feat-1",
      payload: {},
      timestamp: "...",
    };
    const message = MessageBuilder.phaseStart({
      id: "test",
      featureId: "feat-1",
      phaseId: "phase-01",
      backend: "gemini",
      status: "running",
      branchName: "main",
      attempts: [],
      createdAt: new Date().toISOString(),
    });

    const { notifySlack, sendSlackMessage } = await import("./slack-notify.js");
    await presenceManager.handleNotification(event, message);

    expect(notifySlack).not.toHaveBeenCalled();

    // Set to active
    mockApp.client.users.getPresence.mockResolvedValue({
      ok: true,
      presence: "active",
      // biome-ignore lint/suspicious/noExplicitAny: complex mock
    } as any);
    await vi.runOnlyPendingTimersAsync();

    // Should have called sendSlackMessage with a batched summary (via flushQueue)
    expect(sendSlackMessage).toHaveBeenCalled();
    const calledMessage = vi.mocked(sendSlackMessage).mock.calls[0][0];
    expect(calledMessage.text).toContain("Batched Notification Summary");
  });
});
