/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { validateSlackDeliveryContext } from "../../domain/slack-delivery.js";
import type { CompressionReport } from "../../domain/types.js";
import type {
  NotificationPayload,
  NotificationPort,
  SlackDeliveryStatus,
} from "../../ports/notification-port.js";
import type { SlackMessage } from "../../server/slack-messages.js";
import { loadSlackConfig } from "../../utils/slack-client.js";
import { readSlackUserPresence } from "./project-presence.js";
import { createSlackReceiptReader } from "./slack-receipt-reader.js";

export function createSlackNotificationAdapter(
  options: {
    projectRoot?: string;
    signal?: AbortSignal;
    transportTimeoutMs?: number;
  } = {},
): NotificationPort {
  return {
    reconcileDelivery: createSlackReceiptReader({
      getToken: () => loadSlackConfig()?.botToken ?? null,
    }),
    getUserPresence: readSlackUserPresence,
    async getDeliveryStatus(): Promise<SlackDeliveryStatus> {
      const { getSlackApp } = await import("../../server/slack.js");
      const app = getSlackApp();
      if (app) {
        try {
          const auth = await app.client.auth.test();
          if (auth.ok) {
            return {
              mode: "socket_connected",
              workspaceId: auth.team_id,
              connected: true,
            };
          }
          return {
            mode: "degraded",
            connected: false,
            lastError: "Slack authentication failed",
          };
        } catch (error) {
          return {
            mode: "degraded",
            connected: false,
            lastError: error instanceof Error ? error.message : String(error),
          };
        }
      }
      const { loadConfig } = await import("../../utils/config.js");
      let webhookUrl: string | undefined;
      try {
        const config = loadConfig(options.projectRoot ?? process.cwd());
        webhookUrl = config.project.slack?.webhookUrl;
      } catch {
        // config not available
      }
      if (!webhookUrl) {
        webhookUrl = process.env.SLACK_WEBHOOK_URL;
      }
      if (webhookUrl) {
        return {
          mode: "webhook_fallback",
          connected: true,
        };
      }
      return {
        mode: "disabled",
        connected: false,
      };
    },
    async notify(payload: NotificationPayload) {
      const ctxResult = validateSlackDeliveryContext({
        projectId: payload.projectId,
        recipient: payload.recipient,
        channelId: payload.channel,
        threadTs: payload.threadTs,
        opsOnly: payload.opsOnly,
      });
      if (!ctxResult.ok) {
        return undefined;
      }

      const ctx = ctxResult.context;
      if (
        payload.clientMetadataKey !== undefined &&
        (!payload.clientMetadataKey.trim() ||
          !ctx.projectId ||
          !ctx.workspaceId ||
          !ctx.channelId)
      )
        return undefined;
      const notifications = await import("../../server/slack-notify.js");
      const message: SlackMessage = {
        text: payload.text,
        channel: ctx.channelId,
        thread_ts: ctx.threadTs,
        ...(payload.clientMetadataKey && ctx.projectId
          ? {
              metadata: {
                event_type: "gwrk_notification" as const,
                event_payload: {
                  projectId: ctx.projectId,
                  clientMetadataKey: payload.clientMetadataKey,
                },
              },
            }
          : {}),
        blocks: payload.blocks as SlackMessage["blocks"],
      };

      if (payload.ephemeralUserId) {
        if (!message.channel) return undefined;
        return notifications.sendSlackEphemeralMessage(
          message,
          payload.ephemeralUserId,
          {
            ...options,
            projectId: ctx.projectId,
            recipient: ctx.recipient,
            opsOnly: ctx.opsOnly || undefined,
          },
        );
      }

      if (payload.projectId || payload.recipient) {
        if (!message.channel) return undefined;
        return notifications.sendSlackMessage(message, {
          ...options,
          webhookFallback: false,
          ...(payload.clientMetadataKey
            ? { workspaceId: ctx.workspaceId }
            : {}),
          projectId: ctx.projectId,
          recipient: ctx.recipient,
          opsOnly: ctx.opsOnly || undefined,
        });
      }
      return notifications.notifySlack(message, undefined, {
        ...options,
        opsOnly: ctx.opsOnly || undefined,
      });
    },
  };
}

export async function dispatchNotification(
  payload: NotificationPayload,
  notifier: NotificationPort = createSlackNotificationAdapter(),
): Promise<void> {
  await notifier.notify(payload);
}

export async function notifyHarvestComplete(
  report: CompressionReport,
  notifier?: NotificationPort,
): Promise<void> {
  const { MessageBuilder } = await import("../../server/slack-messages.js");
  await dispatchNotification(
    {
      ...MessageBuilder.doneDone(report.featureId, report),
      opsOnly: true,
    },
    notifier,
  );
}
