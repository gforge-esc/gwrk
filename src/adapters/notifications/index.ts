/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { CompressionReport } from "../../domain/types.js";
import type {
  NotificationPayload,
  NotificationPort,
} from "../../ports/notification-port.js";
import type { SlackMessage } from "../../server/slack-messages.js";

export function createSlackNotificationAdapter(): NotificationPort {
  return {
    async notify(payload: NotificationPayload): Promise<void> {
      const { notifySlack } = await import("../../server/slack-notify.js");
      await notifySlack(
        {
          text: payload.text,
          channel: payload.channel,
          blocks: payload.blocks as SlackMessage["blocks"],
        },
        undefined,
        { opsOnly: payload.opsOnly },
      );
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
