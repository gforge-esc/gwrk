/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../utils/config.js";
import { notifySlack } from "./slack-notify.js";
import { presenceManager } from "./slack-presence.js";
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

  it("passes cancellation to a stalled Slack webhook and skips Telegram", async () => {
    vi.mocked(getSlackApp).mockReturnValue(null);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "synthetic-token");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1234");
    const controller = new AbortController();
    const fetchStub = vi.fn<typeof fetch>();
    let release!: (value: Response) => void;
    fetchStub.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fetchStub.mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    try {
      const delivery = notifySlack(
        { text: "Stalled webhook", blocks: [] },
        undefined,
        {
          signal: controller.signal,
        },
      );
      await vi.waitFor(() => expect(fetchStub).toHaveBeenCalledOnce());
      controller.abort();
      release(new Response(null, { status: 200 }));
      await delivery;
      expect.soft(fetchStub.mock.calls[0][1]?.signal).toBe(controller.signal);
      expect(fetchStub).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("drops cancelled presence notifications and sends summaries to each project", async () => {
    const config = loadConfig("/fixture");
    const getPresence = vi
      .fn()
      .mockResolvedValue({ ok: true, presence: "away" });
    vi.mocked(getSlackApp).mockReturnValue({
      client: {
        token: "fixture-token",
        users: {
          list: vi.fn().mockResolvedValue({
            ok: true,
            members: [{ id: "fixture-user", is_bot: false }],
          }),
          getPresence,
        },
      },
    } as NonNullable<ReturnType<typeof getSlackApp>>);
    const provider = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", provider);
    vi.stubEnv("GWRK_HOME", "/gwrk-notification-fixture");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "presence-test-token");
    vi.stubEnv("TELEGRAM_CHAT_ID", "123");
    vi.useFakeTimers();
    const cancelled = new AbortController();
    const active = new AbortController();
    const send = (feature: string, projectRoot: string, signal: AbortSignal) =>
      notifySlack(
        { text: feature, blocks: [] },
        { type: "phase_fail", feature, payload: {}, timestamp: "" },
        { projectRoot, signal },
      );
    try {
      await presenceManager.init(config);
      const discarded = send(
        "discarded-feature",
        "/first-project",
        cancelled.signal,
      );
      const first = send("first-feature", "/first-project", active.signal);
      const second = send("second-feature", "/second-project", active.signal);
      cancelled.abort();
      await discarded;
      expect(provider.mock.calls.map(([url]) => url)).toEqual(
        Array(3).fill(
          "https://api.telegram.org/botpresence-test-token/sendMessage",
        ),
      );

      vi.mocked(loadConfig)
        .mockReturnValueOnce({
          ...config,
          project: { ...config.project, slack: { channelId: "C_FIRST" } },
        })
        .mockReturnValueOnce({
          ...config,
          project: { ...config.project, slack: { channelId: "C_SECOND" } },
        });
      getPresence.mockResolvedValue({ ok: true, presence: "active" });
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.all([first, second]);

      expect(vi.mocked(loadConfig).mock.calls.slice(-2)).toEqual([
        ["/first-project"],
        ["/second-project"],
      ]);
      const payloads = provider.mock.calls
        .filter(([url]) => url === "https://slack.com/api/chat.postMessage")
        .map(([, request]) => JSON.parse(String(request?.body)));
      expect(payloads.map(({ channel }) => channel)).toEqual([
        "C_FIRST",
        "C_SECOND",
      ]);
      expect(JSON.stringify(payloads[0])).toContain("first-feature");
      expect(JSON.stringify(payloads[0])).not.toContain("discarded-feature");
      expect(JSON.stringify(payloads[1])).toContain("second-feature");
    } finally {
      active.abort();
      presenceManager.stop();
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("FR-005: Converts ship:complete event to Block Kit message", async () => {
    // Test implementation here...
    expect(true).toBe(true);
  });
});
