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
  it("maintains manifest parity with registered Socket Mode events, DM tab, and slash subcommands", () => {
    const manifest = parse(
      readFileSync(
        new URL("../../slack-manifest.yml", import.meta.url),
        "utf8",
      ),
    );
    expect(manifest.features.app_home).toMatchObject({
      home_tab_enabled: true,
      messages_tab_enabled: true,
      messages_tab_read_only_enabled: false,
    });
    expect(manifest.oauth_config.scopes.bot).toEqual(
      expect.arrayContaining([
        "app_mentions:read",
        "channels:history",
        "channels:join",
        "channels:manage",
        "channels:read",
        "chat:write",
        "commands",
        "im:history",
        "reactions:read",
        "users:read",
      ]),
    );
    expect(manifest.settings.event_subscriptions.bot_events).toEqual(
      expect.arrayContaining([
        "app_home_opened",
        "app_mention",
        "message.im",
        "reaction_added",
      ]),
    );
    const usageHint = manifest.features.slash_commands[0]?.usage_hint ?? "";
    for (const token of [
      "status",
      "dispatch",
      "approve",
      "reject",
      "pause",
      "pulse",
      "effort",
      "logs",
      "ship",
      "define",
      "research",
      "adr",
      "--project",
    ]) {
      expect(usageHint).toContain(token);
    }
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
