import { getSlackApp } from "./slack.js";

interface SlackChannel {
  id: string;
  name: string;
  is_member?: boolean;
}

export async function ensureSlackChannel(channelName: string): Promise<string> {
  const app = getSlackApp();
  if (!app) {
    throw new Error("Slack not configured. Run gwrk setup slack first");
  }

  const cleanName = channelName.startsWith("#")
    ? channelName.slice(1)
    : channelName;

  // 1. Try to find the channel if it already exists
  const listRes = await app.client.conversations.list({
    types: "public_channel,private_channel",
    exclude_archived: true,
    limit: 200,
  });
  const channels = (listRes.channels as SlackChannel[]) || [];
  const existing = channels.find((c) => c.name === cleanName);

  if (existing?.id) {
    if (!existing.is_member) {
      await app.client.conversations.join({ channel: existing.id });
    }
    return existing.id;
  }

  // 2. Create the channel
  try {
    const createRes = await app.client.conversations.create({
      name: cleanName,
    });
    const channel = createRes.channel as SlackChannel | undefined;
    if (channel?.id) {
      return channel.id;
    }
    throw new Error("No channel ID returned");
  } catch (error) {
    const apiError = error as any;
    if (apiError.data?.error === "name_taken") {
      // Race: re-fetch
      const retryRes = await app.client.conversations.list({
        types: "public_channel,private_channel",
      });
      const retryChannels = (retryRes.channels as SlackChannel[]) || [];
      const found = retryChannels.find((c) => c.name === cleanName);
      if (found?.id) return found.id;
    }
    throw error;
  }
}
