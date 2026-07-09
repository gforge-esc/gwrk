/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import * as path from "node:path";
import type { App } from "@slack/bolt";
import type { HomeView, KnownBlock } from "@slack/types";
import { generatePulseReport } from "../engine/pulse.js";
import { resolveProjectId } from "../utils/project-id.js";
import type { GwrkConfig } from "../utils/config.js";
import type { DispatchQueue } from "./dispatch.js";
import type { LifecycleMonitor } from "./lifecycle.js";
import type { SystemMonitor } from "./monitor.js";
import type { NetworkMonitor } from "./network.js";
import { getStatusData } from "./routes/status.js";
import type { SandboxManager } from "./sandbox.js";
import type { DispatchRecord, SandboxInfo, SystemStatus } from "./types.js";

export async function buildHomeTab(
  status: SystemStatus,
  config: GwrkConfig,
  projectRoot: string,
): Promise<HomeView> {
  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🏗️ gwrk Operations Dashboard",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Server Status:* ${status.server.status === "running" ? "🟢 Online" : "🔴 Offline"} (${status.server.lifecycle})\n*Uptime:* ${formatUptime(status.server.uptime || 0)} | *Network:* ${status.network.status === "online" ? "🌐 Online" : "⚠️ Offline"}`,
      },
    },
    { type: "divider" },
  ];

  // 1. Active Agents (Sandboxes)
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "👷 *Active Agents*" },
  });

  if (status.sandboxes.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No active agents._" },
    });
  } else {
    for (const sb of status.sandboxes.slice(0, 5)) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `• *${sb.featureId}* (${sb.phaseId}) - \`${sb.backend}\` [${sb.status}]\n  Task: \`${sb.taskId}\``,
        },
      });
    }
    if (status.sandboxes.length > 5) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `_...and ${status.sandboxes.length - 5} more agents active._`,
        },
      });
    }
  }

  // 2. Dispatch Queue
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "📥 *Dispatch Queue*" },
  });
  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*Queue Depth:* ${status.dispatch.queueDepth}` },
      { type: "mrkdwn", text: `*Active:* ${status.dispatch.activeCount}` },
      {
        type: "mrkdwn",
        text: `*Completed:* ${status.dispatch.completedCount}`,
      },
      { type: "mrkdwn", text: `*Failed:* ${status.dispatch.failedCount}` },
    ],
  });

  // 3. System Resources
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "📊 *System Resources*" },
  });
  blocks.push({
    type: "section",
    fields: [
      {
        type: "mrkdwn",
        text: `*CPU:* ${status.system.cpuPercent.toFixed(1)}%`,
      },
      {
        type: "mrkdwn",
        text: `*Memory:* ${status.system.memPercent.toFixed(1)}%`,
      },
      {
        type: "mrkdwn",
        text: `*Disk Free:* ${status.system.diskFreeGb.toFixed(1)} GB`,
      },
    ],
  });

  // 4. Build Plan (from Plan DAG)
  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "📐 *Plan DAG Status*" },
  });

  try {
    const { PlanStore } = await import("../engine/plan-store.js");
    const projectId = resolveProjectId(projectRoot);
    const store = new PlanStore(projectId);
    if (!store.isEmpty()) {
      const planStatus = store.getPlanStatus();

      const statusEmoji: Record<string, string> = {
        SHIPPED: "✅",
        IN_PROGRESS: "🔄",
        DEFINED: "📐",
        READY: "🟢",
        BLOCKED: "🔴",
        PLANNED: "⬜",
      };

      for (const f of planStatus.features.slice(0, 10)) {
        const emoji = statusEmoji[f.status] || "⬜";
        const phaseCount = f.phases?.length || 0;
        const shippedCount =
          f.phases?.filter((p) => p.status === "SHIPPED").length || 0;
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${emoji} *${f.id}* — ${f.status} (${shippedCount}/${phaseCount} shipped)`,
          },
        });
      }
    } else {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "_No active plans._",
        },
      });
    }
  } catch {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_Plan data unavailable._" },
    });
  }

  // 5. Pulse Summary
  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "📉 *Pulse Summary*" },
  });

  try {
    const report = generatePulseReport(config);
    for (const repo of report.repositories.slice(0, 3)) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${repo.repoName}*: ${repo.mainLoc} LOC (+${repo.draftLoc} draft)`,
        },
      });
    }
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Spec Progress: ${report.specProgress.totalPlans}/${report.specProgress.totalSpecs} plans ready`,
        },
      ],
    });
  } catch (err) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_Pulse data unavailable._" },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Last updated: ${new Date().toLocaleString()}`,
      },
    ],
  });

  return {
    type: "home",
    blocks,
  };
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

async function getFeatureProgress(
  projectRoot: string,
): Promise<DispatchRecord[]> {
  const dispatchesFile = path.join(projectRoot, ".gwrk", "dispatches.jsonl");
  if (!fs.existsSync(dispatchesFile)) return [];

  try {
    const content = fs.readFileSync(dispatchesFile, "utf-8");
    const lines = content.trim().split("\n");
    const latestByFeature = new Map<string, DispatchRecord>();

    for (const line of lines) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as DispatchRecord;
      latestByFeature.set(record.featureId, record);
    }

    return Array.from(latestByFeature.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  } catch (err) {
    return [];
  }
}

export async function registerSlackHomeHandler(
  slackApp: App,
  deps: {
    monitor: SystemMonitor;
    queue: DispatchQueue;
    sandbox: SandboxManager;
    lifecycle: LifecycleMonitor;
    network: NetworkMonitor;
    config: GwrkConfig;
    projectRoot: string;
  },
) {
  slackApp.event("app_home_opened", async ({ event, client, logger }) => {
    try {
      const status = await getStatusData(
        deps.monitor,
        deps.queue,
        deps.sandbox,
        deps.lifecycle,
        deps.network,
      );

      const homeView = await buildHomeTab(
        status,
        deps.config,
        deps.projectRoot,
      );

      await client.views.publish({
        user_id: event.user,
        view: homeView,
      });
    } catch (error) {
      logger.error("Error publishing home tab: ", error);
    }
  });
}
