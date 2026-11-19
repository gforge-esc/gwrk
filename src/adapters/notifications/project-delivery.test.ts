/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { beforeEach, expect, it, vi } from "vitest";
import { createSlackNotificationAdapter } from "./index.js";
const { postMessage, getPresence, listUsers, authTest } = vi.hoisted(() => ({
  postMessage: vi.fn(),
  getPresence: vi.fn(),
  listUsers: vi.fn(),
  authTest: vi.fn(),
}));
vi.mock("../../server/slack.js", () => ({
  getSlackApp: () => ({
    client: {
      chat: { postMessage },
      users: { getPresence, list: listUsers },
      auth: { test: authTest },
    },
  }),
}));
vi.mock("../../server/telegram-notify.js", () => ({
  loadTelegramConfig: () => null,
}));
vi.mock("../../utils/config.js", () => ({
  loadConfig: () => ({
    project: {
      slack: {
        channelId: "C-other",
        webhookUrl: "https://example.invalid/other-project",
      },
    },
  }),
}));
const recipient = {
  projectId: "alpha",
  surface: "slack" as const,
  workspaceId: "W1",
  channelId: "C-alpha",
  threadTs: "1700000000.000100",
};
beforeEach(() => {
  vi.clearAllMocks();
  postMessage.mockResolvedValue({
    ok: true,
    channel: "C-alpha",
    ts: "1700000000.000200",
    message: { thread_ts: recipient.threadTs },
  });
  getPresence.mockResolvedValue({ ok: true, presence: "active" });
  authTest.mockResolvedValue({ ok: true, team_id: "W1" });
});
it("uses the accepted recipient thread and returns the actual delivery receipt", async () => {
  const adapter = createSlackNotificationAdapter();
  const result = await adapter.notify({
    projectId: "alpha",
    recipient,
    text: "Completed",
  });
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      channel: "C-alpha",
      thread_ts: recipient.threadTs,
    }),
  );
  expect(result).toMatchObject({
    delivered: true,
    channelId: "C-alpha",
    messageTs: "1700000000.000200",
    threadTs: recipient.threadTs,
  });
});
it.each([
  { name: "another project", projectId: "beta" },
  {
    name: "a conflicting channel hint",
    projectId: "alpha",
    channel: "C-other",
  },
  {
    name: "another workspace",
    projectId: "alpha",
    recipient: { ...recipient, workspaceId: "W2" },
  },
])("rejects $name before sending", async (change) => {
  const adapter = createSlackNotificationAdapter();
  const result = await adapter
    .notify({ recipient, text: "Private work", ...change })
    .catch(() => undefined);
  expect(Boolean(result?.delivered)).toBe(false);
  expect(postMessage).not.toHaveBeenCalled();
});
it("checks the requested recipient presence without selecting a workspace user", async () => {
  const adapter = createSlackNotificationAdapter();
  expect(await adapter.getUserPresence?.("W1", "U-selected")).toBe("active");
  expect(getPresence).toHaveBeenCalledWith(
    expect.objectContaining({ user: "U-selected" }),
  );
  expect(listUsers).not.toHaveBeenCalled();
});
