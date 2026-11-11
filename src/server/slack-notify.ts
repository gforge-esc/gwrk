/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { logCliError, warnCli } from "../adapters/cli/output-scope.js";
import { loadConfig } from "../utils/config.js";
import { postSlackMessageWithSignal } from "./slack-channel.js";
import type { SlackMessage } from "./slack-messages.js";
import { type SlackEvent, presenceManager } from "./slack-presence.js";
import { getSlackApp } from "./slack.js";
import { loadTelegramConfig, notifyTelegram } from "./telegram-notify.js";

/**
 * Dispatches a Slack notification.
 * Priority: Socket Mode app → Webhook URL fallback.
 * If an event is provided, it may be throttled/batched based on user presence.
 * If no event is provided, it is sent immediately.
 */
export async function notifySlack(
  message: SlackMessage,
  event?: SlackEvent,
  options: {
    opsOnly?: boolean;
    projectRoot?: string;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  const { projectRoot = process.cwd(), signal } = options;
  if (signal?.aborted) return;
  const app = getSlackApp();
  const forwardToTelegram = async () => {
    if (!signal?.aborted && loadTelegramConfig(projectRoot)) {
      await notifyTelegram(message, projectRoot, signal);
    }
  };

  if (options.opsOnly) {
    try {
      const config = loadConfig(projectRoot);
      const opsChannelId = config.project.slack?.opsChannelId;
      if (opsChannelId) {
        message.channel = opsChannelId;
      }
    } catch {
      // Config not available — use default channel
    }
  }

  if (app && event) {
    await presenceManager.handleNotification(
      event,
      message,
      signal,
      projectRoot,
      forwardToTelegram,
    );
    return;
  }
  if (app) {
    await sendSlackMessage(message, signal, projectRoot);
  } else {
    await sendViaWebhook(message, signal, projectRoot);
  }

  await forwardToTelegram();
}

/**
 * Send a message via Socket Mode app (rich: blocks, buttons, actions).
 */
export async function sendSlackMessage(
  message: SlackMessage,
  signal?: AbortSignal,
  projectRoot = process.cwd(),
): Promise<void> {
  if (signal?.aborted) return;
  const app = getSlackApp();
  if (!app) return;

  // Resolve channel
  let channelId = message.channel;
  if (!channelId) {
    try {
      const config = loadConfig(projectRoot);
      channelId = config.project.slack?.channelId;
    } catch (e) {
      warnCli("Failed to load config for channel resolution:", e);
    }
  }

  if (!channelId) {
    warnCli("No Slack channel configured — skipping notification");
    return;
  }

  try {
    const payload = {
      channel: channelId,
      text: message.text,
      blocks: message.blocks,
    };
    if (signal)
      await postSlackMessageWithSignal(app.client.token, payload, signal);
    else await app.client.chat.postMessage(payload);
  } catch (error) {
    if (signal?.aborted) return;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logCliError(`Failed to post Slack notification: ${errorMessage}`);

    // Fallback to webhook on Socket Mode failure
    await sendViaWebhook(message, signal, projectRoot);
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
async function sendViaWebhook(
  message: SlackMessage,
  signal: AbortSignal | undefined,
  projectRoot: string,
): Promise<void> {
  if (signal?.aborted) return;
  let webhookUrl: string | undefined;
  try {
    const config = loadConfig(projectRoot);
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
      signal,
    });

    if (!response.ok) {
      logCliError(
        `Webhook notification failed: ${response.status} ${response.statusText}`,
      );
    }
  } catch (error) {
    if (signal?.aborted) return;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logCliError(`Webhook notification error: ${errorMessage}`);
  }
}
