/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  NotificationPort,
  NotificationReconcileResult,
} from "../../ports/notification-port.js";
import { createSlackDeliveryReconciler } from "./outbox-reconcile.js";
export interface SlackReceiptReaderOptions {
  getToken(): string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxPages?: number;
}
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const nonblank = (value: unknown): value is string =>
  typeof value === "string" && Boolean(value.trim());
const uncertain = (reason: string): NotificationReconcileResult => ({
  status: "indeterminate",
  reason,
});

export function createSlackReceiptReader(
  options: SlackReceiptReaderOptions,
): NonNullable<NotificationPort["reconcileDelivery"]> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxPages = options.maxPages ?? 100;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isInteger(maxPages) ||
    maxPages < 1
  )
    throw new Error("Invalid Slack receipt reader bounds");
  return async (query) => {
    if (
      !nonblank(query.projectId) ||
      !nonblank(query.workspaceId) ||
      !nonblank(query.channelId) ||
      !nonblank(query.clientMetadataKey) ||
      (query.threadTs !== undefined && !/^\d+\.\d+$/.test(query.threadTs))
    )
      return uncertain("invalid_delivery_scope");
    const workspaceId = query.workspaceId;
    let token: string | null;
    try {
      token = options.getToken();
    } catch {
      return uncertain("credential_unavailable");
    }
    if (!nonblank(token)) return uncertain("credential_unavailable");
    const fetchImpl = options.fetchImpl ?? fetch;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read(
      method: string,
      params?: Record<string, string>,
    ): Promise<unknown> {
      if (controller.signal.aborted) throw new Error("lookup_aborted");
      const url = new URL(`https://slack.com/api/${method}`);
      for (const [key, value] of Object.entries(params ?? {}))
        url.searchParams.set(key, value);
      const response = await fetchImpl(url.toString(), {
        method: method === "auth.test" ? "POST" : "GET",
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("lookup_http_failure");
      return response.json();
    }
    const lookup = async (): Promise<NotificationReconcileResult> => {
      try {
        const auth = object(await read("auth.test"));
        if (auth?.ok !== true || auth.team_id !== query.workspaceId)
          return uncertain("workspace_unverified");
        return await createSlackDeliveryReconciler({
          workspaceId,
          timeoutMs,
          maxPages,
          async readPage(request) {
            const abort = () => controller.abort();
            request.signal.addEventListener("abort", abort, { once: true });
            try {
              if (request.signal.aborted) abort();
              return await read(`conversations.${request.method}`, {
                channel: request.channel,
                include_all_metadata: "true",
                limit: String(request.limit),
                ...(request.ts ? { ts: request.ts } : {}),
                ...(request.cursor ? { cursor: request.cursor } : {}),
              });
            } finally {
              request.signal.removeEventListener("abort", abort);
            }
          },
        })(query);
      } catch {
        return uncertain("lookup_failed");
      }
    };
    try {
      return await Promise.race([
        lookup(),
        new Promise<NotificationReconcileResult>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(uncertain("lookup_timeout"));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  };
}
