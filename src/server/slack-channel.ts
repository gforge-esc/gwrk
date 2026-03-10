import { getSlackApp } from "./slack.js";

export async function ensureSlackChannel(channelName: string): Promise<string> {
  const app = getSlackApp();
  if (!app) {
    throw new Error("Slack not configured. Run gwrk setup slack first");
  }

  // Remove leading # if present for the API call (though it usually wants it without)
  const cleanName = channelName.startsWith("#") ? channelName.slice(1) : channelName;

  try {
    // 1. Try to find the channel if it already exists
    const list = await app.client.conversations.list({
      types: "public_channel,private_channel",
      exclude_archived: true,
    });

    const existing = list.channels?.find((c) => c.name === cleanName);
    if (existing?.id) {
      // Join if not already in it
      if (!existing.is_member) {
        await app.client.conversations.join({ channel: existing.id });
      }
      return existing.id;
    }

    // 2. Create the channel
    const createRes = await app.client.conversations.create({
      name: cleanName,
    });

    if (createRes.channel?.id) {
      return createRes.channel.id;
    }

    throw new Error("Failed to create Slack channel: no ID returned");
  } catch (error) {
    const apiError = error as any;
    if (apiError.data?.error === "name_taken") {
      // Race condition: someone created it between our list and create call
      // Re-fetch to get the ID
      const list = await app.client.conversations.list({
        types: "public_channel,private_channel",
      });
      const existing = list.channels?.find((c) => c.name === cleanName);
      if (existing?.id) return existing.id;
    }
    throw new Error(`Failed to create Slack channel: ${apiError.message || apiError.data?.error || "unknown error"}`);
  }
}
