/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import * as path from "node:path";
import type { App } from "@slack/bolt";
import type { HomeView, KnownBlock } from "@slack/types";
import { verifyEnrolledCheckout } from "../adapters/git/project-id.js";
import type { EnrolledProject } from "../domain/project-registry.js";
import { generatePulseReport } from "../engine/pulse.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { GwrkConfig } from "../utils/config.js";
import type { DispatchQueue } from "./dispatch.js";
import type { LifecycleMonitor } from "./lifecycle.js";
import type { SystemMonitor } from "./monitor.js";
import type { NetworkMonitor } from "./network.js";
import { getStatusData } from "./routes/status.js";
import type { SandboxManager } from "./sandbox.js";
import { resolveSlackCheckout } from "./slack-commands.js";
import type { DispatchRecord, SandboxInfo, SystemStatus } from "./types.js";

function canonicalCheckout(checkout: string): string | undefined {
  try {
    return fs.realpathSync(checkout);
  } catch {
    return undefined;
  }
}

function generateHomePulseReport(
  config: GwrkConfig,
  projects: readonly EnrolledProject[],
) {
  const visiblePaths = new Set<string>();
  const specRoots = new Set<string>();
  for (const project of projects) {
    const local = verifyEnrolledCheckout(project, "localRoot");
    const mirror = verifyEnrolledCheckout(project, "mirrorPath");
    if (local) visiblePaths.add(local);
    if (mirror) visiblePaths.add(mirror);
    const specRoot = local ?? mirror;
    if (specRoot) specRoots.add(specRoot);
  }

  const repos = new Set<string>();
  for (const repo of config.pulse?.repos ?? []) {
    const checkout = canonicalCheckout(repo);
    if (checkout && visiblePaths.has(checkout)) repos.add(checkout);
  }

  return generatePulseReport(
    { ...config, pulse: { ...config.pulse, repos: [...repos] } },
    { specRoots: [...specRoots] },
  );
}

