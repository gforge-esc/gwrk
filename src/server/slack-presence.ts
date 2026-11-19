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
import { getSlackApp } from "./slack.js";

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
  items: QueuedAwayItem<SlackEvent, SlackMessage>[];
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
    options?: {
      projectId?: string;
      recipientUserId?: string;
      recipient?: DeliveryRecipient;
      opsOnly?: boolean;
      registry?: ProjectRegistryPort;
    },
  ): Promise<void> {
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
              const res = await app.client.users.getPresence({
                user: target.recipientUserId,
              });
              if (
                res.ok &&
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
            const res = await app.client.users.getPresence({
              user: target.recipientUserId,
            });
            if (
              res.ok &&
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

    if (presence === "active") {
      await this.sendImmediately(
        clonedMessage,
        recipient,
        target.projectId,
        isOpsOnly,
        options?.registry,
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
    queue.events.push(event);
    queue.messages.push(clonedMessage);
    queue.items.push({
      event,
      message: clonedMessage,
      recipient,
      channelId: effectiveChannel,
      threadTs: effectiveThreadTs,
      opsOnly: isOpsOnly,
    });

    if (!target.isScoped && (!this.userId || targetUserId === this.userId)) {
      this.queuedEvents.push(event);
    }
  }

  private async sendImmediately(
    message: SlackMessage,
    recipient?: DeliveryRecipient,
    projectId?: string,
    opsOnly?: boolean,
    registry?: ProjectRegistryPort,
  ): Promise<void> {
    // Avoid circular dependency by dynamically importing notifySlack
    const { notifySlack } = await import("./slack-notify.js");
    await notifySlack(message, undefined, {
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

    const partitions = partitionAwayBatch(queue.items);
    this.scopedQueues.delete(key);
    if (queue.projectId === "default") {
      this.queuedEvents = this.queuedEvents.filter(
        (e) =>
          !(
            (e.projectId ?? e.recipient?.projectId ?? "default") ===
              queue.projectId &&
            (e.recipientUserId ?? e.recipient?.actorUserId ?? this.userId) ===
              queue.recipientUserId
          ),
      );
    }

    const { sendSlackMessage } = await import("./slack-notify.js");

    for (const partition of partitions) {
      const batchedEvents = partition.items.map((item) => ({
        type: item.event.type,
        feature: item.event.feature,
      }));
      const summaryMessage = MessageBuilder.batchedSummary(batchedEvents);
      summaryMessage.channel = partition.channelId;
      summaryMessage.thread_ts = partition.threadTs;

      await sendSlackMessage(summaryMessage, {
        projectId: queue.projectId !== "default" ? queue.projectId : undefined,
        recipient: partition.recipient,
        opsOnly: partition.opsOnly || undefined,
        registry: queue.registry,
        webhookFallback: false,
      });
    }
  }

  private async flushQueue(): Promise<void> {
    if (this.queuedEvents.length === 0) return;

    logCliOutput(`User returned. Flushing ${this.queuedEvents.length} events.`);

    // Group by feature/project if needed, but for now simple list
    const batchedEvents = this.queuedEvents.map((e) => ({
      type: e.type,
      feature: e.feature,
    }));

    const summaryMessage = MessageBuilder.batchedSummary(batchedEvents);

    // Use sendSlackMessage directly to avoid circular dependency and bypass presence check
    const { sendSlackMessage } = await import("./slack-notify.js");
    await sendSlackMessage(summaryMessage);

    this.queuedEvents = [];
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
    this.scopedQueues.clear();
    this.userPresence.clear();
    this.queuedEvents = [];
    this.currentPresence = "active";
    this.userId = null;
  }
}

export const presenceManager = PresenceManager.getInstance();
