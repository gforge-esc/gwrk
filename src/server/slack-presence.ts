/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { App } from "@slack/bolt";
import {
  logCliError,
  logCliOutput,
  warnCli,
} from "../adapters/cli/output-scope.js";
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
}

interface PendingNotification {
  event: SlackEvent;
  projectRoot: string;
  signal?: AbortSignal;
  transportTimeoutMs?: number;
  detachAbort?: () => void;
  finish?: () => void;
}

class PresenceManager {
  private static instance: PresenceManager;
  private queuedEvents: PendingNotification[] = [];
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
      // Find the PE user ID. For now, we take the first non-bot admin, or just the first non-bot user.
      const users = await app.client.users.list({});
      const human = users.members?.find(
        (m) => !m.is_bot && m.id !== "USLACKBOT",
      );
      if (human?.id) {
        this.userId = human.id;
        logCliOutput(
          `Presence polling started for user: ${human.name} (${this.userId})`,
        );
      } else {
        warnCli(
          "Could not find a human user for presence detection. Falling back to immediate delivery.",
        );
        return;
      }

      const interval = config?.server?.slack?.presencePollIntervalMs || 60000;

      // Initial check
      await this.checkPresence(app);

      this.pollerInterval = setInterval(() => {
        this.checkPresence(app).catch((err) => {
          logCliError("Error checking Slack presence:", err);
        });
      }, interval);
    } catch (error) {
      warnCli("Presence detection initialization failed:", error);
    }
  }

  private async checkPresence(app: App): Promise<void> {
    if (!this.userId) return;

    try {
      const result = await app.client.users.getPresence({ user: this.userId });
      if (result.ok) {
        const previousPresence = this.currentPresence;
        this.currentPresence = result.presence === "active" ? "active" : "away";
        if (this.currentPresence === "active" && previousPresence === "away") {
          await this.flushQueue();
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      warnCli(`Presence API unavailable: ${errorMessage}`);
    }
  }

  public async handleNotification(
    event: SlackEvent,
    message: SlackMessage,
    signal?: AbortSignal,
    projectRoot = process.cwd(),
    forwardToTelegram?: () => Promise<void>,
    transportTimeoutMs?: number,
  ): Promise<void> {
    if (signal?.aborted) return;
    if (this.currentPresence === "active") {
      if (signal) {
        const { sendSlackMessage } = await import("./slack-notify.js");
        await sendSlackMessage(
          message,
          signal,
          projectRoot,
          transportTimeoutMs,
        );
      } else {
        await this.sendImmediately(message, projectRoot);
      }
      await forwardToTelegram?.();
      return;
    }

    logCliOutput(
      `User away. Queuing event: ${event.type} for ${event.feature}`,
    );
    const pending: PendingNotification = {
      event,
      projectRoot,
      signal,
      transportTimeoutMs,
    };
    this.queuedEvents.push(pending);
    if (!signal) {
      await forwardToTelegram?.();
      return;
    }

    const delivery = new Promise<void>((resolve) => {
      const onAbort = () => {
        this.queuedEvents = this.queuedEvents.filter(
          (item) => item !== pending,
        );
        resolve();
      };
      pending.finish = resolve;
      pending.detachAbort = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    await Promise.all([delivery, forwardToTelegram?.()]);
  }

  private async sendImmediately(
    message: SlackMessage,
    projectRoot: string,
  ): Promise<void> {
    // Avoid circular dependency by dynamically importing notifySlack
    const { notifySlack } = await import("./slack-notify.js");
    await notifySlack(message, undefined, { projectRoot });
  }

  private async flushQueue(): Promise<void> {
    if (this.queuedEvents.length === 0) return;

    const { sendSlackMessage } = await import("./slack-notify.js");
    const projects = new Map<
      string,
      Map<AbortSignal | undefined, PendingNotification[]>
    >();
    for (const pending of this.queuedEvents.splice(0)) {
      pending.detachAbort?.();
      if (pending.signal?.aborted) {
        pending.finish?.();
        continue;
      }
      const owners = projects.get(pending.projectRoot) ?? new Map();
      const group = owners.get(pending.signal) ?? [];
      group.push(pending);
      owners.set(pending.signal, group);
      projects.set(pending.projectRoot, owners);
    }
    const sendGroup = async (
      projectRoot: string,
      signal: AbortSignal | undefined,
      group: PendingNotification[],
    ) => {
      const summary = MessageBuilder.batchedSummary(
        group.map(({ event }) => event),
      );
      try {
        const deadlines = group.flatMap(({ transportTimeoutMs }) =>
          transportTimeoutMs === undefined ? [] : [transportTimeoutMs],
        );
        await sendSlackMessage(
          summary,
          signal,
          projectRoot,
          deadlines.length ? Math.min(...deadlines) : undefined,
        );
      } finally {
        for (const pending of group) pending.finish?.();
      }
    };
    await Promise.all(
      Array.from(projects).flatMap(([projectRoot, owners]) =>
        Array.from(owners, ([signal, group]) =>
          sendGroup(projectRoot, signal, group),
        ),
      ),
    );
  }

  public stop(): void {
    if (this.pollerInterval) {
      clearInterval(this.pollerInterval);
      this.pollerInterval = null;
    }
  }
}

export const presenceManager = PresenceManager.getInstance();
