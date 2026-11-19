/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { createSlackNotificationAdapter } from "./index.js";
const { notifySlack, sendSlackMessage } = vi.hoisted(() => ({
  notifySlack: vi.fn(),
  sendSlackMessage: vi.fn(),
}));
vi.mock("../../server/slack-notify.js", () => ({
  notifySlack,
  sendSlackMessage,
}));
beforeEach(() => vi.clearAllMocks());
describe("durable notification adapter composition", () => {
  it("sends a durable scoped notice with metadata and returns the actual receipt", async () => {
    const receipt = {
      delivered: true,
      channelId: "C1",
      messageTs: "1700000000.000001",
      threadTs: "1700000000.000000",
    };
    vi.mocked(sendSlackMessage).mockResolvedValue(receipt);
    const adapter = createSlackNotificationAdapter();
    const result = await adapter.notify({
      projectId: "alpha",
      featureId: "001-fixture",
      text: "Completed",
      recipient: {
        projectId: "alpha",
        surface: "slack",
        workspaceId: "W1",
        channelId: "C1",
        threadTs: "1700000000.000000",
      },
      clientMetadataKey: "receipt-key",
    });
    expect(result).toEqual(receipt);
    expect(sendSlackMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C1",
        thread_ts: "1700000000.000000",
        metadata: {
          event_type: "gwrk_notification",
          event_payload: {
            projectId: "alpha",
            clientMetadataKey: "receipt-key",
          },
        },
      }),
      expect.objectContaining({ webhookFallback: false }),
    );
    expect(notifySlack).not.toHaveBeenCalled();
  });
  it("exposes delivery reconciliation on the composed notification port", () => {
    expect(createSlackNotificationAdapter().reconcileDelivery).toBeTypeOf(
      "function",
    );
  });
  it("requests public channel history access for the reconciliation bot", () => {
    const manifest = parse(
      readFileSync(
        new URL("../../slack-manifest.yml", import.meta.url),
        "utf8",
      ),
    );
    expect(manifest.oauth_config.scopes.bot).toContain("channels:history");
  });
});

it.each([
  { projectId: "beta" },
  { projectId: "alpha", channel: "C-other" },
  { projectId: "alpha", threadTs: "1700000000.999999" },
])(
  "rejects a conflicting durable delivery scope before sending %j",
  async (change) => {
    const adapter = createSlackNotificationAdapter();
    await adapter
      .notify({
        ...change,
        featureId: "001-fixture",
        text: "Private result",
        clientMetadataKey: "notice-1",
        recipient: {
          projectId: "alpha",
          surface: "slack",
          workspaceId: "W1",
          channelId: "C1",
          threadTs: "1700000000.000000",
        },
      })
      .catch(() => undefined);
    expect(sendSlackMessage).not.toHaveBeenCalled();
  },
);
