/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { beforeEach, expect, it, vi } from "vitest";
import { createSlackNotificationAdapter } from "./index.js";
const { authTest, getPresence, listUsers } = vi.hoisted(() => ({
  authTest: vi.fn(),
  getPresence: vi.fn(),
  listUsers: vi.fn(),
}));
vi.mock("../../server/slack.js", () => ({
  getSlackApp: () => ({
    client: {
      auth: { test: authTest },
      users: { getPresence, list: listUsers },
    },
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  authTest.mockResolvedValue({ ok: true, team_id: "W1" });
  getPresence.mockResolvedValue({ ok: true, presence: "active" });
});
const query = (workspace = "W1", user = "U-selected") =>
  Promise.resolve(
    createSlackNotificationAdapter().getUserPresence?.(workspace, user),
  );
it.each(["active", "away"] as const)(
  "returns requested recipient presence %s without selecting a workspace user",
  async (presence) => {
    getPresence.mockResolvedValue({ ok: true, presence });
    expect(await query()).toBe(presence);
    expect(getPresence).toHaveBeenCalledExactlyOnceWith({ user: "U-selected" });
    expect(authTest).toHaveBeenCalledOnce();
    expect(listUsers).not.toHaveBeenCalled();
  },
);
it.each([
  "wrong workspace",
  "failed auth",
  "presence API failure",
  "unknown response",
])("reports %s without inventing presence", async (kind) => {
  if (kind === "wrong workspace")
    authTest.mockResolvedValue({ ok: true, team_id: "W-other" });
  if (kind === "failed auth") authTest.mockResolvedValue({ ok: false });
  if (kind === "presence API failure")
    getPresence.mockRejectedValue(new Error("fixture unavailable"));
  if (kind === "unknown response")
    getPresence.mockResolvedValue({ ok: true, presence: "unknown" });
  await expect(query()).rejects.toThrow(/presence|workspace/i);
  if (kind === "wrong workspace" || kind === "failed auth")
    expect(getPresence).not.toHaveBeenCalled();
  expect(listUsers).not.toHaveBeenCalled();
});
it.each([
  ["", "U-selected"],
  ["W1", " "],
])(
  "rejects blank recipient identity %j before API access",
  async (workspace, user) => {
    await expect(query(workspace, user)).rejects.toThrow(/presence|workspace/i);
    expect(authTest).not.toHaveBeenCalled();
    expect(getPresence).not.toHaveBeenCalled();
  },
);
