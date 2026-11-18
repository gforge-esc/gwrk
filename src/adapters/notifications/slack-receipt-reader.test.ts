/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { expect, it, vi } from "vitest";
import { createSlackReceiptReader } from "./slack-receipt-reader.js";
const query = {
  projectId: "alpha",
  workspaceId: "W1",
  channelId: "C1",
  clientMetadataKey: "receipt-key",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const page = (messages: unknown[] = [], cursor = "") => ({
  ok: true,
  messages,
  has_more: Boolean(cursor),
  response_metadata: { next_cursor: cursor },
});
function setup() {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(response({ ok: true, team_id: "W1" }));
  return {
    fetchImpl,
    reconcile: createSlackReceiptReader({
      getToken: () => "synthetic-token",
      fetchImpl,
    }),
  };
}
it("verifies token workspace before reading the accepted channel and metadata", async () => {
  const { fetchImpl, reconcile } = setup();
  fetchImpl
    .mockResolvedValueOnce(response({ ok: true, team_id: "W1" }))
    .mockResolvedValueOnce(response(page()));
  expect(await reconcile(query)).toEqual({ status: "confirmed_absent" });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(String(fetchImpl.mock.calls[0][0])).toBe(
    "https://slack.com/api/auth.test",
  );
  expect(fetchImpl.mock.calls[0][1]).toMatchObject({
    method: "POST",
    headers: { Authorization: "Bearer synthetic-token" },
    redirect: "error",
  });
  const url = new URL(String(fetchImpl.mock.calls[1][0]));
  expect(url.pathname).toBe("/api/conversations.history");
  expect(url.searchParams.get("channel")).toBe("C1");
  expect(url.searchParams.get("include_all_metadata")).toBe("true");
  expect(url.searchParams.has("token")).toBe(false);
});
it("paginates the accepted thread and returns the saved receipt", async () => {
  const { fetchImpl, reconcile } = setup();
  const threadTs = "1700000000.000000";
  fetchImpl
    .mockResolvedValueOnce(response({ ok: true, team_id: "W1" }))
    .mockResolvedValueOnce(response(page([], "next")))
    .mockResolvedValueOnce(
      response(
        page([
          {
            ts: "1700000000.000001",
            thread_ts: threadTs,
            metadata: {
              event_type: "gwrk_notification",
              event_payload: {
                projectId: "alpha",
                clientMetadataKey: "receipt-key",
              },
            },
          },
        ]),
      ),
    );
  expect(await reconcile({ ...query, threadTs })).toMatchObject({
    status: "found",
    receipt: { channelId: "C1", threadTs, messageTs: "1700000000.000001" },
  });
  const url = new URL(String(fetchImpl.mock.calls[2][0]));
  expect(url.pathname).toBe("/api/conversations.replies");
  expect(url.searchParams.get("ts")).toBe(threadTs);
  expect(url.searchParams.get("cursor")).toBe("next");
});
it.each([
  { ok: true, team_id: "W2" },
  { ok: false, error: "invalid_auth" },
  { ok: true },
])("denies history lookup for unresolved authentication %j", async (auth) => {
  const { fetchImpl, reconcile } = setup();
  fetchImpl.mockResolvedValueOnce(response(auth));
  expect(await reconcile(query)).toMatchObject({ status: "indeterminate" });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it("keeps HTTP denial indeterminate after authentication", async () => {
  const { fetchImpl, reconcile } = setup();
  fetchImpl
    .mockResolvedValueOnce(response({ ok: true, team_id: "W1" }))
    .mockResolvedValueOnce(response({ ok: false }, 429));
  expect(await reconcile(query)).toMatchObject({ status: "indeterminate" });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it.each(["auth", "history"])(
  "bounds and aborts a stalled %s request",
  async (stage) => {
    const fetchImpl = vi.fn<typeof fetch>();
    let signal: AbortSignal | null | undefined;
    if (stage === "history")
      fetchImpl.mockResolvedValueOnce(response({ ok: true, team_id: "W1" }));
    fetchImpl.mockImplementation(async (_url, options) => {
      signal = options?.signal;
      return new Promise<Response>(() => {});
    });
    const reconcile = createSlackReceiptReader({
      getToken: () => "synthetic-token",
      fetchImpl,
      timeoutMs: 10,
    });
    expect(await reconcile(query)).toMatchObject({ status: "indeterminate" });
    expect(signal?.aborted).toBe(true);
  },
);
it("performs no request without a credential or complete accepted scope", async () => {
  const fetchImpl = vi.fn<typeof fetch>();
  const missing = createSlackReceiptReader({ getToken: () => null, fetchImpl });
  expect(await missing(query)).toMatchObject({ status: "indeterminate" });
  const invalid = createSlackReceiptReader({
    getToken: () => "synthetic-token",
    fetchImpl,
  });
  expect(await invalid({ ...query, workspaceId: undefined })).toMatchObject({
    status: "indeterminate",
  });
  expect(fetchImpl).not.toHaveBeenCalled();
});
