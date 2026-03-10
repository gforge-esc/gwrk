import { getSlackApp } from "./slack.js";
import type { SlackMessage } from "./slack-messages.js";
import { loadConfig } from "../utils/config.js";

export async function notifySlack(message: SlackMessage): Promise<void> {
  const app = getSlackApp();
  if (!app) {
    // Silent fail if Slack is not configured, or log it?
    // Spec says: "FR-003: Slack not configured. Run gwrk setup slack first -> Exit 1"
    // But this is usually for CLI commands. For server notifications, maybe just log a warning.
    console.warn("Slack not configured — skipping notification");
    return;
  }

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
    console.error(`Failed to post Slack notification: ${(error as any).message}`);
  }
}
