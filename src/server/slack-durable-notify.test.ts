/* This Source Code Form is subject to the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { webApi } from "@slack/bolt";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sendSlackMessage } from "./slack-notify.js";

const { postMessage, authTest, fetchWebhook } = vi.hoisted(() => ({
  postMessage: vi.fn(),
  authTest: vi.fn(),
  fetchWebhook: vi.fn(),
}));
vi.mock("@slack/bolt", async (importOriginal) => {
  const bolt = await importOriginal<typeof import("@slack/bolt")>();
  const adapter: webApi.WebClientOptions["adapter"] = async (config) => {
    const isAuth = config.url?.endsWith("auth.test");
    const body = new URLSearchParams(config.data);
    return {
      config,
      status: 200,
      statusText: "OK",
      headers: {},
      request: { path: `/api/${config.url}` },
      data: isAuth
        ? await authTest(config.headers.get("Authorization"))
        : await postMessage({
            channel: body.get("channel"),
            thread_ts: body.get("thread_ts"),
            metadata: JSON.parse(body.get("metadata") ?? "null"),
          }),
    };
  };
  return {
    ...bolt,
    webApi: {
      ...bolt.webApi,
      WebClient: class extends bolt.webApi.WebClient {
        constructor(token?: string, options?: webApi.WebClientOptions) {
          super(token, { ...options, adapter });
        }
      },
    },
  };
});
vi.mock("./slack.js", () => ({ getSlackApp: () => null }));
vi.mock("./telegram-notify.js", () => ({ loadTelegramConfig: () => null }));

const metadata = {
  event_type: "gwrk_notification" as const,
  event_payload: { projectId: "alpha", clientMetadataKey: "notice-1" },
};
const message = {
  channel: "C1",
  thread_ts: "1700000000.000001",
  text: "Completed",
  blocks: [],
  metadata,
};
const options = { webhookFallback: false, workspaceId: "W1" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-fixture");
  vi.stubEnv("SLACK_APP_TOKEN", "xapp-fixture");
  vi.stubEnv("SLACK_WEBHOOK_URL", "https://example.invalid/slack");
  vi.stubGlobal("fetch", fetchWebhook);
  authTest.mockResolvedValue({ ok: true, team_id: "W1" });
  postMessage.mockResolvedValue({
    ok: true,
    channel: "C1",
    ts: "1700000000.000002",
    message: { thread_ts: message.thread_ts },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("verifies workspace and transmits durable metadata with the accepted thread", async () => {
  expect(await sendSlackMessage(message, options)).toMatchObject({
    delivered: true,
    channelId: "C1",
    messageTs: "1700000000.000002",
    threadTs: message.thread_ts,
  });
  expect(authTest).toHaveBeenCalledOnce();
  expect(authTest).toHaveBeenCalledWith("Bearer xoxb-fixture");
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      channel: "C1",
      thread_ts: message.thread_ts,
      metadata,
    }),
  );
});
it.each([
  { ok: true, team_id: "W2" },
  { ok: false, error: "not_authed" },
])("denies a durable send with unresolved workspace %j", async (auth) => {
  authTest.mockResolvedValue(auth);
  expect(await sendSlackMessage(message, options)).toBeUndefined();
  expect(postMessage).not.toHaveBeenCalled();
});
it("keeps an uncertain durable send off the webhook fallback", async () => {
  postMessage.mockRejectedValue(new Error("transport uncertain"));
  expect(await sendSlackMessage(message, options)).toBeUndefined();
  expect(fetchWebhook).not.toHaveBeenCalled();
});
it("leaves a lost send response for reconciliation without a second post", async () => {
  postMessage.mockRejectedValueOnce(
    new Error("response lost after Slack accepted the message"),
  );
  vi.useFakeTimers();
  const result = sendSlackMessage(message, {
    ...options,
    webhookFallback: true,
  });
  await vi.runAllTimersAsync();
  expect(await result).toBeUndefined();
  expect(postMessage).toHaveBeenCalledOnce();
  expect(postMessage).toHaveBeenCalledWith({
    channel: message.channel,
    thread_ts: message.thread_ts,
    metadata,
  });
  expect(fetchWebhook).not.toHaveBeenCalled();
});

it("keeps durable metadata and the verified token across bounded transport", async () => {
  fetchWebhook.mockImplementation(async (url: string, init: RequestInit) => {
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer xoxb-fixture",
    });
    if (url.endsWith("auth.test")) {
      vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-replaced-after-auth");
      return { json: async () => ({ ok: true, team_id: "W1" }) };
    }
    expect(JSON.parse(String(init.body))).toMatchObject({
      channel: message.channel,
      thread_ts: message.thread_ts,
      metadata,
    });
    return { json: async () => ({ ok: true, channel: "C1", ts: "receipt-1" }) };
  });
  expect(
    await sendSlackMessage(message, { ...options, transportTimeoutMs: 500 }),
  ).toMatchObject({
    delivered: true,
    messageTs: "receipt-1",
    threadTs: message.thread_ts,
  });
  expect(fetchWebhook).toHaveBeenCalledTimes(2);
  expect(postMessage).not.toHaveBeenCalled();
});

it(
  "aborts workspace verification before a durable post or fallback",
  { timeout: 1000 },
  async () => {
    fetchWebhook.mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://slack.com/api/auth.test");
      const signal = init.signal!;
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    });
    expect(
      await sendSlackMessage(message, {
        ...options,
        transportTimeoutMs: 10,
        webhookFallback: true,
      }),
    ).toBeUndefined();
    expect(fetchWebhook).toHaveBeenCalledOnce();
    expect(postMessage).not.toHaveBeenCalled();
  },
);
