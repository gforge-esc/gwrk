/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { CompressionReport } from "../../domain/types.js";
import type {
  NotificationPayload,
  NotificationPort,
  SlackDeliveryStatus,
} from "../../ports/notification-port.js";
import type { SlackMessage } from "../../server/slack-messages.js";
import { readSlackUserPresence } from "./project-presence.js";

export function createSlackNotificationAdapter(): NotificationPort {
  return {
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
        const config = loadConfig(process.cwd());
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
      if (payload.recipient) {
        if (
          payload.projectId &&
          payload.recipient.projectId &&
          payload.projectId !== payload.recipient.projectId
        ) {
          return undefined;
        }
        if (
          payload.channel &&
          payload.recipient.channelId &&
          payload.channel !== payload.recipient.channelId
        ) {
          return undefined;
        }
        if (payload.recipient.workspaceId) {
          const { getSlackApp } = await import("../../server/slack.js");
          const client = getSlackApp()?.client;
          if (!client) {
            return undefined;
          }
          if (client.auth?.test) {
            const auth = await client.auth
              .test()
              .catch(() => ({ ok: false as const }));
            if (!auth.ok || auth.team_id !== payload.recipient.workspaceId) {
              return undefined;
            }
          }
        }
      }

      const notifications = await import("../../server/slack-notify.js");
      const message: SlackMessage = {
        text: payload.text,
        channel: payload.channel ?? payload.recipient?.channelId,
        thread_ts: payload.threadTs ?? payload.recipient?.threadTs,
        blocks: payload.blocks as SlackMessage["blocks"],
      };
      if (payload.projectId || payload.recipient) {
        if (!message.channel) return undefined;
        return notifications.sendSlackMessage(message, {
          webhookFallback: false,
        });
      }
      return notifications.notifySlack(message, undefined, {
        opsOnly: payload.opsOnly,
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
