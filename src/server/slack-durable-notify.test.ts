/* This Source Code Form is subject to the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { beforeEach, expect, it, vi } from "vitest";
import { sendSlackMessage } from "./slack-notify.js";
const { postMessage, authTest } = vi.hoisted(() => ({
  postMessage: vi.fn(),
  authTest: vi.fn(),
}));
vi.mock("./slack.js", () => ({
  getSlackApp: () => ({
    client: { chat: { postMessage }, auth: { test: authTest } },
  }),
}));
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
  vi.clearAllMocks();
  authTest.mockResolvedValue({ ok: true, team_id: "W1" });
  postMessage.mockResolvedValue({
    ok: true,
    channel: "C1",
    ts: "1700000000.000002",
    message: { thread_ts: message.thread_ts },
  });
});
it("verifies workspace and transmits durable metadata with the accepted thread", async () => {
  expect(await sendSlackMessage(message, options)).toMatchObject({
    delivered: true,
    channelId: "C1",
    messageTs: "1700000000.000002",
    threadTs: message.thread_ts,
  });
  expect(authTest).toHaveBeenCalledOnce();
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
  const fallback = vi.fn();
  vi.stubGlobal("fetch", fallback);
  try {
    postMessage.mockRejectedValue(new Error("transport uncertain"));
    expect(await sendSlackMessage(message, options)).toBeUndefined();
    expect(fallback).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
