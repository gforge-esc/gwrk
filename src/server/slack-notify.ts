/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { App } from "@slack/bolt";
import { logCliError, warnCli } from "../adapters/cli/output-scope.js";
import type {
  DeliveryRecipient,
  EnrolledProject,
  SlackFeatureThread,
} from "../domain/project-registry.js";
import {
  type ResolvedSlackRoute,
  resolveSlackDeliveryRoute,
  validateSlackDeliveryContext,
} from "../domain/slack-delivery.js";
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

export interface SendSlackMessageOptions {
  webhookFallback?: boolean;
  projectId?: string;
  recipient?: DeliveryRecipient;
  registry?: ProjectRegistryPort;
  opsOnly?: boolean;
}

export async function verifySlackClientWorkspace(
  client: App["client"] | undefined,
  expectedWorkspaceId: string,
): Promise<boolean> {
  if (!client || typeof client.auth?.test !== "function") {
    return false;
  }
  const auth = await client.auth.test().catch(() => undefined);
  return Boolean(auth?.ok && auth.team_id === expectedWorkspaceId);
}

async function postViaSlackClient(
  client: App["client"],
  message: SlackMessage,
  route: ResolvedSlackRoute,
  options: { webhookFallback?: boolean } = {},
): Promise<NotificationReceipt | undefined> {
  if (!route.channelId) {
    warnCli("No Slack channel configured — skipping notification");
    return undefined;
  }

  try {
    const response = await client.chat.postMessage({
      channel: route.channelId,
      text: message.text,
      blocks: message.blocks,
      thread_ts: route.threadTs,
    });
    if (response.ok) {
      return {
        delivered: true,
        channelId: response.channel,
        messageTs: response.ts,
        threadTs: route.opsOnly
          ? undefined
          : (response.message?.thread_ts ?? route.threadTs),
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logCliError(`Failed to post Slack notification: ${errorMessage}`);

    if (options.webhookFallback !== false && !route.projectId) {
      await sendViaWebhook({
        ...message,
        channel: route.channelId,
        thread_ts: route.threadTs,
      });
    }
  }
  return undefined;
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
  const ctxResult = validateSlackDeliveryContext({
    projectId: options.projectId,
    eventProjectId: event?.projectId,
    recipient: options.recipient,
    eventRecipient: event?.recipient,
    channelId: message.channel,
    threadTs: message.thread_ts,
    opsOnly: options.opsOnly,
    eventOpsOnly: event?.opsOnly,
  });
  if (!ctxResult.ok) {
    return undefined;
  }

  const ctx = ctxResult.context;
  const app = getSlackApp();
  const client = app?.client;

  let project: EnrolledProject | null = null;
  let storedThread: SlackFeatureThread | null = null;
  let registry = options.registry;
  let ownRegistry = false;

  try {
    if (ctx.projectId) {
      try {
        if (!registry) {
          const { createSqliteProjectRegistryAdapter } = await import(
            "../adapters/sqlite/index.js"
          );
          registry = createSqliteProjectRegistryAdapter();
          ownRegistry = true;
        }
        project = registry.getProject(ctx.projectId);
        const featureId = options.featureId ?? event?.feature;
        if (featureId && !ctx.opsOnly) {
          storedThread = registry.getFeatureThread(
            project?.projectId ?? ctx.projectId,
            featureId,
          );
        }
      } catch {
        // Registry unavailable
      }
    }

    let fallbackChannelId: string | undefined;
    let fallbackOpsChannelId: string | undefined;
    if (!ctx.projectId && !ctx.channelId) {
      if (ctx.opsOnly) {
        try {
          const config = loadConfig(process.cwd());
          fallbackOpsChannelId = config.project.slack?.opsChannelId;
        } catch {
          // Config not available
        }
      } else if (client) {
        try {
          const config = loadConfig(process.cwd());
          fallbackChannelId = config.project.slack?.channelId;
        } catch (e) {
          warnCli("Failed to load config for channel resolution:", e);
        }
      }
    }

    const resolved = resolveSlackDeliveryRoute({
      projectId: options.projectId,
      eventProjectId: event?.projectId,
      recipient: options.recipient,
      eventRecipient: event?.recipient,
      channelId: message.channel,
      threadTs: message.thread_ts,
      opsOnly: options.opsOnly,
      eventOpsOnly: event?.opsOnly,
      project,
      storedThread,
      fallbackChannelId,
      fallbackOpsChannelId,
      requireChannel: Boolean(client && (!event || ctx.projectId)),
    });
    if (!resolved.ok) {
      if (resolved.code === "MISSING_CHANNEL") {
        warnCli("No Slack channel configured — skipping notification");
      }
      return undefined;
    }

    const route = resolved.route;

    if (route.expectedWorkspaceId && client) {
      const verified = await verifySlackClientWorkspace(
        client,
        route.expectedWorkspaceId,
      );
      if (!verified) {
        return undefined;
      }
    }

    const routedMessage: SlackMessage = {
      ...message,
      channel: route.channelId,
      thread_ts: route.threadTs,
    };

    let receipt: NotificationReceipt | undefined;
    if (client) {
      // Socket Mode path — full interactivity (buttons, actions)
      if (event) {
        const routedEvent: SlackEvent = {
          ...event,
          projectId: route.projectId ?? event.projectId,
          recipient: route.recipient,
          opsOnly: route.opsOnly || undefined,
        };
        await presenceManager.handleNotification(routedEvent, routedMessage, {
          projectId: route.projectId,
          recipient: route.recipient,
          opsOnly: route.opsOnly || undefined,
          registry: options.registry,
        });
      } else {
        receipt = await postViaSlackClient(client, routedMessage, route, {
          webhookFallback: route.projectId ? false : undefined,
        });
      }
    } else {
      // Webhook fallback — fire-and-forget, no interactive elements
      if (!route.projectId) {
        await sendViaWebhook(routedMessage);
      }
    }

    // Forward to Telegram when configured (dual-channel control plane)
    if (
      !isTelegramPilotDisabled() &&
      !route.projectId &&
      loadTelegramConfig()
    ) {
      await notifyTelegram(routedMessage);
    }
    return receipt;
  } finally {
    if (ownRegistry && registry) {
      registry.close();
    }
  }
}

/**
 * Send a message via Socket Mode app (rich: blocks, buttons, actions).
 */
export async function sendSlackMessage(
  message: SlackMessage,
  options: SendSlackMessageOptions = {},
): Promise<NotificationReceipt | undefined> {
  const app = getSlackApp();
  const client = app?.client;
  if (!client) return undefined;

  const ctxResult = validateSlackDeliveryContext({
    projectId: options.projectId,
    recipient: options.recipient,
    channelId: message.channel,
    threadTs: message.thread_ts,
    opsOnly: options.opsOnly,
  });
  if (!ctxResult.ok) {
    return undefined;
  }

  const ctx = ctxResult.context;
  let project: EnrolledProject | null = null;
  let registry = options.registry;
  let ownRegistry = false;

  try {
    if (ctx.projectId) {
      try {
        if (!registry) {
          const { createSqliteProjectRegistryAdapter } = await import(
            "../adapters/sqlite/index.js"
          );
          registry = createSqliteProjectRegistryAdapter();
          ownRegistry = true;
        }
        project = registry.getProject(ctx.projectId);
      } catch {
        // Registry unavailable
      }
    }

    let fallbackChannelId: string | undefined;
    let fallbackOpsChannelId: string | undefined;
    if (!ctx.projectId && !ctx.channelId) {
      try {
        const config = loadConfig(process.cwd());
        fallbackChannelId = config.project.slack?.channelId;
        fallbackOpsChannelId = config.project.slack?.opsChannelId;
      } catch (e) {
        warnCli("Failed to load config for channel resolution:", e);
      }
    }

    const resolved = resolveSlackDeliveryRoute({
      projectId: options.projectId,
      recipient: options.recipient,
      channelId: message.channel,
      threadTs: message.thread_ts,
      opsOnly: options.opsOnly,
      project,
      fallbackChannelId,
      fallbackOpsChannelId,
      requireChannel: true,
    });
    if (!resolved.ok) {
      if (resolved.code === "MISSING_CHANNEL") {
        warnCli("No Slack channel configured — skipping notification");
      }
      return undefined;
    }

    const route = resolved.route;
    if (route.expectedWorkspaceId) {
      const verified = await verifySlackClientWorkspace(
        client,
        route.expectedWorkspaceId,
      );
      if (!verified) {
        return undefined;
      }
    }

    return await postViaSlackClient(client, message, route, {
      webhookFallback: options.webhookFallback,
    });
  } finally {
    if (ownRegistry && registry) {
      registry.close();
    }
  }
}

export async function sendSlackEphemeralMessage(
  message: SlackMessage,
  userId: string,
  options: Omit<SendSlackMessageOptions, "webhookFallback"> = {},
): Promise<NotificationReceipt | undefined> {
  const app = getSlackApp();
  const client = app?.client;
  if (!client) return undefined;

  const ctxResult = validateSlackDeliveryContext({
    projectId: options.projectId,
    recipient: options.recipient,
    channelId: message.channel,
    threadTs: message.thread_ts,
    opsOnly: options.opsOnly,
  });
  if (!ctxResult.ok) {
    return undefined;
  }

  const ctx = ctxResult.context;
  let project: EnrolledProject | null = null;
  let registry = options.registry;
  let ownRegistry = false;

  try {
    if (ctx.projectId) {
      try {
        if (!registry) {
          const { createSqliteProjectRegistryAdapter } = await import(
            "../adapters/sqlite/index.js"
          );
          registry = createSqliteProjectRegistryAdapter();
          ownRegistry = true;
        }
        project = registry.getProject(ctx.projectId);
      } catch {
        // Registry unavailable
      }
    }

    const resolved = resolveSlackDeliveryRoute({
      projectId: options.projectId,
      recipient: options.recipient,
      channelId: message.channel,
      threadTs: message.thread_ts,
      opsOnly: options.opsOnly,
      project,
      requireChannel: true,
    });
    if (!resolved.ok || !resolved.route.channelId) {
      return undefined;
    }

    const route = resolved.route;
    const channelId = resolved.route.channelId;
    if (route.expectedWorkspaceId) {
      const verified = await verifySlackClientWorkspace(
        client,
        route.expectedWorkspaceId,
      );
      if (!verified) {
        return undefined;
      }
    }

    if (!client.chat?.postEphemeral) {
      return undefined;
    }

    try {
      const res = await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        thread_ts: route.threadTs,
        text: message.text,
        blocks: message.blocks,
      });
      if (res?.ok) {
        return {
          delivered: true,
          channelId,
          messageTs: res.message_ts,
          threadTs: route.threadTs,
        };
      }
      return { delivered: false };
    } catch {
      return { delivered: false };
    }
  } finally {
    if (ownRegistry && registry) {
      registry.close();
    }
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
      logCliError(
        `Webhook notification failed: ${response.status} ${response.statusText}`,
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logCliError(`Webhook notification error: ${errorMessage}`);
  }
}
