import { loadConfig } from "../utils/config.js";
import type { SlackMessage } from "./slack-messages.js";
import { type SlackEvent, presenceManager } from "./slack-presence.js";
import { getSlackApp } from "./slack.js";

/**
 * Dispatches a Slack notification.
 * Priority: Socket Mode app → Webhook URL fallback.
 * If an event is provided, it may be throttled/batched based on user presence.
 * If no event is provided, it is sent immediately.
 */
export async function notifySlack(
  message: SlackMessage,
  event?: SlackEvent,
  options: { opsOnly?: boolean } = {},
): Promise<void> {
  const app = getSlackApp();

  if (options.opsOnly) {
    try {
      const config = loadConfig(process.cwd());
      const opsChannelId = config.project.slack?.opsChannelId;
      if (opsChannelId) {
        message.channel = opsChannelId;
      }
    } catch {
      // Config not available — use default channel
    }
  }

  if (app) {
    // Socket Mode path — full interactivity (buttons, actions)
    if (event) {
      await presenceManager.handleNotification(event, message);
    } else {
      await sendSlackMessage(message);
    }
  } else {
    // Webhook fallback — fire-and-forget, no interactive elements
    await sendViaWebhook(message);
  }
}

/**
 * Send a message via Socket Mode app (rich: blocks, buttons, actions).
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

    // Fallback to webhook on Socket Mode failure
    await sendViaWebhook(message);
  }
}

/**
 * Send a message via Incoming Webhook (no buttons, but works anywhere).
 * Loads webhookUrl from per-project .gwrkrc.json config.
 *
 * This is the fallback for environments without Socket Mode:
 * - Codex Cloud (firewalled, no localhost)
 * - Shell scripts (work-until-done.sh)
 * - CI pipelines
 */
async function sendViaWebhook(message: SlackMessage): Promise<void> {
  let webhookUrl: string | undefined;
  try {
    const config = loadConfig(process.cwd());
    webhookUrl = config.project.slack?.webhookUrl;
  } catch {
    // Config not available
  }

  // Also check env override (useful in CI)
  if (!webhookUrl) {
    webhookUrl = process.env.SLACK_WEBHOOK_URL;
  }

  if (!webhookUrl) {
    // Silent — webhook not configured, that's fine
    return;
  }

  try {
    const payload: Record<string, unknown> = {
      text: message.text,
    };

    // Webhooks support blocks but NOT interactive elements (buttons).
    // Strip action blocks so the message renders cleanly.
    if (message.blocks) {
      payload.blocks = message.blocks.filter(
        (b) => (b as { type: string }).type !== "actions",
      );
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(
        `Webhook notification failed: ${response.status} ${response.statusText}`,
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Webhook notification error: ${errorMessage}`);
  }
}
