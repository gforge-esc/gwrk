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

interface BatchedNotification {
  projectId: string;
  events: SlackEvent[];
  batchedSince: string;
}

interface ScopedAwayQueue {
  projectId: string;
  recipientUserId: string;
  recipient?: DeliveryRecipient;
  events: SlackEvent[];
  messages: SlackMessage[];
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
      if (queue.recipientUserId) {
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
    },
  ): Promise<void> {
    const recipient = event.recipient ?? options?.recipient;
    const projectId =
      event.projectId ??
      options?.projectId ??
      recipient?.projectId ??
      "default";
    const recipientUserId =
      event.recipientUserId ??
      options?.recipientUserId ??
      recipient?.actorUserId ??
      this.userId;

    let presence: "active" | "away" = "active";
    if (recipientUserId) {
      const knownPresence = this.userPresence.get(recipientUserId);
      if (knownPresence) {
        presence = knownPresence;
      } else if (recipientUserId === this.userId) {
        presence = this.currentPresence;
      } else {
        const app = getSlackApp();
        if (app?.client?.users?.getPresence) {
          try {
            const res = await app.client.users.getPresence({
              user: recipientUserId,
            });
            if (
              res.ok &&
              (res.presence === "active" || res.presence === "away")
            ) {
              presence = res.presence;
              this.userPresence.set(recipientUserId, presence);
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
      await this.sendImmediately(message, recipient, projectId);
    } else {
      logCliOutput(
        `User away. Queuing event: ${event.type} for ${event.feature}`,
      );

      const targetUserId = recipientUserId ?? "unknown";
      const key = `${projectId}:${targetUserId}`;
      let queue = this.scopedQueues.get(key);
      if (!queue) {
        queue = {
          projectId,
          recipientUserId: targetUserId,
          recipient,
          events: [],
          messages: [],
        };
        this.scopedQueues.set(key, queue);
      }
      queue.events.push(event);
      queue.messages.push(message);

      if (
        !recipient &&
        projectId === "default" &&
        (!this.userId || targetUserId === this.userId)
      ) {
        this.queuedEvents.push(event);
      }
    }
  }

  private async sendImmediately(
    message: SlackMessage,
    recipient?: DeliveryRecipient,
    projectId?: string,
  ): Promise<void> {
    // Avoid circular dependency by dynamically importing notifySlack
    const { notifySlack } = await import("./slack-notify.js");
    await notifySlack(message, undefined, {
      projectId: projectId !== "default" ? projectId : undefined,
      recipient,
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

    const batchedEvents = queue.events.map((e) => ({
      type: e.type,
      feature: e.feature,
    }));

    const summaryMessage = MessageBuilder.batchedSummary(batchedEvents);

    if (queue.recipient?.channelId) {
      summaryMessage.channel = queue.recipient.channelId;
    }
    const threadIds = new Set(
      queue.events.map((e) => e.recipient?.threadTs).filter(Boolean),
    );
    if (
      threadIds.size === 1 &&
      queue.events.every((e) => e.recipient?.threadTs)
    ) {
      summaryMessage.thread_ts = queue.events[0].recipient?.threadTs;
    } else {
      summaryMessage.thread_ts = undefined;
    }

    const { sendSlackMessage } = await import("./slack-notify.js");
    await sendSlackMessage(summaryMessage, {
      projectId: queue.projectId !== "default" ? queue.projectId : undefined,
      recipient: queue.recipient,
      webhookFallback: false,
    });

    this.scopedQueues.delete(key);
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
