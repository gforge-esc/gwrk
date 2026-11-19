/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { logCliError, warnCli } from "../adapters/cli/output-scope.js";
import type { DeliveryRecipient } from "../domain/project-registry.js";
import type { NotificationReceipt } from "../ports/notification-port.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import { loadConfig } from "../utils/config.js";
import type { SlackMessage } from "./slack-messages.js";
import { type SlackEvent, presenceManager } from "./slack-presence.js";
import { getSlackApp } from "./slack.js";
import { loadTelegramConfig, notifyTelegram } from "./telegram-notify.js";
import { isTelegramPilotDisabled } from "./telegram.js";

export interface NotifySlackOptions {
  opsOnly?: boolean;
  projectId?: string;
  recipient?: DeliveryRecipient;
  featureId?: string;
  registry?: ProjectRegistryPort;
}

/**
 * Dispatches a Slack notification.
 * Priority: Socket Mode app → Webhook URL fallback.
 * If an event is provided, it may be throttled/batched based on user presence.
 * If no event is provided, it is sent immediately.
 */
export async function notifySlack(
  message: SlackMessage,
  event?: SlackEvent,
  options: NotifySlackOptions = {},
): Promise<NotificationReceipt | undefined> {
  const app = getSlackApp();
  let receipt: NotificationReceipt | undefined;

  const effectiveProjectId =
    options.projectId ??
    event?.projectId ??
    options.recipient?.projectId ??
    event?.recipient?.projectId;

  let projectChannelId: string | undefined;
  let projectOpsChannelId: string | undefined;

  if (effectiveProjectId) {
    try {
      let registry = options.registry;
      if (!registry) {
        const { createSqliteProjectRegistryAdapter } = await import(
          "../adapters/sqlite/index.js"
        );
        registry = createSqliteProjectRegistryAdapter();
      }
      const project = registry.getProject(effectiveProjectId);
      if (project?.slack) {
        projectChannelId = project.slack.channelId;
        projectOpsChannelId = project.slack.opsChannelId;
      }
      const featureId = options.featureId ?? event?.feature;
      if (featureId && !options.opsOnly && !event?.opsOnly) {
        const storedThread = registry.getFeatureThread(
          project?.projectId ?? effectiveProjectId,
          featureId,
        );
        if (storedThread?.rootTs) {
          message.thread_ts = storedThread.rootTs;
        }
        if (storedThread?.channelId && !message.channel) {
          message.channel = storedThread.channelId;
        }
      }
    } catch {
      // Registry unavailable
    }
  }

  const isOpsOnly = Boolean(options.opsOnly ?? event?.opsOnly);
  if (isOpsOnly) {
    if (projectOpsChannelId) {
      message.channel = projectOpsChannelId;
      message.thread_ts = undefined;
    } else if (!effectiveProjectId) {
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
  } else if (!message.channel && projectChannelId) {
    message.channel = projectChannelId;
  }

  if (app) {
    // Socket Mode path — full interactivity (buttons, actions)
    if (event) {
      await presenceManager.handleNotification(event, message, {
        projectId: effectiveProjectId,
        recipient: options.recipient ?? event.recipient,
      });
    } else {
      receipt = await sendSlackMessage(message, {
        webhookFallback: effectiveProjectId ? false : undefined,
        projectId: effectiveProjectId,
        recipient: options.recipient,
        registry: options.registry,
      });
    }
  } else {
    // Webhook fallback — fire-and-forget, no interactive elements
    if (!effectiveProjectId) {
      await sendViaWebhook(message);
    }
  }

  // Forward to Telegram when configured (dual-channel control plane)
  if (
    !isTelegramPilotDisabled() &&
    !effectiveProjectId &&
    loadTelegramConfig()
  ) {
    await notifyTelegram(message);
  }
  return receipt;
}

/**
 * Send a message via Socket Mode app (rich: blocks, buttons, actions).
 */
export async function sendSlackMessage(
  message: SlackMessage,
  options: {
    webhookFallback?: boolean;
    projectId?: string;
    recipient?: DeliveryRecipient;
    registry?: ProjectRegistryPort;
  } = {},
): Promise<NotificationReceipt | undefined> {
  const app = getSlackApp();
  if (!app) return;

  const effectiveProjectId = options.projectId ?? options.recipient?.projectId;

  // Resolve channel
  let channelId = message.channel ?? options.recipient?.channelId;
  if (!channelId && effectiveProjectId) {
    try {
      let registry = options.registry;
      if (!registry) {
        const { createSqliteProjectRegistryAdapter } = await import(
          "../adapters/sqlite/index.js"
        );
        registry = createSqliteProjectRegistryAdapter();
      }
      const project = registry.getProject(effectiveProjectId);
      channelId = project?.slack?.channelId;
    } catch {
      // Registry unavailable
    }
  }

  if (!channelId && !effectiveProjectId) {
    try {
      const config = loadConfig(process.cwd());
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
    const response = await app.client.chat.postMessage({
      channel: channelId,
      text: message.text,
      blocks: message.blocks,
      thread_ts: message.thread_ts ?? options.recipient?.threadTs,
    });
    if (response.ok) {
      return {
        delivered: true,
        channelId: response.channel,
        messageTs: response.ts,
        threadTs:
          response.message?.thread_ts ??
          message.thread_ts ??
          options.recipient?.threadTs,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logCliError(`Failed to post Slack notification: ${errorMessage}`);

    if (options.webhookFallback !== false && !effectiveProjectId) {
      await sendViaWebhook(message);
    }
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
      logCliError(
        `Webhook notification failed: ${response.status} ${response.statusText}`,
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logCliError(`Webhook notification error: ${errorMessage}`);
  }
}
