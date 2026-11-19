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
    } as any);
    await vi.runOnlyPendingTimersAsync();

    // Should have called sendSlackMessage with a batched summary (via flushQueue)
    expect(sendSlackMessage).toHaveBeenCalled();
    const calledMessage = vi.mocked(sendSlackMessage).mock.calls[0][0];
    expect(calledMessage.text).toContain("Batched Notification Summary");
  });

  it("TR-014: isolates away batches per project and flushes each project separately", async () => {
    const { sendSlackMessage } = await import("./slack-notify.js");
    vi.mocked(sendSlackMessage).mockClear();

    presenceManager.setUserPresence("U-same", "away");

    const alphaRecipient = {
      projectId: "proj-alpha",
      surface: "slack" as const,
      workspaceId: "W1",
      channelId: "C-alpha",
      threadTs: "1700000000.000111",
      actorUserId: "U-same",
    };
    const betaRecipient = {
      projectId: "proj-beta",
      surface: "slack" as const,
      workspaceId: "W1",
      channelId: "C-beta",
      threadTs: "1700000000.000222",
      actorUserId: "U-same",
    };

    const eventAlpha: SlackEvent = {
      type: "phase_start",
      feature: "feat-alpha",
      projectId: "proj-alpha",
      recipient: alphaRecipient,
      payload: {},
      timestamp: "...",
    };
    const eventBeta: SlackEvent = {
      type: "phase_complete",
      feature: "feat-beta",
      projectId: "proj-beta",
      recipient: betaRecipient,
      payload: {},
      timestamp: "...",
    };

    await presenceManager.handleNotification(eventAlpha, {
      text: "Alpha started",
      blocks: [],
    });
    await presenceManager.handleNotification(eventBeta, {
      text: "Beta completed",
      blocks: [],
    });

    expect(sendSlackMessage).not.toHaveBeenCalled();

    // Verify both are queued in their respective project queues
    expect(
      presenceManager.getScopedQueue("proj-alpha", "U-same")?.events,
    ).toHaveLength(1);
    expect(
      presenceManager.getScopedQueue("proj-beta", "U-same")?.events,
    ).toHaveLength(1);

    // Flush for user U-same
    await presenceManager.flushUserQueues("U-same");

    expect(sendSlackMessage).toHaveBeenCalledTimes(2);

    const calls = vi.mocked(sendSlackMessage).mock.calls;
    const alphaCall = calls.find(
      (c) => (c[1] as any)?.projectId === "proj-alpha",
    );
    const betaCall = calls.find(
      (c) => (c[1] as any)?.projectId === "proj-beta",
    );

    expect(alphaCall).toBeDefined();
    expect(alphaCall![0].channel).toBe("C-alpha");
    expect(alphaCall![0].thread_ts).toBe("1700000000.000111");
    expect(alphaCall![0].blocks[1].text.text).toContain("feat-alpha");
    expect(alphaCall![0].blocks[1].text.text).not.toContain("feat-beta");

    expect(betaCall).toBeDefined();
    expect(betaCall![0].channel).toBe("C-beta");
    expect(betaCall![0].thread_ts).toBe("1700000000.000222");
    expect(betaCall![0].blocks[1].text.text).toContain("feat-beta");
    expect(betaCall![0].blocks[1].text.text).not.toContain("feat-alpha");
  });

  it("TR-014: isolates away batches per recipient user and flushes only the active user", async () => {
    const { sendSlackMessage } = await import("./slack-notify.js");
    vi.mocked(sendSlackMessage).mockClear();

    presenceManager.setUserPresence("U-alice", "away");
    presenceManager.setUserPresence("U-bob", "away");

    const aliceRecipient = {
      projectId: "proj-alpha",
      surface: "slack" as const,
      workspaceId: "W1",
      channelId: "C-alpha",
      actorUserId: "U-alice",
    };
    const bobRecipient = {
      projectId: "proj-alpha",
      surface: "slack" as const,
      workspaceId: "W1",
      channelId: "C-alpha",
      actorUserId: "U-bob",
    };

    await presenceManager.handleNotification(
      {
        type: "phase_start",
        feature: "feat-alice",
        projectId: "proj-alpha",
        recipient: aliceRecipient,
        payload: {},
        timestamp: "...",
      },
      { text: "Alice event", blocks: [] },
    );

    await presenceManager.handleNotification(
      {
        type: "phase_start",
        feature: "feat-bob",
        projectId: "proj-alpha",
        recipient: bobRecipient,
        payload: {},
        timestamp: "...",
      },
      { text: "Bob event", blocks: [] },
    );

    expect(sendSlackMessage).not.toHaveBeenCalled();

    // Alice returns to active, Bob remains away
    presenceManager.setUserPresence("U-alice", "active");
    await presenceManager.flushUserQueues("U-alice");

    expect(sendSlackMessage).toHaveBeenCalledTimes(1);
    const aliceCall = vi.mocked(sendSlackMessage).mock.calls[0];
    expect(aliceCall[0].blocks[1].text.text).toContain("feat-alice");
    expect(aliceCall[0].blocks[1].text.text).not.toContain("feat-bob");

    // Bob is still queued
    expect(
      presenceManager.getScopedQueue("proj-alpha", "U-bob")?.events,
    ).toHaveLength(1);
    expect(
      presenceManager.getScopedQueue("proj-alpha", "U-alice"),
    ).toBeUndefined();
  });
});
