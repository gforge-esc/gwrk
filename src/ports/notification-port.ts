/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { DeliveryRecipient } from "../domain/project-registry.js";

export interface NotificationPayload {
  projectId?: string;
  featureId?: string;
  phaseId?: string;
  recipient?: DeliveryRecipient;
  text: string;
  channel?: string;
  threadTs?: string;
  blocks?: unknown[];
  opsOnly?: boolean;
  ephemeralUserId?: string;
  clientMetadataKey?: string;
}

export interface NotificationReceipt {
  delivered: boolean;
  channelId?: string;
  messageTs?: string;
  threadTs?: string;
  queuedForPresence?: boolean;
}

export interface SlackDeliveryStatus {
  mode: "disabled" | "socket_connected" | "webhook_fallback" | "degraded";
  workspaceId?: string;
  connected: boolean;
  lastError?: string;
}

export interface NotificationReconcileQuery {
  projectId: string;
  workspaceId?: string;
  channelId: string;
  threadTs?: string;
  clientMetadataKey: string;
}

export type NotificationReconcileResult =
  | { status: "found"; receipt: NotificationReceipt }
  | { status: "confirmed_absent" }
  | { status: "indeterminate"; reason: string };

export interface NotificationPort {
  // biome-ignore lint/suspicious/noConfusingVoidType: Existing adapters return Promise<void>.
  notify(payload: NotificationPayload): Promise<void | NotificationReceipt>;
  getUserPresence?(
    workspaceId: string,
    userId: string,
  ): Promise<"active" | "away">;
  getDeliveryStatus?(): Promise<SlackDeliveryStatus>;
  reconcileDelivery?(
    query: NotificationReconcileQuery,
  ): Promise<NotificationReconcileResult>;
}
