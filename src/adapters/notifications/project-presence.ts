/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
export async function readSlackUserPresence(
  workspaceId: string,
  userId: string,
): Promise<"active" | "away"> {
  if (!workspaceId.trim() || !userId.trim())
    throw new Error("Presence requires a workspace and requested user.");
  const { getSlackApp } = await import("../../server/slack.js");
  const client = getSlackApp()?.client;
  if (!client)
    throw new Error("Slack workspace is unavailable for presence lookup.");
  const account = await client.auth.test();
  if (!account.ok || account.team_id !== workspaceId)
    throw new Error(
      "Slack workspace does not match the requested presence lookup.",
    );
  const result = await client.users.getPresence({ user: userId }).catch(() => {
    throw new Error("Slack presence lookup is unavailable.");
  });
  if (result.ok && (result.presence === "active" || result.presence === "away"))
    return result.presence;
  throw new Error("Slack presence response is unavailable.");
}
