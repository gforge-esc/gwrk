import { loadSlackConfig } from "../utils/slack-client.js";

interface SlackChannel {
  id: string;
  name: string;
  is_member?: boolean;
}

async function slackApi(
  method: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!data.ok) {
    const error = (data.error as string) || "unknown_error";
    throw Object.assign(new Error(`Slack API ${method}: ${error}`), {
      data,
    });
  }
  return data;
}

export async function ensureSlackChannel(
  channelName: string,
): Promise<string> {
  const config = loadSlackConfig();
  if (!config) {
    throw new Error("Slack not configured. Run gwrk setup slack first");
  }

  const token = config.botToken;
  const cleanName = channelName.startsWith("#")
    ? channelName.slice(1)
    : channelName;

  // 1. Try to find the channel if it already exists
  const listRes = await slackApi("conversations.list", token, {
    types: "public_channel,private_channel",
    exclude_archived: true,
    limit: 200,
  });
  const channels = (listRes.channels as SlackChannel[]) || [];
  const existing = channels.find((c) => c.name === cleanName);

  if (existing?.id) {
    if (!existing.is_member) {
      await slackApi("conversations.join", token, { channel: existing.id });
    }
    return existing.id;
  }

  // 2. Create the channel
  try {
    const createRes = await slackApi("conversations.create", token, {
      name: cleanName,
    });
    const channel = createRes.channel as SlackChannel | undefined;
    if (channel?.id) {
      return channel.id;
    }
    throw new Error("No channel ID returned");
  } catch (error) {
    const apiError = error as Error & { data?: { error?: string } };
    if (apiError.data?.error === "name_taken") {
      // Race: re-fetch
      const retryRes = await slackApi("conversations.list", token, {
        types: "public_channel,private_channel",
      });
      const retryChannels = (retryRes.channels as SlackChannel[]) || [];
      const found = retryChannels.find((c) => c.name === cleanName);
      if (found?.id) return found.id;
    }
    throw error;
  }
}
