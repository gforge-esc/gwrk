import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { presenceManager } from "./slack-presence.js";
import { getSlackApp } from "./slack.js";
import { MessageBuilder } from "./slack-messages.js";

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
}));

describe("PresenceManager", () => {
  let mockApp: any;

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
          getPresence: vi.fn().mockResolvedValue({ ok: true, presence: "active" }),
        },
        chat: {
          postMessage: vi.fn().mockResolvedValue({ ok: true }),
        },
      },
    };

    (getSlackApp as any).mockReturnValue(mockApp);
  });

  afterEach(() => {
    presenceManager.stop();
    vi.useRealTimers();
  });

  it("should initialize and poll presence", async () => {
    await presenceManager.init("/root");
    expect(mockApp.client.users.list).toHaveBeenCalled();
    expect(mockApp.client.users.getPresence).toHaveBeenCalledWith({ user: "U123" });
  });

  it("should deliver notifications immediately when active", async () => {
    await presenceManager.init("/root");
    mockApp.client.users.getPresence.mockResolvedValue({ ok: true, presence: "active" });
    await vi.runOnlyPendingTimersAsync();

    const event = { type: "phase_start", feature: "feat-1", payload: {}, timestamp: "..." } as any;
    const message = MessageBuilder.phaseStart({ featureId: "feat-1", phaseId: "phase-01", status: "running" } as any);

    const { notifySlack } = await import("./slack-notify.js");
    await presenceManager.handleNotification(event, message);

    expect(notifySlack).toHaveBeenCalledWith(message);
  });

  it("should queue notifications when away and flush when returning to active", async () => {
    await presenceManager.init("/root");
    
    // Set to away
    mockApp.client.users.getPresence.mockResolvedValue({ ok: true, presence: "away" });
    await vi.runOnlyPendingTimersAsync();

    const event = { type: "phase_start", feature: "feat-1", payload: {}, timestamp: "..." } as any;
    const message = MessageBuilder.phaseStart({ featureId: "feat-1", phaseId: "phase-01", status: "running" } as any);

    const { notifySlack } = await import("./slack-notify.js");
    await presenceManager.handleNotification(event, message);

    expect(notifySlack).not.toHaveBeenCalled();

    // Set to active
    mockApp.client.users.getPresence.mockResolvedValue({ ok: true, presence: "active" });
    await vi.runOnlyPendingTimersAsync();

    // Should have called notifySlack with a batched summary
    expect(notifySlack).toHaveBeenCalled();
    const calledMessage = (notifySlack as any).mock.calls[0][0];
    expect(calledMessage.text).toContain("Batched Notification Summary");
  });
});
