import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as slackClient from "../utils/slack-client.js";
import { ensureSlackChannel } from "./slack-channel.js";

vi.mock("../utils/slack-client.js", () => ({
  loadSlackConfig: vi.fn(),
}));

// Global fetch mock
const globalFetch = vi.fn();
global.fetch = globalFetch;

describe("ensureSlackChannel", () => {
  const mockTokens = {
    botToken: "xoxb-test",
    appToken: "xapp-test",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue(mockTokens);
    globalFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return existing channel ID if it exists", async () => {
    globalFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        channels: [
          { name: "code-red", id: "C123", is_member: true },
          { name: "other", id: "C456", is_member: true },
        ],
      }),
    });

    const channelId = await ensureSlackChannel("#code-red");
    expect(channelId).toBe("C123");
    expect(globalFetch).toHaveBeenCalledWith(
      expect.stringContaining("conversations.list"),
      expect.objectContaining({
        body: expect.stringContaining("public_channel"),
      }),
    );
  });

  it("should join existing channel if not a member", async () => {
    globalFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [{ name: "code-red", id: "C123", is_member: false }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

    const channelId = await ensureSlackChannel("code-red");
    expect(channelId).toBe("C123");
    expect(globalFetch).toHaveBeenCalledWith(
      expect.stringContaining("conversations.join"),
      expect.objectContaining({
        body: expect.stringContaining("C123"),
      }),
    );
  });

  it("should create a new channel if it doesn't exist", async () => {
    globalFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channel: { id: "C789" },
        }),
      });

    const channelId = await ensureSlackChannel("new-project");
    expect(channelId).toBe("C789");
    expect(globalFetch).toHaveBeenCalledWith(
      expect.stringContaining("conversations.create"),
      expect.objectContaining({
        body: expect.stringContaining("new-project"),
      }),
    );
  });

  it("should handle name_taken error by re-fetching", async () => {
    globalFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: false,
          error: "name_taken",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [{ name: "already-taken", id: "C_TAKEN" }],
        }),
      });

    const channelId = await ensureSlackChannel("already-taken");
    expect(channelId).toBe("C_TAKEN");
  });

  it("should throw error if slack is not configured", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue(null);
    await expect(ensureSlackChannel("any")).rejects.toThrow(
      "Slack not configured",
    );
  });
});
