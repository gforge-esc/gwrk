/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { App } from "@slack/bolt";
import {
  logCliError,
  logCliOutput,
  warnCli,
} from "../adapters/cli/output-scope.js";
import type { DeliveryRecipient } from "../domain/project-registry.js";
import {
  type QueuedAwayItem,
  partitionAwayBatch,
  resolveAwayQueueTarget,
  validateSlackDeliveryContext,
} from "../domain/slack-delivery.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { GwrkConfig } from "../utils/config.js";
import { MessageBuilder, type SlackMessage } from "./slack-messages.js";
import type { SlackTransportOptions } from "./slack-notify.js";
import { getSlackApp } from "./slack.js";

interface PendingAwayItem
  extends QueuedAwayItem<SlackEvent, SlackMessage>,
    SlackTransportOptions {
  finish?: () => void;
  detachAbort?: () => void;
}

async function withCancellation<T>(
  request: Promise<T>,
  signal?: AbortSignal,
): Promise<T | undefined> {
  if (!signal) return request;
  if (signal.aborted) return undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<undefined>((resolve) => {
        onAbort = () => resolve(undefined);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export interface SlackEvent {
  type:
    | "phase_start"
    | "phase_complete"
    | "phase_fail"
    | "ci_result"
    | "review_ready"
    | "done_done"
    | "define_spec_ready"
    | "define_plan_ready"
    | "spec_ready"
    | "plan_ready"
    | "pulse";
  feature: string;
  phase?: string;
  opsOnly?: boolean;
  payload: Record<string, unknown>;
  timestamp: string;
  projectId?: string;
  recipient?: DeliveryRecipient;
  recipientUserId?: string;
}

interface ScopedAwayQueue {
  projectId: string;
  recipientUserId: string;
  recipient?: DeliveryRecipient;
  registry?: ProjectRegistryPort;
  events: SlackEvent[];
  messages: SlackMessage[];
  items: PendingAwayItem[];
}

class PresenceManager {
  private static instance: PresenceManager;
  private queuedEvents: SlackEvent[] = [];
  private scopedQueues: Map<string, ScopedAwayQueue> = new Map();
  private userPresence: Map<string, "active" | "away"> = new Map();
  private currentPresence: "active" | "away" = "active";
  private userId: string | null = null;
  private pollerInterval: NodeJS.Timeout | null = null;

  private constructor() {}

  public static getInstance(): PresenceManager {
    if (!PresenceManager.instance) {
      PresenceManager.instance = new PresenceManager();
    }
    return PresenceManager.instance;
  }

  public async init(config: GwrkConfig): Promise<void> {
    const app = getSlackApp();
    if (!app) return;

    try {
      const interval = config?.server?.slack?.presencePollIntervalMs || 60000;

      if (this.pollerInterval) {
        clearInterval(this.pollerInterval);
      }

      this.pollerInterval = setInterval(() => {
        this.checkPresence(app).catch((err) => {
          logCliError("Error checking Slack presence:", err);
        });
      }, interval);

      // Initial check
      await this.checkPresence(app);
    } catch (error) {
      warnCli("Presence detection initialization failed:", error);
    }
  }

  private async checkPresence(app: App): Promise<void> {
    const usersToCheck = new Set<string>();
    if (this.userId) {
      usersToCheck.add(this.userId);
    }
    for (const uid of this.userPresence.keys()) {
      usersToCheck.add(uid);
    }
    for (const queue of this.scopedQueues.values()) {
      if (queue.recipientUserId && queue.recipientUserId !== "unknown") {
        usersToCheck.add(queue.recipientUserId);
      }
    }

    for (const user of usersToCheck) {
      try {
        const result = await app.client.users.getPresence({ user });
        if (result.ok) {
          const newPresence = result.presence === "active" ? "active" : "away";
          const oldPresence =
            this.userPresence.get(user) ??
            (user === this.userId ? this.currentPresence : "active");

          this.userPresence.set(user, newPresence);
          if (user === this.userId) {
            this.currentPresence = newPresence;
          }

          if (newPresence === "active" && oldPresence === "away") {
            await this.flushUserQueues(user);
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        warnCli(`Presence API unavailable: ${errorMessage}`);
      }
    }
  }

  public async handleNotification(
    event: SlackEvent,
    message: SlackMessage,
    options?: SlackTransportOptions & {
      projectId?: string;
      recipientUserId?: string;
      recipient?: DeliveryRecipient;
      opsOnly?: boolean;
      registry?: ProjectRegistryPort;
    },
  ): Promise<void> {
    if (options?.signal?.aborted) return;
    const validated = validateSlackDeliveryContext({
      projectId: options?.projectId,
      eventProjectId: event.projectId,
      recipient: options?.recipient,
      eventRecipient: event.recipient,
      channelId: message.channel,
      threadTs: message.thread_ts,
      opsOnly: options?.opsOnly,
      eventOpsOnly: event.opsOnly,
    });
    if (!validated.ok) {
      return;
    }

    const ctx = validated.context;
    const isOpsOnly = ctx.opsOnly;
    const effectiveChannel = ctx.channelId;
    const effectiveThreadTs = ctx.threadTs;
    const recipient = ctx.recipient;

    const clonedMessage: SlackMessage = {
      ...message,
      channel: effectiveChannel,
      thread_ts: effectiveThreadTs,
    };

    const target = resolveAwayQueueTarget({
      projectId: options?.projectId,
      eventProjectId: event.projectId,
      recipient,
      recipientUserId: options?.recipientUserId,
      eventRecipientUserId: event.recipientUserId,
      legacyUserId: this.userId,
    });

    let presence: "active" | "away" = "active";
    if (target.isScoped) {
      if (target.recipientUserId) {
        const knownPresence = this.userPresence.get(target.recipientUserId);
        if (knownPresence) {
          presence = knownPresence;
        } else {
          const app = getSlackApp();
          if (app?.client?.users?.getPresence) {
            try {
              const res = await withCancellation(
                app.client.users.getPresence({ user: target.recipientUserId }),
                options?.signal,
              );
              if (
                res?.ok &&
                (res.presence === "active" || res.presence === "away")
              ) {
                presence = res.presence;
                this.userPresence.set(target.recipientUserId, presence);
              }
            } catch {
              presence = "active";
            }
          }
        }
      }
    } else if (target.recipientUserId) {
      const knownPresence = this.userPresence.get(target.recipientUserId);
      if (knownPresence) {
        presence = knownPresence;
      } else if (target.recipientUserId === this.userId) {
        presence = this.currentPresence;
      } else {
        const app = getSlackApp();
        if (app?.client?.users?.getPresence) {
          try {
            const res = await withCancellation(
              app.client.users.getPresence({ user: target.recipientUserId }),
              options?.signal,
            );
            if (
              res?.ok &&
              (res.presence === "active" || res.presence === "away")
            ) {
              presence = res.presence;
              this.userPresence.set(target.recipientUserId, presence);
            }
          } catch {
            presence = this.currentPresence;
          }
        } else {
          presence = this.currentPresence;
        }
      }
    } else {
      presence = this.currentPresence;
    }

    if (options?.signal?.aborted) return;
    if (presence === "active") {
      await this.sendImmediately(
        clonedMessage,
        recipient,
        target.projectId,
        isOpsOnly,
        options?.registry,
        options,
      );
      return;
    }

    logCliOutput(
      `User away. Queuing event: ${event.type} for ${event.feature}`,
    );

    const targetUserId = target.recipientUserId ?? "unknown";
    const key = `${target.projectId}:${targetUserId}`;
    let queue = this.scopedQueues.get(key);
    if (!queue) {
      queue = {
        projectId: target.projectId,
        recipientUserId: targetUserId,
        recipient,
        registry: options?.registry,
        events: [],
        messages: [],
        items: [],
      };
      this.scopedQueues.set(key, queue);
    } else if (!queue.registry && options?.registry) {
      queue.registry = options.registry;
    }
    const queuedEvent = { ...event };
    const pending: PendingAwayItem = {
      event: queuedEvent,
      message: clonedMessage,
      recipient,
      channelId: effectiveChannel,
      threadTs: effectiveThreadTs,
      opsOnly: isOpsOnly,
      signal: options?.signal,
      projectRoot: options?.projectRoot,
      transportTimeoutMs: options?.transportTimeoutMs,
    };
    queue.events.push(queuedEvent);
    queue.messages.push(clonedMessage);
    queue.items.push(pending);
    if (!target.isScoped && (!this.userId || targetUserId === this.userId)) {
      this.queuedEvents.push(queuedEvent);
    }
    const signal = options?.signal;
    if (!signal) return;
    await new Promise<void>((resolve) => {
      const onAbort = () => {
        const index = queue.items.indexOf(pending);
        if (index !== -1) {
          queue.items.splice(index, 1);
          queue.events.splice(index, 1);
          queue.messages.splice(index, 1);
        }
        this.queuedEvents = this.queuedEvents.filter(
          (item) => item !== queuedEvent,
        );
        if (!queue.items.length) this.scopedQueues.delete(key);
        resolve();
      };
      pending.finish = resolve;
      pending.detachAbort = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }

  private async sendImmediately(
    message: SlackMessage,
    recipient?: DeliveryRecipient,
    projectId?: string,
    opsOnly?: boolean,
    registry?: ProjectRegistryPort,
    transport?: SlackTransportOptions,
  ): Promise<void> {
    // Avoid circular dependency by dynamically importing notifySlack
    const { notifySlack } = await import("./slack-notify.js");
    await notifySlack(message, undefined, {
      ...transport,
      projectId: projectId !== "default" ? projectId : undefined,
      recipient,
      opsOnly: opsOnly || undefined,
      registry,
    });
  }

  public async flushUserQueues(userId: string): Promise<void> {
    const keysToFlush: string[] = [];
    for (const [key, queue] of this.scopedQueues.entries()) {
      if (queue.recipientUserId === userId && queue.events.length > 0) {
        keysToFlush.push(key);
      }
    }
    for (const key of keysToFlush) {
      await this.flushScopedQueue(key);
    }
    if (this.userId && userId === this.userId && this.queuedEvents.length > 0) {
      await this.flushQueue();
    }
  }

  public async flushScopedQueue(key: string): Promise<void> {
    const queue = this.scopedQueues.get(key);
    if (!queue || queue.events.length === 0) return;

    logCliOutput(
      `User returned. Flushing ${queue.events.length} events for ${queue.projectId}:${queue.recipientUserId}.`,
    );

    const accepted = queue.items.filter((item) => !item.signal?.aborted);
    for (const item of queue.items) {
      item.detachAbort?.();
      if (item.signal?.aborted) item.finish?.();
    }
    const partitions = partitionAwayBatch(accepted);
    this.scopedQueues.delete(key);
    this.queuedEvents = this.queuedEvents.filter(
      (event) => !queue.items.some((item) => item.event === event),
    );
    const { sendSlackMessage } = await import("./slack-notify.js");
    for (const partition of partitions) {
      const transportGroups = new Map<
        string,
        Map<AbortSignal | undefined, PendingAwayItem[]>
      >();
      for (const item of partition.items) {
        const pending = accepted.find((candidate) => candidate === item);
        if (!pending) continue;
        const root = pending.projectRoot ?? process.cwd();
        const signals =
          transportGroups.get(root) ??
          new Map<AbortSignal | undefined, PendingAwayItem[]>();
        const group = signals.get(pending.signal) ?? [];
        group.push(pending);
        signals.set(pending.signal, group);
        transportGroups.set(root, signals);
      }
      for (const [projectRoot, signals] of transportGroups) {
        for (const [signal, items] of signals) {
          try {
            if (signal?.aborted) continue;
            const summary = MessageBuilder.batchedSummary(
              items.map(({ event }) => ({
                type: event.type,
                feature: event.feature,
              })),
            );
            summary.channel = partition.channelId;
            summary.thread_ts = partition.threadTs;
            const deadlines = items.flatMap((item) =>
              item.transportTimeoutMs === undefined
                ? []
                : [item.transportTimeoutMs],
            );
            await sendSlackMessage(summary, {
              projectId:
                queue.projectId !== "default" ? queue.projectId : undefined,
              recipient: partition.recipient,
              opsOnly: partition.opsOnly || undefined,
              registry: queue.registry,
              webhookFallback: false,
              projectRoot,
              signal,
              transportTimeoutMs: deadlines.length
                ? Math.min(...deadlines)
                : undefined,
            });
          } finally {
            for (const item of items) item.finish?.();
          }
        }
      }
    }
  }

  private async flushQueue(): Promise<void> {
    for (const [key, queue] of this.scopedQueues) {
      if (
        queue.projectId === "default" &&
        (this.userId
          ? queue.recipientUserId === this.userId
          : queue.recipientUserId === "unknown")
      ) {
        await this.flushScopedQueue(key);
      }
    }
  }

  public setUserId(userId: string | null): void {
    this.userId = userId;
  }

  public setUserPresence(userId: string, presence: "active" | "away"): void {
    this.userPresence.set(userId, presence);
    if (!this.userId) {
      this.userId = userId;
    }
    if (userId === this.userId) {
      this.currentPresence = presence;
    }
  }

  public getScopedQueue(
    projectId: string,
    recipientUserId: string,
  ): ScopedAwayQueue | undefined {
    return this.scopedQueues.get(`${projectId}:${recipientUserId}`);
  }

  public stop(): void {
    if (this.pollerInterval) {
      clearInterval(this.pollerInterval);
      this.pollerInterval = null;
    }
    for (const queue of this.scopedQueues.values())
      for (const item of queue.items) {
        item.detachAbort?.();
        item.finish?.();
      }
    this.scopedQueues.clear();
    this.userPresence.clear();
    this.queuedEvents = [];
    this.currentPresence = "active";
    this.userId = null;
  }
}

export const presenceManager = PresenceManager.getInstance();
