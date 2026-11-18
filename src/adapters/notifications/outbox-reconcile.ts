/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  NotificationPort,
  NotificationReceipt,
  NotificationReconcileQuery,
  NotificationReconcileResult,
} from "../../ports/notification-port.js";

export interface SlackReceiptPageRequest {
  method: "history" | "replies";
  channel: string;
  ts?: string;
  cursor?: string;
  include_all_metadata: true;
  limit: number;
  signal: AbortSignal;
}
interface Options {
  workspaceId: string;
  readPage(request: SlackReceiptPageRequest): Promise<unknown>;
  timeoutMs?: number;
  maxPages?: number;
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const uncertain = (reason: string): NotificationReconcileResult => ({
  status: "indeterminate",
  reason,
});
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && /^\d+\.\d+$/.test(value);
const nonblank = (value: unknown): value is string =>
  typeof value === "string" && Boolean(value.trim());

export function createSlackDeliveryReconciler(
  options: Options,
): NonNullable<NotificationPort["reconcileDelivery"]> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxPages = options.maxPages ?? 100;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isInteger(maxPages) ||
    maxPages < 1
  )
    throw new Error("Invalid Slack reconciliation bounds");
  return async (query: NotificationReconcileQuery) => {
    if (
      !nonblank(query.projectId) ||
      !nonblank(query.workspaceId) ||
      query.workspaceId !== options.workspaceId ||
      !nonblank(query.channelId) ||
      !nonblank(query.clientMetadataKey) ||
      (query.threadTs !== undefined && !timestamp(query.threadTs))
    )
      return uncertain("invalid_delivery_scope");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const readAll = async (): Promise<NotificationReconcileResult> => {
      let cursor: string | undefined;
      const cursors = new Set<string>();
      const matches = new Map<string, NotificationReceipt>();
      for (let index = 0; index < maxPages; index++) {
        if (controller.signal.aborted) return uncertain("lookup_timeout");
        let response: unknown;
        try {
          response = await options.readPage({
            method: query.threadTs ? "replies" : "history",
            channel: query.channelId,
            ...(query.threadTs ? { ts: query.threadTs } : {}),
            ...(cursor ? { cursor } : {}),
            include_all_metadata: true,
            limit: 100,
            signal: controller.signal,
          });
        } catch {
          return uncertain("lookup_failed");
        }
        const page = record(response);
        if (page?.ok !== true || !Array.isArray(page.messages))
          return uncertain("lookup_incomplete");
        if (page.has_more !== undefined && typeof page.has_more !== "boolean")
          return uncertain("lookup_incomplete");
        for (const raw of page.messages) {
          const message = record(raw);
          const metadata = record(message?.metadata);
          const payload = record(metadata?.event_payload);
          if (
            metadata?.event_type !== "gwrk_notification" ||
            payload?.clientMetadataKey !== query.clientMetadataKey
          )
            continue;
          if (
            payload.projectId !== query.projectId ||
            !timestamp(message?.ts) ||
            (message.channel !== undefined &&
              message.channel !== query.channelId)
          )
            return uncertain("receipt_scope_mismatch");
          const routeThread =
            message.thread_ts === message.ts ? undefined : message.thread_ts;
          if (routeThread !== query.threadTs)
            return uncertain("receipt_thread_mismatch");
          matches.set(message.ts, {
            delivered: true,
            channelId: query.channelId,
            messageTs: message.ts,
            ...(query.threadTs ? { threadTs: query.threadTs } : {}),
          });
          if (matches.size > 1) return uncertain("duplicate_metadata_key");
        }
        const metadata =
          page.response_metadata === undefined
            ? undefined
            : record(page.response_metadata);
        if (page.response_metadata !== undefined && !metadata)
          return uncertain("lookup_incomplete");
        const next = metadata?.next_cursor;
        if (next !== undefined && typeof next !== "string")
          return uncertain("lookup_incomplete");
        if (typeof next === "string" && next.trim()) {
          if (cursors.has(next)) return uncertain("pagination_not_progressing");
          cursors.add(next);
          cursor = next;
          continue;
        }
        if (page.has_more === true) return uncertain("lookup_incomplete");
        if (page.has_more !== undefined && typeof page.has_more !== "boolean")
          return uncertain("lookup_incomplete");
        const receipt = matches.values().next().value;
        return receipt
          ? { status: "found", receipt }
          : { status: "confirmed_absent" };
      }
      return uncertain("pagination_limit");
    };
    try {
      return await Promise.race([
        readAll(),
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
