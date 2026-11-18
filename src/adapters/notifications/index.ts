/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { CompressionReport } from "../../domain/types.js";
import type {
  NotificationPayload,
  NotificationPort,
} from "../../ports/notification-port.js";
import type { SlackMessage } from "../../server/slack-messages.js";
import { loadSlackConfig } from "../../utils/slack-client.js";
import { createSlackReceiptReader } from "./slack-receipt-reader.js";

export function createSlackNotificationAdapter(): NotificationPort {
  return {
    reconcileDelivery: createSlackReceiptReader({
      getToken: () => loadSlackConfig()?.botToken ?? null,
    }),
    async notify(payload: NotificationPayload) {
      const recipient = payload.recipient;
      if (
        recipient &&
        (recipient.surface !== "slack" ||
          (payload.projectId !== undefined &&
            payload.projectId !== recipient.projectId) ||
          (payload.channel !== undefined &&
            recipient.channelId !== undefined &&
            payload.channel !== recipient.channelId) ||
          (payload.threadTs !== undefined &&
            recipient.threadTs !== undefined &&
            payload.threadTs !== recipient.threadTs))
      )
        return undefined;
      if (
        payload.clientMetadataKey !== undefined &&
        (!payload.clientMetadataKey.trim() ||
          !payload.projectId ||
          !recipient?.workspaceId ||
          !recipient.channelId)
      )
        return undefined;
      const notifications = await import("../../server/slack-notify.js");
      const message: SlackMessage = {
        text: payload.text,
        channel: payload.channel ?? payload.recipient?.channelId,
        thread_ts: payload.threadTs ?? recipient?.threadTs,
        ...(payload.clientMetadataKey && payload.projectId
          ? {
              metadata: {
                event_type: "gwrk_notification" as const,
                event_payload: {
                  projectId: payload.projectId,
                  clientMetadataKey: payload.clientMetadataKey,
                },
              },
            }
          : {}),
        blocks: payload.blocks as SlackMessage["blocks"],
      };
      if (payload.projectId || payload.recipient) {
        if (!message.channel) return undefined;
        return notifications.sendSlackMessage(message, {
          webhookFallback: false,
          ...(payload.clientMetadataKey
            ? { workspaceId: recipient?.workspaceId }
            : {}),
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
