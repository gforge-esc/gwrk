/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { App } from "@slack/bolt";
import { logCliError } from "../adapters/cli/output-scope.js";
import { verifyEnrolledCheckout } from "../adapters/git/project-id.js";
import type { PlanPhase } from "../db/plan.js";
import type {
  DeliveryRecipient,
  EnrolledProject,
} from "../domain/project-registry.js";
import { DriftDetector, type DriftResult } from "../engine/drift-detector.js";
import { PlanStore } from "../engine/plan-store.js";
import type { NotificationPort } from "../ports/notification-port.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { GwrkConfig } from "../utils/config.js";
import { resolveProjectId } from "../utils/project-id.js";
import { notifySlack } from "./slack-notify.js";

export interface PlanHeartbeatOptions {
  registry?: ProjectRegistryPort;
  notifier?: NotificationPort;
  createPlanStore?: (projectId: string) => PlanStore;
}

function resolveProjectCheckout(project: EnrolledProject): string | null {
  return (
    verifyEnrolledCheckout(project, "mirrorPath") ??
    verifyEnrolledCheckout(project, "localRoot") ??
    null
  );
}

export class PlanHeartbeat {
  private interval: NodeJS.Timeout | null = null;
  private store: PlanStore | null = null;
  private projectId: string;

  constructor(
    private config: GwrkConfig,
    private slackApp: App | null,
    private projectRoot: string = process.cwd(),
    private options: PlanHeartbeatOptions = {},
  ) {
    this.projectId = resolveProjectId(this.projectRoot);
    if (!this.options.registry) {
      this.store = this.options.createPlanStore
        ? this.options.createPlanStore(this.projectId)
        : new PlanStore(this.projectId);
    }
  }

  start() {
    const intervalMs = 4 * 60 * 60 * 1000; // 4 hours default
    this.interval = setInterval(() => this.runCheck(), intervalMs);
    // Also run once on start
    this.runCheck().catch(console.error);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async runCheck() {
    if (this.options.registry) {
      for (const project of this.options.registry.listProjects()) {
        const checkout = resolveProjectCheckout(project);
        if (!checkout) continue;
        try {
          const store = this.options.createPlanStore
            ? this.options.createPlanStore(project.projectId)
            : new PlanStore(project.projectId);
          await this.evaluateProject(
            project.projectId,
            checkout,
            store,
            project,
          );
        } catch (err) {
          logCliError(
            `Heartbeat: Failed to evaluate project ${project.slug} (${project.projectId}):`,
            err,
          );
        }
      }
      return;
    }

    if (this.store) {
      await this.evaluateProject(this.projectId, this.projectRoot, this.store);
    }
  }

  private async evaluateProject(
    projectId: string,
    projectRoot: string,
    store: PlanStore,
    project?: EnrolledProject,
  ) {
    if (store.isEmpty()) return;

    const status = store.getPlanStatus();
    const phases = status.features.flatMap((f) => f.phases);

    // 1. Detect Staleness
    const stalePhases = phases.filter((p) => {
      if (p.status !== "IN_PROGRESS") return false;
      if (!p.updated_at) return false;

      const lastUpdate = new Date(p.updated_at).getTime();
      const now = Date.now();
      const daysSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60 * 24);
      return daysSinceUpdate > 14;
    });

    // 2. Detect Drift
    const detector = new DriftDetector({
      features: status.features,
      phases: phases,
    });
    const driftResults = detector.verify(projectRoot);
    const drifted = driftResults.filter((r) => r.status === "DRIFTED");

    // 3. Detect Blocked
    const solver = await store.getSolver();
    const ready = solver.getReadyQueue();
    const isProjectDone = phases.every(
      (p) => p.status === "DONE" || p.status === "SHIPPED",
    );
    const isBlocked = ready.length === 0 && !isProjectDone;

    // 4. Update Health in DB with recovery logic
    for (const p of phases) {
      const isStale = stalePhases.some((sp) => sp.id === p.id);
      const isDrifted = drifted.some((d) => d.phaseId === p.id);

      let targetHealth = "GREEN";
      if (isDrifted) targetHealth = "RED";
      else if (isStale) targetHealth = "YELLOW";

      if (p.health !== targetHealth) {
        store.updatePhase(p.id, {
          health: targetHealth as "GREEN" | "YELLOW" | "RED",
        });
      }
    }

    // 5. Report to Slack
    if (stalePhases.length > 0 || drifted.length > 0 || isBlocked) {
      await this.reportToSlack(
        projectId,
        stalePhases,
        drifted,
        isBlocked,
        project,
      );
    }
  }

  private formatAlertText(
    stale: PlanPhase[],
    drifted: DriftResult[],
    isBlocked: boolean,
    project?: EnrolledProject,
  ): string {
    const header = project
      ? `*🚨 Build Plan Health Report (${project.slug})*\n`
      : "*🚨 Build Plan Health Report*\n";
    let text = header;
    if (drifted.length > 0) {
      text += `\n*Drift Detected (${drifted.length}):*\n`;
      for (const d of drifted) {
        text += `• ${d.featureId || "unknown"}${d.phaseId ? `/${d.phaseId}` : ""}: ${d.reason}\n`;
      }
    }
    if (stale.length > 0) {
      text += `\n*Stale Items (${stale.length}):*\n`;
      for (const s of stale) {
        text += `• ${s.id}: No activity for 14+ days\n`;
      }
    }
    if (isBlocked) {
      text +=
        "\n*⚠️ Project Blocked:* No items are currently ready to work on, but the project is incomplete.\n";
    }
    return text;
  }

  private async reportToSlack(
    projectId: string,
    stale: PlanPhase[],
    drifted: DriftResult[],
    isBlocked: boolean,
    project?: EnrolledProject,
  ) {
    const text = this.formatAlertText(stale, drifted, isBlocked, project);

    if (project) {
      const opsChannelId = project.slack?.opsChannelId;
      if (!opsChannelId) {
        return;
      }

      const recipient: DeliveryRecipient = {
        projectId: project.projectId,
        surface: "slack",
        workspaceId: project.slack?.workspaceId,
        channelId: opsChannelId,
        opsOnly: true,
      };

      try {
        if (this.options.notifier) {
          await this.options.notifier.notify({
            projectId: project.projectId,
            recipient,
            channel: opsChannelId,
            opsOnly: true,
            text,
          });
        } else {
          await notifySlack(
            {
              channel: opsChannelId,
              text,
              blocks: [],
            },
            undefined,
            {
              projectId: project.projectId,
              opsOnly: true,
              recipient,
              registry: this.options.registry,
            },
          );
        }
      } catch (err) {
        logCliError("Failed to post heartbeat to Slack:", err);
      }
      return;
    }

    // Legacy single-project fallback when no ProjectRegistryPort is provided
    if (this.options.notifier) {
      const opsChannelId = this.config.project.slack?.opsChannelId;
      if (!opsChannelId) return;
      try {
        await this.options.notifier.notify({
          projectId,
          channel: opsChannelId,
          opsOnly: true,
          text,
        });
      } catch (err) {
        logCliError("Failed to post heartbeat to Slack:", err);
      }
      return;
    }

    if (!this.slackApp) return;

    const channelId = this.config.project.slack?.opsChannelId;
    if (!channelId) {
      logCliError(
        "Heartbeat: no slack.opsChannelId configured — skipping Slack report",
      );
      return;
    }

    try {
      await this.slackApp.client.chat.postMessage({
        channel: channelId,
        text,
      });
    } catch (err) {
      logCliError("Failed to post heartbeat to Slack:", err);
    }
  }
}
