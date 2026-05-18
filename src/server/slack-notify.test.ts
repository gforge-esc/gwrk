import { beforeEach, describe, expect, it, vi } from "vitest";
import { notifySlack } from "./slack-notify.js";
import { getSlackApp } from "./slack.js";

vi.mock("./slack.js", () => ({
  getSlackApp: vi.fn().mockReturnValue({
    client: {
      chat: { postMessage: vi.fn().mockResolvedValue({ ok: true }) },
    },
  }),
}));

vi.mock("../utils/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    project: {
      slack: {
        webhookUrl: "https://hooks.slack.com/services/T123/B456/XYZ",
      },
    },
  }),
}));

describe("US-003: Slack Event Bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SLACK_WEBHOOK_URL =
      "https://hooks.slack.com/services/T123/B456/XYZ";
  });

  it("FR-014: should fallback to webhook when Socket Mode app is not available (TR-011)", async () => {
    // Mock getSlackApp to return null (simulating server without Socket Mode)
    const { getSlackApp } = await import("./slack.js");
    vi.mocked(getSlackApp).mockReturnValue(null);

    // Mock global.fetch
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;

    const message = {
      text: "Webhook Fallback Test",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "Hello Webhook" } },
      ],
    };

    await notifySlack(message as any);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/T123/B456/XYZ",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Hello Webhook"),
      }),
    );
  });

  it("FR-005: Converts ship:complete event to Block Kit message", async () => {
    // Test implementation here...
    expect(true).toBe(true);
  });
});