export async function buildHomeTab(
  status: SystemStatus,
  config: GwrkConfig,
  projectRoot: string,
  options?: {
    userId?: string;
    workspaceId?: string;
    registry?: ProjectRegistryPort;
    queueProjectId?: string | null;
    selectedProjectId?: string | null;
  },
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

  const registry = options?.registry;
  const projects = registry?.listProjects() ?? [];
  const visibleProjects =
    registry && options.userId && options.workspaceId
      ? projects.filter((project) => {
          if (project.slack?.workspaceId !== options.workspaceId) {
            return false;
          }
          const roles = registry.listRoleBindings(project.projectId);
          const targetPrincipal = `${options.workspaceId}:${options.userId}`;
          return roles.some(
            (r) =>
              r.principalType === "slack_user" &&
              r.principalId === targetPrincipal,
          );
        })
      : [];

  const startupProjects =
    visibleProjects.length > 0
      ? projects.filter(
          (project) => resolveSlackCheckout(project, projectRoot) !== undefined,
        )
      : [];
  const startupProject =
    startupProjects.length === 1 &&
    startupProjects[0].projectId === options?.queueProjectId &&
    visibleProjects.includes(startupProjects[0])
      ? startupProjects[0]
      : undefined;

  const requestedProject = options?.selectedProjectId
    ? visibleProjects.find(
        (project) =>
          project.projectId === options.selectedProjectId ||
          project.slug === options.selectedProjectId,
      )
    : undefined;
  const requestedProjectVerified =
    requestedProject !== undefined &&
    (requestedProject.projectId === options?.queueProjectId
      ? resolveSlackCheckout(requestedProject, projectRoot) !== undefined
      : resolveSlackCheckout(requestedProject) !== undefined) &&
    (status.projectId === requestedProject.projectId ||
      requestedProject.projectId === startupProject?.projectId);
  const activeProject = requestedProjectVerified
    ? requestedProject
    : options?.selectedProjectId !== undefined
      ? undefined
      : startupProject;

  if (activeProject) {
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
        {
          type: "mrkdwn",
          text: `*Queue Depth:* ${status.dispatch.queueDepth}`,
        },
        { type: "mrkdwn", text: `*Active:* ${status.dispatch.activeCount}` },
        {
          type: "mrkdwn",
          text: `*Completed:* ${status.dispatch.completedCount}`,
        },
        { type: "mrkdwn", text: `*Failed:* ${status.dispatch.failedCount}` },
      ],
    });
  }

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

  if (activeProject) {
    // 4. Build Plan (from Plan DAG)
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "📐 *Plan DAG Status*" },
    });

    try {
      const { PlanStore } = await import("../engine/plan-store.js");
      const store = new PlanStore(activeProject.projectId);
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
  }

  if (visibleProjects.length > 0) {
    // 5. Pulse Summary
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "📉 *Pulse Summary*" },
    });

    try {
      const report = generateHomePulseReport(config, visibleProjects);
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
  }

  // 6. Enrolled Projects visible to user
  if (options?.registry) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "📁 *Enrolled Projects*" },
    });

    if (visibleProjects.length === 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "_No enrolled projects accessible for your account._",
        },
      });
    } else {
      for (const p of visibleProjects) {
        const isSelected = activeProject?.projectId === p.projectId;
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${p.name}* (\`${p.slug}\`)${isSelected ? " · *Selected*" : ""}\nTrunk: \`${p.trunkBranch}\` · Channel: <#${p.slack?.channelId || "unbound"}>`,
          },
          accessory: {
            type: "button",
            text: {
              type: "plain_text",
              text: isSelected ? "Selected" : "Select",
            },
            action_id: "select_home_project",
            value: JSON.stringify({
              projectId: p.projectId,
              projectSlug: p.slug,
            }),
          },
        });
      }
    }
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
    registry?: ProjectRegistryPort;
    queueProjectId?: string | null;
    workspaceId?: string;
  },
) {
  const startupProjects =
    deps.registry
      ?.listProjects()
      .filter(
        (project) =>
          resolveSlackCheckout(project, deps.projectRoot) !== undefined,
      ) ?? [];
  const queueProjectId =
    startupProjects.length === 1 &&
    (deps.queueProjectId === undefined ||
      deps.queueProjectId === startupProjects[0].projectId)
      ? startupProjects[0].projectId
      : undefined;
  const selectedProjectByUser = new Map<string, string>();

  function resolveAuthorizedProject(
    workspaceId: string | undefined,
    userId: string | undefined,
    requestedProjectId: string | undefined,
  ): EnrolledProject | undefined {
    if (!deps.registry || !workspaceId || !userId || !requestedProjectId) {
      return undefined;
    }
    const targetPrincipal = `${workspaceId}:${userId}`;
    const candidate = deps.registry
      .listProjects()
      .find(
        (project) =>
          project.slack?.workspaceId === workspaceId &&
          (project.projectId === requestedProjectId ||
            project.slug === requestedProjectId) &&
          deps.registry
            ?.listRoleBindings(project.projectId)
            .some(
              (r) =>
                r.principalType === "slack_user" &&
                r.principalId === targetPrincipal,
            ),
      );
    if (!candidate) return undefined;
    const checkout =
      candidate.projectId === queueProjectId
        ? resolveSlackCheckout(candidate, deps.projectRoot)
        : resolveSlackCheckout(candidate);
    return checkout ? candidate : undefined;
  }

  async function loadHomeStatus(
    selected?: EnrolledProject,
  ): Promise<SystemStatus> {
    if (selected) {
      const projectRoots = [
        verifyEnrolledCheckout(selected, "localRoot"),
        verifyEnrolledCheckout(selected, "mirrorPath"),
      ].filter((root): root is string => Boolean(root));
      const scoped = await getStatusData(
        deps.monitor,
        deps.queue,
        deps.sandbox,
        deps.lifecycle,
        deps.network,
        undefined,
        {
          projectId: selected.projectId,
          projectRoots,
        },
      );
      return {
        ...scoped,
        projectId: scoped.projectId ?? selected.projectId,
      };
    }
    return getStatusData(
      deps.monitor,
      deps.queue,
      deps.sandbox,
      deps.lifecycle,
      deps.network,
    );
  }

  slackApp.event(
    "app_home_opened",
    async ({ event, body, context, client, logger }) => {
      try {
        const workspaceId =
          body?.team_id ??
          context?.teamId ??
          (event.view as { team_id?: string } | undefined)?.team_id ??
          deps.workspaceId;
        const userKey =
          workspaceId && event.user
            ? `${workspaceId}:${event.user}`
            : undefined;
        const hasStoredSelection =
          userKey !== undefined && selectedProjectByUser.has(userKey);
        const storedSelection =
          hasStoredSelection && userKey
            ? selectedProjectByUser.get(userKey)
            : undefined;
        const selected = hasStoredSelection
          ? resolveAuthorizedProject(workspaceId, event.user, storedSelection)
          : resolveAuthorizedProject(workspaceId, event.user, queueProjectId);
        const status = await loadHomeStatus(selected);

        const homeView = await buildHomeTab(
          status,
          deps.config,
          deps.projectRoot,
          {
            userId: event.user,
            workspaceId,
            registry: deps.registry,
            queueProjectId,
            selectedProjectId: selected ? selected.projectId : null,
          },
        );

        await client.views.publish({
          user_id: event.user,
          view: homeView,
        });
      } catch (error) {
        logger.error("Error publishing home tab: ", error);
      }
    },
  );

  if (typeof slackApp.action === "function") {
    slackApp.action(
      "select_home_project",
      // biome-ignore lint/suspicious/noExplicitAny: Slack action payload structure
      async ({ ack, body, context, client, logger }: any) => {
        await ack();
        try {
          const userId: string | undefined = body?.user?.id;
          const workspaceId: string | undefined =
            body?.team?.id ??
            body?.team_id ??
            context?.teamId ??
            deps.workspaceId;
          const userKey =
            workspaceId && userId ? `${workspaceId}:${userId}` : undefined;
          const rawValue: string | undefined = body?.actions?.[0]?.value;
          let requestedId: string | undefined;
          if (rawValue) {
            try {
              const parsed = JSON.parse(rawValue) as {
                projectId?: string;
                projectSlug?: string;
              };
              requestedId = parsed.projectId ?? parsed.projectSlug;
            } catch {
              requestedId = rawValue;
            }
          }
          const selected = resolveAuthorizedProject(
            workspaceId,
            userId,
            requestedId,
          );
          if (selected && userKey) {
            selectedProjectByUser.set(userKey, selected.projectId);
          }
          const activeSelection =
            selected ??
            resolveAuthorizedProject(
              workspaceId,
              userId,
              userKey ? selectedProjectByUser.get(userKey) : undefined,
            );
          const status = await loadHomeStatus(activeSelection);
          const homeView = await buildHomeTab(
            status,
            deps.config,
            deps.projectRoot,
            {
              userId,
              workspaceId,
              registry: deps.registry,
              queueProjectId,
              selectedProjectId: activeSelection
                ? activeSelection.projectId
                : null,
            },
          );
          if (userId) {
            await client.views.publish({
              user_id: userId,
              view: homeView,
            });
          }
        } catch (error) {
          logger?.error?.("Error updating selected home project: ", error);
        }
      },
    );
  }
}
