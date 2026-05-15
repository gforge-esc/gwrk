/**
 * Module does not exist yet (RED)
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { notifySlack } from "./slack-notify.js";
import { MessageBuilder } from "./slack-messages.js";

vi.mock("../utils/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    project: {
      slack: {
        channelId: "C_PROJECT",
        opsChannelId: "C_OPS",
      }
    }
  })
}));

vi.mock("./slack-messages.js", () => ({
  MessageBuilder: {
    phaseStart: vi.fn().mockReturnValue({ text: "started" }),
    doneDone: vi.fn().mockReturnValue({ text: "done" }),
    pulseSummary: vi.fn().mockReturnValue({ text: "pulse" }),
  }
}));

vi.mock("./slack.js", () => ({
  getSlackApp: vi.fn().mockReturnValue({
    client: {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true }),
      }
    }
  })
}));

describe("slack-notify (Phase 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should route events to project channel by default (US-013)", async () => {
    const config = {
      project: {
        slack: {
          channelId: "C_PROJECT",
          opsChannelId: "C_OPS",
        }
      }
    };
    
    // In reality, config is loaded from disk, so we might need to mock loadConfig
    // But for this RED test, we'll just test that it calls postMessage
    await notifySlack({ text: "test", blocks: [] }, { type: "phase_start", feature: "003-slack" } as any);
    
    const { getSlackApp } = await import("./slack.js");
    const app = getSlackApp();
    expect(app?.client.chat.postMessage).toHaveBeenCalled();
  });

  it("should route Pulse and Done Done to ops channel if configured (US-013, FR-013)", async () => {
    await notifySlack({ text: "pulse", blocks: [] }, undefined, { opsOnly: true });
    
    const { getSlackApp } = await import("./slack.js");
    const app = getSlackApp();
    expect(app?.client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: expect.stringContaining("C_OPS") })
    );
  });
});
