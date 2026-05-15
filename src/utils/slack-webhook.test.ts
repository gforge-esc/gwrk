/**
 * Module does not exist yet (RED)
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { sendSlackWebhook } from "./slack-webhook.js";

vi.mock("node:https", () => ({
  request: vi.fn().mockReturnValue({
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  }),
}));

describe("slack-webhook (Phase 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should send a Block Kit message via incoming webhook (FR-014)", async () => {
    const webhookUrl = "https://hooks.slack.com/services/T123/B456/XYZ";
    const payload = { blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }] };
    
    await sendSlackWebhook(webhookUrl, payload);
    
    const { request } = await import("node:https");
    expect(request).toHaveBeenCalledWith(
      webhookUrl,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-type": "application/json" },
      }),
      expect.any(Function)
    );
  });
});
