import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSlackChannel } from "./slack-channel.js";
import * as slackServer from "./slack.js";

vi.mock("./slack.js", () => ({
  getSlackApp: vi.fn(),
}));

describe("ensureSlackChannel", () => {
  const mockApp = {
    client: {
      conversations: {
        list: vi.fn(),
        create: vi.fn(),
        join: vi.fn(),
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(slackServer.getSlackApp).mockReturnValue(mockApp as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return existing channel ID if it exists", async () => {
    mockApp.client.conversations.list.mockResolvedValue({
      channels: [
        { name: "code-red", id: "C123", is_member: true },
        { name: "other", id: "C456", is_member: true },
      ],
    });

    const channelId = await ensureSlackChannel("#code-red");
    expect(channelId).toBe("C123");
    expect(mockApp.client.conversations.create).not.toHaveBeenCalled();
  });

  it("should join existing channel if not a member", async () => {
    mockApp.client.conversations.list.mockResolvedValue({
      channels: [{ name: "code-red", id: "C123", is_member: false }],
    });
    mockApp.client.conversations.join.mockResolvedValue({});

    const channelId = await ensureSlackChannel("code-red");
    expect(channelId).toBe("C123");
    expect(mockApp.client.conversations.join).toHaveBeenCalledWith({
      channel: "C123",
    });
  });

  it("should create a new channel if it doesn't exist", async () => {
    mockApp.client.conversations.list.mockResolvedValue({ channels: [] });
    mockApp.client.conversations.create.mockResolvedValue({
      channel: { id: "C789" },
    });

    const channelId = await ensureSlackChannel("new-project");
    expect(channelId).toBe("C789");
    expect(mockApp.client.conversations.create).toHaveBeenCalledWith({
      name: "new-project",
    });
  });

  it("should handle name_taken error by re-fetching", async () => {
    mockApp.client.conversations.list.mockResolvedValue({ channels: [] });
    mockApp.client.conversations.create.mockRejectedValue({
      data: { error: "name_taken" },
    });

    // Second call to list after name_taken
    mockApp.client.conversations.list
      .mockResolvedValueOnce({ channels: [] })
      .mockResolvedValueOnce({
        channels: [{ name: "already-taken", id: "C_TAKEN" }],
      });

    const channelId = await ensureSlackChannel("already-taken");
    expect(channelId).toBe("C_TAKEN");
  });

  it("should throw error if slack is not configured", async () => {
    vi.mocked(slackServer.getSlackApp).mockReturnValue(null);
    await expect(ensureSlackChannel("any")).rejects.toThrow(
      "Slack not configured",
    );
  });
});
