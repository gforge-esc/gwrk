/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { logCliError, warnCli } from "../adapters/cli/output-scope.js";
import type { NotificationReceipt } from "../ports/notification-port.js";
import { loadConfig } from "../utils/config.js";
import { postSlackMessageWithSignal } from "./slack-channel.js";
import type { SlackMessage } from "./slack-messages.js";
import { type SlackEvent, presenceManager } from "./slack-presence.js";
import { getSlackApp } from "./slack.js";
import { loadTelegramConfig, notifyTelegram } from "./telegram-notify.js";

type SlackTransportOptions = {
  projectRoot?: string;
  signal?: AbortSignal;
  transportTimeoutMs?: number;
  webhookFallback?: boolean;
};

function deliverySignal(signal?: AbortSignal, timeoutMs?: number) {
  if (timeoutMs === undefined) return signal;
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function notifySlack(
  message: SlackMessage,
  event?: SlackEvent,
  options: SlackTransportOptions & { opsOnly?: boolean } = {},
): Promise<NotificationReceipt | undefined> {
  const { projectRoot = process.cwd(), signal, transportTimeoutMs } = options;
  if (signal?.aborted) return;
  const app = getSlackApp();
  const forwardToTelegram = async () => {
    if (!signal?.aborted && loadTelegramConfig(projectRoot)) {
      await notifyTelegram(
        message,
        projectRoot,
        deliverySignal(signal, transportTimeoutMs),
      );
    }
  };
  if (options.opsOnly) {
    try {
      const channel = loadConfig(projectRoot).project.slack?.opsChannelId;
      if (channel) message.channel = channel;
    } catch {
      // Keep the accepted channel when project configuration is unavailable.
    }
  }
  if (app && event) {
    await presenceManager.handleNotification(
      event,
      message,
      signal,
      projectRoot,
      forwardToTelegram,
      transportTimeoutMs,
    );
    return;
  }
  let receipt: NotificationReceipt | undefined;
  if (app) receipt = await sendSlackMessage(message, options);
  else
    await sendViaWebhook(
      message,
      deliverySignal(signal, transportTimeoutMs),
      projectRoot,
    );
  await forwardToTelegram();
  return receipt;
}

export async function sendSlackMessage(
  message: SlackMessage,
  options: SlackTransportOptions = {},
): Promise<NotificationReceipt | undefined> {
  const { projectRoot = process.cwd(), transportTimeoutMs } = options;
  const signal = deliverySignal(options.signal, transportTimeoutMs);
  if (signal?.aborted) return;
  const app = getSlackApp();
  if (!app) return;
  let channelId = message.channel;
  if (!channelId) {
    try {
      channelId = loadConfig(projectRoot).project.slack?.channelId;
    } catch (error) {
      warnCli("Failed to load config for channel resolution:", error);
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
      thread_ts: message.thread_ts,
    };
    const response = signal
      ? await postSlackMessageWithSignal(app.client.token, payload, signal)
      : await app.client.chat.postMessage(payload);
    if (response.ok)
      return {
        delivered: true,
        channelId: response.channel,
        messageTs: response.ts,
        threadTs: response.message?.thread_ts ?? message.thread_ts,
      };
  } catch (error) {
    if (signal?.aborted) return;
    logCliError(
      `Failed to post Slack notification: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (options.webhookFallback !== false)
      await sendViaWebhook(message, signal, projectRoot);
  }
  return undefined;
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
