/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";
import { createSlackDeliveryReconciler } from "./outbox-reconcile.js";
const query = {
  projectId: "alpha",
  workspaceId: "W1",
  channelId: "C1",
  clientMetadataKey: "receipt-key",
};
const message = (overrides = {}) => ({
  ts: "1700000000.000001",
  metadata: {
    event_type: "gwrk_notification",
    event_payload: { projectId: "alpha", clientMetadataKey: "receipt-key" },
  },
  ...overrides,
});
const page = (messages: unknown[] = [], cursor = "") => ({
  ok: true,
  messages,
  has_more: Boolean(cursor),
  response_metadata: { next_cursor: cursor },
});

describe("durable Slack delivery reconciliation", () => {
  it("finds a project-scoped receipt after cursor pagination", async () => {
    const readPage = vi
      .fn()
      .mockResolvedValueOnce(page([], "next"))
      .mockResolvedValueOnce(page([message()]));
    const reconcile = createSlackDeliveryReconciler({
      workspaceId: "W1",
      readPage,
    });
    expect(await reconcile(query)).toEqual({
      status: "found",
      receipt: {
        delivered: true,
        channelId: "C1",
        messageTs: "1700000000.000001",
      },
    });
    expect(readPage.mock.calls[0][0]).toMatchObject({
      method: "history",
      channel: "C1",
      include_all_metadata: true,
    });
    expect(readPage.mock.calls[1][0].cursor).toBe("next");
  });
  it("uses only the accepted thread for threaded delivery", async () => {
    const readPage = vi
      .fn()
      .mockResolvedValue(page([message({ thread_ts: "1700000000.000000" })]));
    const result = await createSlackDeliveryReconciler({
      workspaceId: "W1",
      readPage,
    })({ ...query, threadTs: "1700000000.000000" });
    expect(result).toMatchObject({
      status: "found",
      receipt: { threadTs: "1700000000.000000" },
    });
    expect(readPage).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "replies",
        channel: "C1",
        ts: "1700000000.000000",
        include_all_metadata: true,
      }),
    );
  });
  it("confirms absence only after a complete lookup", async () => {
    const readPage = vi
      .fn()
      .mockResolvedValueOnce(page([], "next"))
      .mockResolvedValueOnce(page());
    expect(
      await createSlackDeliveryReconciler({ workspaceId: "W1", readPage })(
        query,
      ),
    ).toEqual({ status: "confirmed_absent" });
  });
  it.each([undefined, "W2"])(
    "rejects an unavailable or foreign workspace %s before lookup",
    async (workspaceId) => {
      const readPage = vi.fn();
      expect(
        await createSlackDeliveryReconciler({ workspaceId: "W1", readPage })({
          ...query,
          workspaceId,
        }),
      ).toMatchObject({ status: "indeterminate" });
      expect(readPage).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ok: false, error: "not_authed" },
    { ok: true, messages: [], has_more: true },
    { ok: true, messages: "malformed" },
    {
      ok: true,
      messages: [],
      has_more: "unknown",
      response_metadata: { next_cursor: "next" },
    },
    { ok: true, messages: [], response_metadata: { next_cursor: 123 } },
  ])(
    "preserves uncertainty after partial or unauthorized response %j",
    async (response) => {
      const readPage = vi.fn().mockResolvedValue(response);
      expect(
        await createSlackDeliveryReconciler({ workspaceId: "W1", readPage })(
          query,
        ),
      ).toMatchObject({ status: "indeterminate" });
    },
  );
  it("does not clear uncertainty when a later page fails after a match", async () => {
    const readPage = vi
      .fn()
      .mockResolvedValueOnce(page([message()], "next"))
      .mockRejectedValueOnce(new Error("denied"));
    expect(
      await createSlackDeliveryReconciler({ workspaceId: "W1", readPage })(
        query,
      ),
    ).toMatchObject({ status: "indeterminate" });
  });
  it.each([
    message({
      metadata: {
        event_type: "gwrk_notification",
        event_payload: { projectId: "beta", clientMetadataKey: "receipt-key" },
      },
    }),
    message({ thread_ts: "1700000000.000099" }),
    message({ ts: "" }),
    message({ channel: "C2" }),
  ])(
    "rejects a matching key with incompatible receipt identity %j",
    async (candidate) => {
      const readPage = vi.fn().mockResolvedValue(page([candidate]));
      expect(
        await createSlackDeliveryReconciler({ workspaceId: "W1", readPage })(
          query,
        ),
      ).toMatchObject({ status: "indeterminate" });
    },
  );
  it("rejects duplicate receipt identities and repeated cursors", async () => {
    const duplicate = vi
      .fn()
      .mockResolvedValue(
        page([message(), message({ ts: "1700000000.000002" })]),
      );
    expect(
      await createSlackDeliveryReconciler({
        workspaceId: "W1",
        readPage: duplicate,
      })(query),
    ).toMatchObject({ status: "indeterminate" });
    const repeated = vi.fn().mockResolvedValue(page([], "same"));
    expect(
      await createSlackDeliveryReconciler({
        workspaceId: "W1",
        readPage: repeated,
      })(query),
    ).toMatchObject({ status: "indeterminate" });
    expect(repeated).toHaveBeenCalledTimes(2);
  });
  it("bounds lookup duration and aborts outstanding reads", async () => {
    let signal: AbortSignal | undefined;
    const readPage = vi.fn((input) => {
      signal = input.signal;
      return new Promise<unknown>(() => {});
    });
    expect(
      await createSlackDeliveryReconciler({
        workspaceId: "W1",
        readPage,
        timeoutMs: 10,
      })(query),
    ).toMatchObject({ status: "indeterminate" });
    expect(signal?.aborted).toBe(true);
  });
});
