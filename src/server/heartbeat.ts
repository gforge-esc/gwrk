/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { App } from "@slack/bolt";
import type { PlanPhase } from "../db/plan.js";
import { DriftDetector, type DriftResult } from "../engine/drift-detector.js";
import { PlanStore } from "../engine/plan-store.js";
import type { GwrkConfig } from "../utils/config.js";
import { resolveProjectId } from "../utils/project-id.js";

export class PlanHeartbeat {
  private interval: NodeJS.Timeout | null = null;
  private store: PlanStore;
  private projectId: string;

  constructor(
    private config: GwrkConfig,
    private slackApp: App | null,
    private projectRoot: string = process.cwd(),
  ) {
    this.projectId = resolveProjectId(this.projectRoot);
    this.store = new PlanStore(this.projectId);
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
    if (this.store.isEmpty()) return;

    const status = this.store.getPlanStatus();
    const phases = status.features.flatMap((f) => f.phases);

    // 1. Detect Staleness
    const stalePhases = phases.filter((p) => {
      if (p.status !== "IN_PROGRESS") return false;
      if (!p.updated_at) return false;

      const lastUpdate = new Date(p.updated_at).getTime();
      const now = Date.now();
      const daysSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60 * 24);
      return daysSinceUpdate > 14; // Stale if no change in 14 days
    });

    // 2. Detect Drift
    const detector = new DriftDetector({
      features: status.features,
      phases: phases,
    });
    const driftResults = detector.verify(this.projectRoot);
    const drifted = driftResults.filter((r) => r.status === "DRIFTED");

    // 3. Detect Blocked
    const solver = await this.store.getSolver();
    const ready = solver.getReadyQueue();
    // (Simplified blocked detection: if no items are ready but project is not done)
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
        this.store.updatePhase(p.id, {
          health: targetHealth as "GREEN" | "YELLOW" | "RED",
        });
      }
    }

    // 5. Report to Slack
    if (
      this.slackApp &&
      (stalePhases.length > 0 || drifted.length > 0 || isBlocked)
    ) {
      await this.reportToSlack(stalePhases, drifted, isBlocked);
    }
  }

  private async reportToSlack(
    stale: PlanPhase[],
    drifted: DriftResult[],
    isBlocked: boolean,
  ) {
    const channelId = this.config.project.slack?.channelId;
    if (!channelId) {
      console.error(
        "Heartbeat: no slack.channelId configured — skipping Slack report",
      );
      return;
    }

    let text = "*🚨 Build Plan Health Report*\n";
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

    try {
      await this.slackApp?.client.chat.postMessage({
        channel: channelId,
        text,
      });
    } catch (err) {
      console.error("Failed to post heartbeat to Slack:", err);
    }
  }
}
