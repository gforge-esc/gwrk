/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { beforeEach, expect, it, vi } from "vitest";
import { createSlackNotificationAdapter } from "./index.js";
const {
  postMessage,
  postEphemeral,
  getPresence,
  listUsers,
  authTest,
  getSlackApp,
} = vi.hoisted(() => ({
  postMessage: vi.fn(),
  postEphemeral: vi.fn(),
  getPresence: vi.fn(),
  listUsers: vi.fn(),
  authTest: vi.fn(),
  getSlackApp: vi.fn(),
}));
vi.mock("../../server/slack.js", () => ({
  getSlackApp,
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
  getSlackApp.mockReturnValue({
    client: {
      chat: { postMessage, postEphemeral },
      users: { getPresence, list: listUsers },
      auth: { test: authTest },
    },
  });
  postMessage.mockResolvedValue({
    ok: true,
    channel: "C-alpha",
    ts: "1700000000.000200",
    message: { thread_ts: recipient.threadTs },
  });
  postEphemeral.mockResolvedValue({
    ok: true,
    message_ts: "1700000000.000300",
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
    name: "a conflicting thread hint",
    projectId: "alpha",
    threadTs: "1700000000.999999",
  },
  {
    name: "a non-Slack recipient surface",
    projectId: "alpha",
    recipient: { ...recipient, surface: "local_cli" as const },
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
  expect(postEphemeral).not.toHaveBeenCalled();
});
it("fails closed when workspace verification cannot run on the Slack client", async () => {
  getSlackApp.mockReturnValue({
    client: {
      chat: { postMessage, postEphemeral },
    },
  });
  const adapter = createSlackNotificationAdapter();
  const result = await adapter
    .notify({ projectId: "alpha", recipient, text: "Private work" })
    .catch(() => undefined);
  expect(Boolean(result?.delivered)).toBe(false);
  expect(postMessage).not.toHaveBeenCalled();
});
it("sends ephemeral notifications privately via chat.postEphemeral instead of posting publicly", async () => {
  const adapter = createSlackNotificationAdapter();
  const result = await adapter.notify({
    projectId: "alpha",
    recipient,
    ephemeralUserId: "U-actor",
    text: "Private warning",
  });
  expect(postMessage).not.toHaveBeenCalled();
  expect(postEphemeral).toHaveBeenCalledWith(
    expect.objectContaining({
      channel: "C-alpha",
      user: "U-actor",
      thread_ts: recipient.threadTs,
      text: "Private warning",
    }),
  );
  expect(result).toMatchObject({
    delivered: true,
    channelId: "C-alpha",
    messageTs: "1700000000.000300",
    threadTs: recipient.threadTs,
  });
});
it("checks the requested recipient presence without selecting a workspace user", async () => {
  const adapter = createSlackNotificationAdapter();
  expect(await adapter.getUserPresence?.("W1", "U-selected")).toBe("active");
  expect(getPresence).toHaveBeenCalledWith(
    expect.objectContaining({ user: "U-selected" }),
  );
  expect(listUsers).not.toHaveBeenCalled();
});
it("keeps opsOnly notifications unthreaded even when recipient carries a feature threadTs", async () => {
  const adapter = createSlackNotificationAdapter();
  const result = await adapter.notify({
    projectId: "alpha",
    opsOnly: true,
    channel: "C-ops",
    recipient: {
      projectId: "alpha",
      surface: "slack",
      workspaceId: "W1",
      channelId: "C-ops",
      threadTs: "1700000000.000100",
      opsOnly: true,
    },
    text: "Ops alert",
  });
  expect(result?.delivered).toBe(true);
  expect(postMessage).toHaveBeenCalledOnce();
  expect(postMessage.mock.calls[0][0].channel).toBe("C-ops");
  expect(postMessage.mock.calls[0][0].thread_ts).toBeUndefined();
});
it("omits thread_ts for opsOnly ephemeral notifications and verifies+posts on the same captured client", async () => {
  const firstPostEphemeral = vi.fn().mockResolvedValue({
    ok: true,
    message_ts: "1700000000.000400",
  });
  const secondPostEphemeral = vi.fn();
  getSlackApp
    .mockReturnValueOnce({
      client: {
        chat: { postMessage, postEphemeral: firstPostEphemeral },
        auth: { test: authTest },
      },
    })
    .mockReturnValueOnce({
      client: {
        chat: { postMessage, postEphemeral: secondPostEphemeral },
        auth: { test: authTest },
      },
    });
  const adapter = createSlackNotificationAdapter();
  const result = await adapter.notify({
    projectId: "alpha",
    opsOnly: true,
    channel: "C-ops",
    ephemeralUserId: "U-actor",
    recipient: {
      projectId: "alpha",
      surface: "slack",
      workspaceId: "W1",
      channelId: "C-ops",
      threadTs: "1700000000.000100",
      opsOnly: true,
    },
    text: "Private ops warning",
  });
  expect(result).toMatchObject({
    delivered: true,
    channelId: "C-ops",
    messageTs: "1700000000.000400",
    threadTs: undefined,
  });
  expect(authTest).toHaveBeenCalledOnce();
  expect(firstPostEphemeral).toHaveBeenCalledWith(
    expect.objectContaining({
      channel: "C-ops",
      user: "U-actor",
      thread_ts: undefined,
      text: "Private ops warning",
    }),
  );
  expect(secondPostEphemeral).not.toHaveBeenCalled();
});
