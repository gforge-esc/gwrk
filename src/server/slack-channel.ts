/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { loadSlackConfig } from "../utils/slack-client.js";

interface SlackChannel {
  id: string;
  name: string;
  is_member?: boolean;
}

interface SlackUser {
  id: string;
  is_bot?: boolean;
  deleted?: boolean;
  name?: string;
}

/**
 * Internal helper to call Slack API via raw fetch.
 * Bolt's app.client sometimes misroutes tokens in Socket Mode,
 * causing spurious 'missing_scope' errors on valid scopes.
 */
async function slackFetch(method: string, body: Record<string, unknown> = {}) {
  const tokens = loadSlackConfig();
  if (!tokens) {
    throw new Error("Slack not configured. Run gwrk setup slack first.");
  }

  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${tokens.botToken}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

/**
 * Auto-invite the workspace owner (first non-bot human) into a channel.
 * TC-004: single-user workspace — one PE, one workspace.
 * Silently skips if already in channel or user not found.
 */
async function inviteOwnerToChannel(channelId: string): Promise<void> {
  try {
    const usersRes = await slackFetch("users.list", {});
    if (!usersRes.ok) return;

    const users = (usersRes.members as SlackUser[]) || [];
    const owner = users.find(
      (u) => !u.is_bot && !u.deleted && u.name !== "slackbot",
    );
    if (!owner) return;

    const inviteRes = await slackFetch("conversations.invite", {
      channel: channelId,
      users: owner.id,
    });

    // already_in_channel is fine — idempotent
    if (!inviteRes.ok && inviteRes.error !== "already_in_channel") {
      console.error(
        `Warning: could not invite user to channel: ${inviteRes.error}`,
      );
    }
  } catch {
    // Non-fatal — channel exists, user can join manually
  }
}

export async function ensureSlackChannel(channelName: string): Promise<string> {
  const cleanName = channelName.startsWith("#")
    ? channelName.slice(1)
    : channelName;

  // 1. Try to find the channel if it already exists
  // We only list public_channels by default to avoid needing 'groups:read' scope
  const listRes = await slackFetch("conversations.list", {
    types: "public_channel",
    exclude_archived: true,
    limit: 1000,
  });

  if (!listRes.ok) {
    throw new Error(`Slack API error (list): ${listRes.error}`);
  }

  const channels = (listRes.channels as SlackChannel[]) || [];
  const existing = channels.find((c: SlackChannel) => c.name === cleanName);

  if (existing?.id) {
    if (!existing.is_member) {
      const joinRes = await slackFetch("conversations.join", {
        channel: existing.id,
      });
      if (!joinRes.ok) {
        throw new Error(`Slack API error (join): ${joinRes.error}`);
      }
    }
    await inviteOwnerToChannel(existing.id);
    return existing.id;
  }

  // 2. Create the channel
  const createRes = await slackFetch("conversations.create", {
    name: cleanName,
  });

  if (createRes.ok) {
    await inviteOwnerToChannel(createRes.channel.id);
    return createRes.channel.id;
  }

  if (createRes.error === "name_taken") {
    // Race condition: another process created it. Re-list.
    const retryRes = await slackFetch("conversations.list", {
      types: "public_channel",
    });
    if (retryRes.ok) {
      const found = (retryRes.channels as SlackChannel[]).find(
        (c) => c.name === cleanName,
      );
      if (found?.id) {
        await inviteOwnerToChannel(found.id);
        return found.id;
      }
    }
  }

  throw new Error(`Slack API error (create): ${createRes.error}`);
}
