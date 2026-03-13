import { loadSlackConfig } from "../utils/slack-client.js";

interface SlackChannel {
  id: string;
  name: string;
  is_member?: boolean;
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
    return existing.id;
  }

  // 2. Create the channel
  const createRes = await slackFetch("conversations.create", {
    name: cleanName,
  });

  if (createRes.ok) {
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
      if (found?.id) return found.id;
    }
  }

  throw new Error(`Slack API error (create): ${createRes.error}`);
}
