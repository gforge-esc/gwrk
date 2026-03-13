import { loadConfig } from "../utils/config.js";
import type { SlackMessage } from "./slack-messages.js";
import { type SlackEvent, presenceManager } from "./slack-presence.js";
import { getSlackApp } from "./slack.js";

/**
 * Dispatches a Slack notification.
 * If an event is provided, it may be throttled/batched based on user presence.
 * If no event is provided, it is sent immediately.
 */
export async function notifySlack(
  message: SlackMessage,
  event?: SlackEvent,
  options: { opsOnly?: boolean } = {},
): Promise<void> {
  const app = getSlackApp();
  if (!app) {
    console.warn("Slack not configured — skipping notification");
    return;
  }

  if (options.opsOnly) {
    const config = loadConfig(process.cwd());
    const opsChannelId = config.project.slack?.opsChannelId;
    if (opsChannelId) {
      message.channel = opsChannelId;
    }
  }

  if (event) {
    // Presence-aware routing
    await presenceManager.handleNotification(event, message);
  } else {
    // Immediate delivery for non-event messages (or if you want to bypass presence)
    await sendSlackMessage(message);
  }
}

/**
 * Internal helper to send a message immediately.
 */
export async function sendSlackMessage(message: SlackMessage): Promise<void> {
  const app = getSlackApp();
  if (!app) return;

  // Resolve channel
  let channelId = message.channel;
  if (!channelId) {
    try {
      const config = loadConfig(process.cwd());
      channelId = config.project.slack?.channelId;
    } catch (e) {
      console.warn("Failed to load config for channel resolution:", e);
    }
  }

  if (!channelId) {
    console.warn("No Slack channel configured — skipping notification");
    return;
  }

  try {
    await app.client.chat.postMessage({
      channel: channelId,
      text: message.text,
      blocks: message.blocks,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to post Slack notification: ${errorMessage}`);
  }
}
