/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export interface NotificationPayload {
  text: string;
  channel?: string;
  blocks?: unknown[];
  opsOnly?: boolean;
}

export interface NotificationPort {
  notify(payload: NotificationPayload): Promise<void>;
}

let activeNotificationPort: NotificationPort | null = null;

export function registerNotificationPort(port: NotificationPort | null): void {
  activeNotificationPort = port;
}

export function getNotificationPort(): NotificationPort | null {
  return activeNotificationPort;
}
