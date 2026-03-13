import type { App } from "@slack/bolt";
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
    | "done_done";
  feature: string;
  phase?: string;
  opsOnly?: boolean;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface BatchedNotification {
  projectId: string;
  events: SlackEvent[];
  batchedSince: string;
}

class PresenceManager {
  private static instance: PresenceManager;
  private queuedEvents: SlackEvent[] = [];
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
        console.log(
          `Presence polling started for user: ${human.name} (${this.userId})`,
        );
      } else {
        console.warn(
          "Could not find a human user for presence detection. Falling back to immediate delivery.",
        );
        return;
      }

      const interval = config?.server?.slack?.presencePollIntervalMs || 60000;

      // Initial check
      await this.checkPresence(app);

      this.pollerInterval = setInterval(() => {
        this.checkPresence(app).catch((err) => {
          console.error("Error checking Slack presence:", err);
        });
      }, interval);
    } catch (error) {
      console.warn("Presence detection initialization failed:", error);
    }
  }

  private async checkPresence(app: App): Promise<void> {
    if (!this.userId) return;

    try {
      const result = await app.client.users.getPresence({ user: this.userId });
      if (result.ok) {
        const newPresence = result.presence === "active" ? "active" : "away";

        if (newPresence === "active" && this.currentPresence === "away") {
          await this.flushQueue();
        }

        this.currentPresence = newPresence;
      }
    } catch (error) {
      console.warn(`Presence API unavailable: ${(error as any).message}`);
    }
  }

  public async handleNotification(
    event: SlackEvent,
    message: SlackMessage,
  ): Promise<void> {
    if (this.currentPresence === "active") {
      await this.sendImmediately(message);
    } else {
      console.log(
        `User away. Queuing event: ${event.type} for ${event.feature}`,
      );
      this.queuedEvents.push(event);
    }
  }

  private async sendImmediately(message: SlackMessage): Promise<void> {
    // Avoid circular dependency by dynamically importing notifySlack
    const { notifySlack } = await import("./slack-notify.js");
    await notifySlack(message); // Call without event to send immediately
  }

  private async flushQueue(): Promise<void> {
    if (this.queuedEvents.length === 0) return;

    console.log(`User returned. Flushing ${this.queuedEvents.length} events.`);

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

  public stop(): void {
    if (this.pollerInterval) {
      clearInterval(this.pollerInterval);
      this.pollerInterval = null;
    }
  }
}

export const presenceManager = PresenceManager.getInstance();
