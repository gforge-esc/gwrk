/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { KnownBlock } from "@slack/types";
import {
  scopedFeatureDirectory,
  scopedFeaturePath,
  scopedSpecsDirectory,
} from "../adapters/filesystem/scoped-feature.js";
import { verifyEnrolledCheckout } from "../adapters/git/project-id.js";
import type { ProjectRoutingService } from "../application/project-routing/index.js";
import { findOpenPr } from "../db/runs.js";
import { normalizeGitRemoteSlug } from "../domain/project-id.js";
import type {
  DeliveryRecipient,
  EnrolledProject,
} from "../domain/project-registry.js";
import { resolveProjectSlackRecipient } from "../domain/slack-delivery.js";
import {
  parseProjectSelector,
  requiredAccessForSlackCommand,
} from "../domain/slack-routing.js";
import type { VcsProjectPort } from "../ports/vcs-port.js";
import { resolveProjectId } from "../utils/project-id.js";
import {
  type DeferDispatchDrain,
  DispatchIntakeError,
  type DispatchQueue,
} from "./dispatch.js";
import type { GitManager } from "./git-manager.js";
import type { SystemMonitor } from "./monitor.js";
import { launchDetachedGwrk } from "./slack-launch.js";
import type { DispatchRecord } from "./types.js";

interface SlackBlockKit {
  blocks: KnownBlock[];
  response_type: "ephemeral" | "in_channel";
  thread_ts?: string;
}

export interface CommandContext {
  userId: string;
  channelId: string;
  projectRoot: string;
  verifiedCheckoutRoot?: string;
  buildServerUrl: string;
  queue: DispatchQueue;
  deferDispatchDrain?: DeferDispatchDrain;
  queueProjectId?: string;
  monitor: SystemMonitor;
  git: GitManager;
  workspaceId?: string;
  threadTs?: string;
  messageTs?: string;
  projectId?: string;
  projectSlug?: string;
  projectRepository?: string;
  enrolledProject?: EnrolledProject;
  recipient?: DeliveryRecipient;
  routingService?: ProjectRoutingService;
  vcs?: VcsProjectPort;
}

export function supportsMultiProjectDispatch(
  queue: Pick<DispatchQueue, "supportsMultiProjectDispatch"> | undefined,
): boolean {
  return queue?.supportsMultiProjectDispatch?.() === true;
}

function isSharedMultiProjectQueue(
  queue:
    | Pick<
        DispatchQueue,
        | "isSharedMultiProjectQueue"
        | "supportsMultiProjectDispatch"
        | "getRegistry"
      >
    | undefined,
): boolean {
  if (typeof queue?.isSharedMultiProjectQueue === "function") {
    return queue.isSharedMultiProjectQueue();
  }
  return (
    supportsMultiProjectDispatch(queue) &&
    (queue?.getRegistry?.()?.listProjects().length ?? 0) > 1
  );
}

function ephemeralWarning(text: string): SlackBlockKit {
  return {
    response_type: "ephemeral",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text,
        },
      },
    ],
  };
}

function resolveDispatchCommandRecipient(
  featureId: string,
  context: CommandContext,
):
  | { ok: true; recipient?: DeliveryRecipient }
  | { ok: false; response: SlackBlockKit } {
  if (!context.routingService) {
    return { ok: true, recipient: context.recipient };
  }
  if (!context.projectId) {
    return {
      ok: false,
      response: ephemeralWarning(
        ":warning: Authorized project identity is required before dispatching.",
      ),
    };
  }

  const isDirectMessage = Boolean(context.channelId?.startsWith("D"));
  const enrolled = context.enrolledProject;
  const enrolledProjects = context.queue?.getRegistry?.()?.listProjects();

  if (isDirectMessage) {
    const slackBinding = enrolled?.slack;
    if (
      !enrolled ||
      !slackBinding?.channelId ||
      !context.workspaceId ||
      slackBinding.workspaceId !== context.workspaceId
    ) {
      return {
        ok: false,
        response: ephemeralWarning(
          ":warning: This project has no bound Slack channel for dispatch notifications. Run the command in the project's bound Slack channel.",
        ),
      };
    }
    const storedThread = context.routingService.getFeatureThread(
      context.projectId,
      featureId,
    );
    const check = resolveProjectSlackRecipient({
      project: enrolled,
      enrolledProjects,
      storedThread,
      recipient: {
        projectId: context.projectId,
        surface: "slack",
        workspaceId: context.workspaceId,
        channelId: slackBinding.channelId,
        actorUserId: context.userId,
      },
    });
    if (!check.ok || !check.recipient) {
      return {
        ok: false,
        response: ephemeralWarning(
          `:warning: ${!check.ok ? check.message : "Could not resolve the project Slack channel."}`,
        ),
      };
    }
    return { ok: true, recipient: check.recipient };
  }

  if (
    !context.recipient ||
    context.recipient.projectId !== context.projectId ||
    !context.recipient.channelId
  ) {
    return {
      ok: false,
      response: ephemeralWarning(
        ":warning: Delivery recipient does not match the authorized project.",
      ),
    };
  }

  if (enrolled) {
    const storedThread = !context.recipient.opsOnly
      ? context.routingService.getFeatureThread(context.projectId, featureId)
      : null;
    const check = resolveProjectSlackRecipient({
      project: enrolled,
      enrolledProjects,
      storedThread,
      recipient: context.recipient,
      opsOnly: Boolean(context.recipient.opsOnly),
    });
    if (!check.ok) {
      return {
        ok: false,
        response: ephemeralWarning(`:warning: ${check.message}`),
      };
    }
    return { ok: true, recipient: check.recipient ?? context.recipient };
  }

  return { ok: true, recipient: context.recipient };
}

function submitCommandDispatch(
  featureId: string,
  phaseId: string,
  context: CommandContext,
):
  | {
      ok: true;
      operationId?: string;
      deduplicated?: boolean;
      status?: string;
      notificationChannelId?: string;
    }
  | { ok: false; response: SlackBlockKit } {
  const recipientResolution = resolveDispatchCommandRecipient(
    featureId,
    context,
  );
  if (!recipientResolution.ok) {
    return recipientResolution;
  }

  const hasMultiProjectQueue = supportsMultiProjectDispatch(context.queue);
  const isStartupQueueProject =
    !context.routingService ||
    (Boolean(context.projectId) &&
      context.projectId === context.queueProjectId);

  if (hasMultiProjectQueue) {
    try {
      const receipt = context.queue.accept(
        {
          projectId: context.projectId,
          featureId,
          phaseId,
          recipient: recipientResolution.recipient,
        },
        { deferDrain: context.deferDispatchDrain },
      );
      if (!receipt) {
        return {
          ok: false,
          response: ephemeralWarning(
            ":warning: The dispatch queue is unavailable for this project.",
          ),
        };
      }
      return {
        ok: true,
        operationId: receipt.operationId,
        deduplicated: receipt.deduplicated,
        status: receipt.status,
        notificationChannelId: recipientResolution.recipient?.channelId,
      };
    } catch (error) {
      if (error instanceof DispatchIntakeError) {
        return {
          ok: false,
          response: ephemeralWarning(`:warning: ${error.message}`),
        };
      }
      throw error;
    }
  }

  if (!isStartupQueueProject) {
    return {
      ok: false,
      response: ephemeralWarning(
        ":warning: The dispatch queue is unavailable for this project.",
      ),
    };
  }

  try {
    const record = context.queue.enqueue({ featureId, phaseId });
    return {
      ok: true,
      operationId: record?.operationId ?? record?.id,
      deduplicated: record?.deduplicated,
      status: record?.status,
      notificationChannelId: recipientResolution.recipient?.channelId,
    };
  } catch (error) {
    if (error instanceof DispatchIntakeError) {
      return {
        ok: false,
        response: ephemeralWarning(`:warning: ${error.message}`),
      };
    }
    throw error;
  }
}

export type SlashCommandHandler = (
  args: string[],
  context: CommandContext,
) => Promise<SlackBlockKit>;

const scopedFeatureUnavailable =
  "Feature is unavailable inside this project's checkout.";

function resolveScopedSlackFeature(
  projectRoot: string,
  featureInput: string,
): { featureId: string; directory: string } | undefined {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(featureInput)) return undefined;
  const specs = scopedSpecsDirectory(projectRoot);
  if (!specs) return undefined;

  const exact = scopedFeatureDirectory(projectRoot, featureInput);
  if (exact) return { featureId: featureInput, directory: exact };
  try {
    fs.lstatSync(path.join(specs, featureInput));
    return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
  }

  const prefix = /^\d+$/.test(featureInput) ? featureInput : `${featureInput}-`;
  try {
    let match: { featureId: string; directory: string } | undefined;
    for (const featureId of fs.readdirSync(specs)) {
      if (!featureId.startsWith(prefix)) continue;
      const directory = scopedFeatureDirectory(projectRoot, featureId);
      if (!directory) continue;
      if (match) return undefined;
      match = { featureId, directory };
    }
    return match;
  } catch {
    return undefined;
  }
}

const handlers: Record<string, SlashCommandHandler> = {
  status: async (args, context) => {
    const { listRuns } = await import("../db/runs.js");
    const featureId = args[0];
    const resources = context.monitor.getResources();
    const projectId =
      context.projectId ?? resolveProjectId(context.projectRoot);
    const hasMultiProjectQueue = supportsMultiProjectDispatch(context.queue);
    const ownsQueue =
      !context.routingService ||
      hasMultiProjectQueue ||
      context.queueProjectId === projectId;

    const blocks: KnownBlock[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*System Resources:* CPU ${resources.cpuPercent.toFixed(1)}%, MEM ${resources.memPercent.toFixed(1)}%${context.projectSlug ? `\n*Project:* \`${context.projectSlug}\`` : ""}`,
        },
      },
    ];

    if (featureId) {
      const checkout = context.routingService
        ? context.verifiedCheckoutRoot
        : context.projectRoot;
      const scopedFeatureEntry = checkout
        ? resolveScopedSlackFeature(checkout, featureId)
        : undefined;
      const lookupFeatureId = scopedFeatureEntry?.featureId ?? featureId;
      const scopedQueueProjectId = context.routingService
        ? projectId
        : undefined;

      // Check in-memory and durable queue first (live dispatches)
      let featureDispatch: DispatchRecord | null | undefined;
      if (ownsQueue) {
        if (typeof context.queue.getFeatureDispatch === "function") {
          featureDispatch = context.queue.getFeatureDispatch(
            lookupFeatureId,
            scopedQueueProjectId,
          );
        } else {
          const snapshot = scopedQueueProjectId
            ? context.queue.getQueue(scopedQueueProjectId)
            : context.queue.getQueue();
          featureDispatch =
            snapshot.active.find((r) => r.featureId === lookupFeatureId) ??
            snapshot.queued.find((r) => r.featureId === lookupFeatureId) ??
            context.queue.getDispatch(
              lookupFeatureId,
              "",
              undefined,
              scopedQueueProjectId,
            );
        }
      }
      if (featureDispatch) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Feature ${lookupFeatureId}:* ${featureDispatch.status} (${featureDispatch.phaseId})`,
          },
        });
      }

      // Always query SQLite for run history
      try {
        const runs = listRuns(lookupFeatureId, projectId);
        if (runs.length > 0) {
          const recent = runs.slice(0, 5);
          let text = `*Recent runs for ${lookupFeatureId}:*`;
          for (const r of recent) {
            const status =
              r.exit_code === 0 ? "✅" : r.exit_code === null ? "🔄" : "❌";
            const phase = r.phase_id || "—";
            const agent = r.agent_backend || "—";
            const dur = r.duration_s != null ? `${r.duration_s}s` : "running";
            const gate = r.gate_result ? ` [${r.gate_result}]` : "";
            text += `\n${status} ${phase} · ${agent} · ${dur}${gate}`;
          }
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text },
          });
        } else if (!featureDispatch) {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Feature ${lookupFeatureId}:* No dispatch runs found.`,
            },
          });
        }
      } catch {
        // DB not available — fall back to queue-only
      }

      // TODO: Task state should be queried from SQLite via harvest.
      // When harvest persists task completion to the execution ledger,
      // add a query here: SELECT phase, completed, total FROM task_state WHERE feature_id = ?

      // Also check for spec-local ship runs
      const scopedFeature = scopedFeatureEntry?.directory;
      const runsDir = scopedFeature
        ? scopedFeaturePath(scopedFeature, ".gwrk", "runs")
        : undefined;
      if (runsDir) {
        const files = fs
          .readdirSync(runsDir)
          .filter(
            (f) =>
              f.endsWith(".json") &&
              scopedFeaturePath(runsDir, f) !== undefined,
          )
          .sort()
          .reverse();
        if (files.length > 0) {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Ship runs on disk:* ${files.length} (latest: \`${files[0]}\`)`,
            },
          });
        }
      }
    } else {
      // No feature ID — show Plan DAG + active dispatches + pending PRs

      // 1. Plan DAG summary
      try {
        const { PlanStore } = await import("../engine/plan-store.js");
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

          let dagText = "*📊 Build Plan:*";
          for (const f of planStatus.features) {
            const emoji = statusEmoji[f.status] || "⬜";
            const phaseCount = f.phases?.length || 0;
            const shippedCount =
              f.phases?.filter((p) => p.status === "SHIPPED").length || 0;
            dagText += `\n${emoji} *${f.id}* — ${f.status} (${shippedCount}/${phaseCount} phases)`;
          }

          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: dagText },
          });
        }
      } catch {
        // Plan DB not initialized — skip
      }

      // 2. Pending PRs (awaiting bless)
      try {
        // Find features with PRs that haven't been merged
        const { getStats } = await import("../db/runs.js");
        const stats = getStats(projectId);
        if (stats.length > 0) {
          let statsText = "*📈 Run History:*";
          for (const s of stats.slice(0, 5)) {
            const rate =
              s.total_runs > 0
                ? Math.round((s.success_runs / s.total_runs) * 100)
                : 0;
            statsText += `\n• ${s.workflow || s.command}: ${s.total_runs} runs (${rate}% pass)`;
          }
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: statsText },
          });
        }
      } catch {
        // DB not available — skip
      }

      // 3. Active dispatches
      const activeDispatches = ownsQueue
        ? (hasMultiProjectQueue
            ? context.queue.getQueue(projectId)
            : context.queue.getQueue()
          ).active
        : [];
      if (activeDispatches.length > 0) {
        let text = `*🔧 Active Dispatches:* ${activeDispatches.length}`;
        for (const d of activeDispatches as DispatchRecord[]) {
          text += `\n• ${d.featureId} (${d.phaseId}): ${d.status}`;
        }
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text },
        });
      }
    }

    return {
      response_type: "ephemeral",
      blocks,
    };
  },

  dispatch: async (args, context) => {
    const featureId = args[0];
    const phaseArg = args[1];
    if (!featureId) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":warning: Feature ID is required. Usage: `/gwrk dispatch <featureId> [phase]`",
            },
          },
        ],
      };
    }

    const resolved = resolveScopedSlackFeature(
      context.projectRoot,
      featureId,
    )?.featureId;
    if (!resolved) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:warning: Error: ${scopedFeatureUnavailable}`,
            },
          },
        ],
      };
    }
    const phaseId = phaseArg
      ? phaseArg.startsWith("phase-")
        ? phaseArg
        : `phase-${phaseArg.padStart(2, "0")}`
      : "phase-01";

    const submission = submitCommandDispatch(resolved, phaseId, context);
    if (!submission.ok) {
      return submission.response;
    }

    const text = submission.deduplicated
      ? `🚀 Dispatch already active for *${resolved}* phase *${phaseId}* (operation \`${submission.operationId}\`, status: \`${submission.status}\`).`
      : `🚀 Dispatching feature *${resolved}* phase *${phaseId}*${submission.operationId ? ` (operation \`${submission.operationId}\`)` : ""}...`;

    return {
      response_type: "in_channel",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text,
          },
        },
      ],
    };
  },

  approve: async (args, context) => {
    const [featureArg, phaseArg] = args;
    if (!featureArg) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":warning: Feature ID required. Usage: `/gwrk approve <featureId> [phaseId]`",
            },
          },
        ],
      };
    }

    try {
      const resolved = resolveScopedSlackFeature(
        context.projectRoot,
        featureArg,
      )?.featureId;
      if (!resolved) throw new Error(scopedFeatureUnavailable);
      const phaseId = phaseArg
        ? phaseArg.startsWith("phase-")
          ? phaseArg
          : `phase-${phaseArg.padStart(2, "0")}`
        : undefined;
      const projectId =
        context.projectId ?? resolveProjectId(context.projectRoot);

      const pr = findOpenPr(resolved, projectId, phaseId);
      if (!pr) {
        return {
          response_type: "ephemeral",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `:warning: No open PR found for *${resolved}*${phaseId ? ` phase *${phaseId}*` : ""}`,
              },
            },
          ],
        };
      }

      if (!context.vcs) {
        return {
          response_type: "ephemeral",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: ":warning: VCS port is required to merge pull requests.",
              },
            },
          ],
        };
      }

      if (!context.projectRepository)
        throw new Error("The authorized project has no enrolled repository.");
      await context.vcs.mergePullRequest(
        context.projectRoot,
        pr.pr_number,
        context.projectRepository,
      );

      return {
        response_type: "in_channel",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `✅ PR #${pr.pr_number} for *${resolved}*${phaseId ? ` phase *${phaseId}*` : ""} merged!`,
            },
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:warning: Error: ${errorMessage}`,
            },
          },
        ],
      };
    }
  },

  reject: async (args, context) => {
    const [featureId, phaseId, ...reasonParts] = args;
    const reason = reasonParts.join(" ");
    if (!featureId || !phaseId || !reason) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":warning: Feature ID, Phase ID, and Reason are required. Usage: `/gwrk reject <featureId> <phaseId> <reason>`",
            },
          },
        ],
      };
    }

    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `❌ *${featureId}* phase *${phaseId}* rejected.\n*Reason:* ${reason}`,
          },
        },
      ],
    };
  },

  pause: async (args, context) => {
    const featureId = args[0];
    if (!featureId) {
      if (isSharedMultiProjectQueue(context.queue)) {
        return ephemeralWarning(
          ":warning: Global queue pause is disabled on shared multi-project queues because project roles cannot pause other enrolled projects. Stop or drain the daemon from the host instead.",
        );
      }
      context.queue.pause();
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "⏸️ Dispatch queue paused." },
          },
        ],
      };
    }

    // Logic to pause specific feature
    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `⏸️ Feature *${featureId}* paused.` },
        },
      ],
    };
  },

  pulse: async (args, context) => {
    const { generatePulseReport } = await import("../engine/pulse.js");
    const { loadConfig } = await import("../utils/config.js");

    try {
      const config = loadConfig(context.projectRoot);
      const checkout = fs.realpathSync(context.projectRoot);
      const tracksCheckout = config.pulse?.repos.some((repo) => {
        try {
          return fs.realpathSync(repo) === checkout;
        } catch {
          return false;
        }
      });
      const report = generatePulseReport(
        {
          ...config,
          pulse: { ...config.pulse, repos: tracksCheckout ? [checkout] : [] },
        },
        { specRoots: [checkout] },
      );
      let text = `📊 *Pulse Daily Summary* (${new Date(report.generatedAt).toLocaleDateString()})\n`;
      for (const repo of report.repositories) {
        text += `• *${repo.repoName}*: ${repo.mainLoc} LOC (+${repo.draftLoc} draft)\n`;
      }
      text += `\n*Overall Progress:* ${report.specProgress.totalPlans}/${report.specProgress.totalSpecs} plans ready`;

      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text },
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:warning: Error: ${errorMessage}`,
            },
          },
        ],
      };
    }
  },

  effort: async (args, context) => {
    const featureId = args[0];
    const { computeEffort } = await import("../engine/effort.js");
    const { resolveRoleMultipliers } = await import("../engine/roles.js");
    const { extractStories } = await import("../engine/spec-parser.js");
    const { loadConfig } = await import("../utils/config.js");
    const path = await import("node:path");

    try {
      const config = loadConfig(context.projectRoot);
      const roleMultipliers = resolveRoleMultipliers(config);
      const featureDir = featureId
        ? resolveScopedSlackFeature(context.projectRoot, featureId)?.directory
        : undefined;
      if (!featureDir || !scopedFeaturePath(featureDir, "spec.md")) {
        throw new Error(
          "Feature specification is unavailable inside this project's checkout.",
        );
      }

      const stories = extractStories(featureDir);
      const report = computeEffort(stories, roleMultipliers, 1.25);

      const text = `⚖️ *Effort Analysis* for *${featureId || "project"}*\n• Total Story Points: ${report.totalSP}\n• Total Raw Hours: ${report.totalRawHours}\n• Total with Overhead: ${report.totalWithOverhead}h\n• Estimated Days: ${report.totalDays.toFixed(1)}d`;

      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text },
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:warning: Error: ${errorMessage}`,
            },
          },
        ],
      };
    }
  },

  logs: async (args, context) =>
    buildSlackLogResponse(args, context.projectRoot),

  ship: async (args, context) => {
    const featureArg = args[0];
    const phaseArg = args[1];
    if (!featureArg || !phaseArg) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":warning: Usage: `/gwrk ship <featureId> <phase>`\nExample: `/gwrk ship 003 1`",
            },
          },
        ],
      };
    }

    const resolved = resolveScopedSlackFeature(
      context.projectRoot,
      featureArg,
    )?.featureId;
    if (!resolved) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:warning: Error: ${scopedFeatureUnavailable}`,
            },
          },
        ],
      };
    }

    const phaseId = phaseArg.startsWith("phase-")
      ? phaseArg
      : `phase-${phaseArg.padStart(2, "0")}`;

    const submission = submitCommandDispatch(resolved, phaseId, context);
    if (!submission.ok) {
      return submission.response;
    }

    const progressNotice =
      context.channelId?.startsWith("D") &&
      submission.notificationChannelId &&
      submission.notificationChannelId !== context.channelId
        ? `Progress will be posted in <#${submission.notificationChannelId}>.`
        : "Progress will be posted here.";
    const text = submission.deduplicated
      ? `🚀 Ship already active for *${resolved}* phase *${phaseId}* (operation \`${submission.operationId}\`, status: \`${submission.status}\`).`
      : `🚀 Dispatching *${resolved}* phase *${phaseId}*${submission.operationId ? ` (operation \`${submission.operationId}\`)` : ""}... ${progressNotice}`;

    return {
      response_type: "in_channel",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text,
          },
        },
      ],
    };
  },

  define: async (args, context) => {
    const featureId = args[0];
    if (!featureId) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":warning: Feature ID is required. Usage: `/gwrk define <featureId> [spec|plan|tasks|tests]`\nExample: `/gwrk define 003 spec`",
            },
          },
        ],
      };
    }

    // args[1] is optional subcommand: spec|plan|tasks|tests (default: spec)
    const subcommand = args[1] || "spec";
    const validSubs = ["spec", "plan", "tasks", "tests"];
    if (!validSubs.includes(subcommand)) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:warning: Invalid define subcommand: \`${subcommand}\`. Use: spec, plan, tasks, tests`,
            },
          },
        ],
      };
    }

    try {
      const resolved = resolveScopedSlackFeature(
        context.projectRoot,
        featureId,
      )?.featureId;
      if (!resolved) throw new Error(scopedFeatureUnavailable);

      // Spawn gwrk define <sub> <feature> as background process
      const child = spawn("gwrk", ["define", subcommand, resolved], {
        cwd: context.projectRoot,
        detached: true,
        stdio: "ignore",
      });
      child.unref();

      return {
        response_type: "in_channel",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `📋 Dispatching *define ${subcommand}* for *${resolved}*... Progress will be posted here.`,
            },
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:warning: Error: ${errorMessage}`,
            },
          },
        ],
      };
    }
  },

  research: async (args, context) => {
    const initiative = args.join(" ").trim();
    if (!initiative) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":warning: Initiative name or prefix required. Usage: `/gwrk research <initiative>`",
            },
          },
        ],
      };
    }

    const child = spawn("gwrk", ["define", "research", initiative, "--run"], {
      cwd: context.projectRoot,
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    return {
      response_type: "in_channel",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🔬 Dispatching research initiative *${initiative}*...`,
          },
        },
      ],
    };
  },

  adr: async (args, context) => {
    const sub = args[0] || "list";

    if (sub === "list") {
      const indexPath = scopedFeaturePath(
        context.projectRoot,
        ".gwrk",
        "decisions",
        "index.md",
      );
      if (!indexPath) {
        return {
          response_type: "ephemeral",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "No decision index found at `.gwrk/decisions/index.md`. Run `gwrk define adr --reindex`.",
              },
            },
          ],
        };
      }
      const content = fs.readFileSync(indexPath, "utf-8").trim();
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: content.slice(0, 2900),
            },
          },
        ],
      };
    }

    if (sub === "check") {
      try {
        const { adrCommandHandler } = await import("../commands/adr.js");
        const msg = await adrCommandHandler({
          check: true,
          cwd: context.projectRoot,
          verifiedCheckoutRoot:
            context.verifiedCheckoutRoot ?? context.projectRoot,
        });
        return {
          response_type: "ephemeral",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `✅ ${msg}`,
              },
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          response_type: "ephemeral",
          blocks: [
            { type: "section", text: { type: "mrkdwn", text: `⚠️ ${msg}` } },
          ],
        };
      }
    }

    if (sub === "decide") {
      const adrId = args[1];
      if (!adrId) {
        return {
          response_type: "ephemeral",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: ":warning: ADR ID required. Usage: `/gwrk adr decide ADR-010`",
              },
            },
          ],
        };
      }
      try {
        const { adrCommandHandler } = await import("../commands/adr.js");
        const msg = await adrCommandHandler({
          target: adrId,
          decide: true,
          cwd: context.projectRoot,
          verifiedCheckoutRoot: context.verifiedCheckoutRoot,
        });
        return {
          response_type: "in_channel",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `🏛️ ${msg}`,
              },
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          response_type: "ephemeral",
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: `:warning: ${msg}` },
            },
          ],
        };
      }
    }

    if (sub === "record") {
      const title = args.slice(1).join(" ").trim();
      if (!title) {
        return {
          response_type: "ephemeral",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: ":warning: Title required. Usage: `/gwrk adr record <title>`",
              },
            },
          ],
        };
      }
      try {
        const { resolveAdrAuthoringScope } = await import(
          "../engine/adr-scaffold.js"
        );
        const scope = await resolveAdrAuthoringScope(
          context.projectRoot,
          context.verifiedCheckoutRoot ?? context.projectRoot,
        );
        await launchDetachedGwrk(
          ["define", "adr", title, "--run"],
          scope.projectRoot,
          {
            ...process.env,
            GWRK_ADR_CHECKOUT_ROOT: scope.verifiedCheckoutRoot,
          },
        );
      } catch (error) {
        return {
          response_type: "ephemeral",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `:warning: ${error instanceof Error ? error.message : String(error)}`,
              },
            },
          ],
        };
      }
      return {
        response_type: "in_channel",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🏛️ Dispatching ADR authoring for *${title}*...`,
            },
          },
        ],
      };
    }

    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:warning: Unknown adr subcommand \`${sub}\`. Use: \`list\`, \`check\`, \`decide <ADR-NNN>\`, or \`record <title>\`.`,
          },
        },
      ],
    };
  },
};

export function buildSlackLogResponse(
  args: string[],
  projectRoot: string,
  options: { exactFeature?: boolean } = {},
): SlackBlockKit {
  const [featureId, phaseId] = args;
  if (!featureId) {
    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: ":warning: Feature ID is required. Usage: `/gwrk logs <featureId> [phaseId]`",
          },
        },
      ],
    };
  }

  // Read ship run JSON files from specs/<feature>/.gwrk/runs/
  const featureDir = options.exactFeature
    ? scopedFeatureDirectory(projectRoot, featureId, { exactId: true })
    : resolveScopedSlackFeature(projectRoot, featureId)?.directory;
  const runsDir = featureDir
    ? scopedFeaturePath(featureDir, ".gwrk", "runs")
    : undefined;
  if (!runsDir) {
    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📋 No ship run logs found for *${featureId}* in \`specs/${featureId}/.gwrk/runs/\``,
          },
        },
      ],
    };
  }

  let files = fs
    .readdirSync(runsDir)
    .filter(
      (f) => f.endsWith(".json") && scopedFeaturePath(runsDir, f) !== undefined,
    )
    .sort()
    .reverse();

  // Filter by phase if provided
  if (phaseId) {
    const phaseNorm = phaseId.startsWith("phase-")
      ? phaseId
      : `phase-${phaseId}`;
    files = files.filter(
      (f) => f.includes(phaseNorm) || f.includes(`_${phaseId}_`),
    );
  }

  if (files.length === 0) {
    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📋 No logs found for *${featureId}*${phaseId ? ` phase *${phaseId}*` : ""}`,
          },
        },
      ],
    };
  }

  // Read the most recent log
  const latestFile = files[0];
  const blocks: KnownBlock[] = [];

  try {
    const logPath = scopedFeaturePath(runsDir, latestFile);
    if (!logPath)
      throw new Error("Log file is outside the authorized feature.");
    const content = fs.readFileSync(logPath, "utf-8");
    const run = JSON.parse(content);

    const status =
      run.exit_code === 0
        ? "✅ PASS"
        : run.exit_code
          ? "❌ FAIL"
          : "🔄 IN PROGRESS";
    let text = `📋 *Latest log: ${latestFile}*\n`;
    text += `*Status:* ${status}\n`;
    if (run.feature_id) text += `*Feature:* ${run.feature_id}\n`;
    if (run.phase_id) text += `*Phase:* ${run.phase_id}\n`;
    if (run.agent_backend) text += `*Agent:* ${run.agent_backend}\n`;
    if (run.duration_s != null) text += `*Duration:* ${run.duration_s}s\n`;
    if (run.gate_result) text += `*Gate:* ${run.gate_result}\n`;
    if (run.review_verdict) text += `*Review:* ${run.review_verdict}\n`;

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text },
    });

    if (files.length > 1) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `${files.length} total runs. Showing latest.`,
          },
        ],
      });
    }
  } catch {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📋 *${latestFile}*\n_Could not parse log file._`,
      },
    });
  }

  return {
    response_type: "ephemeral",
    blocks,
  };
}

const featureCommands = new Set([
  "approve",
  "define",
  "dispatch",
  "effort",
  "logs",
  "pause",
  "reject",
  "ship",
  "status",
]);

const queueCommands = new Set(["dispatch", "pause", "ship"]);

const checkoutCommands = new Set([
  "adr",
  "approve",
  "define",
  "dispatch",
  "effort",
  "logs",
  "pulse",
  "research",
  "ship",
]);

export function resolveSlackCheckout(
  project: EnrolledProject,
  queueRoot?: string,
): string | undefined {
  const local = verifyEnrolledCheckout(project, "localRoot");
  if (queueRoot === undefined) {
    return local ?? verifyEnrolledCheckout(project, "mirrorPath");
  }

  try {
    const checkout = fs.realpathSync(queueRoot);
    if (
      checkout === local ||
      checkout === verifyEnrolledCheckout(project, "mirrorPath")
    ) {
      return checkout;
    }
  } catch {
    return undefined;
  }
}

export async function handleSlashCommand(
  commandText: string,
  context: CommandContext,
): Promise<SlackBlockKit> {
  const { requestedProject, cleanedText } = parseProjectSelector(commandText);
  const [subcommand, ...args] = cleanedText.trim().split(/\s+/);

  // "help" returns the same rich help as no subcommand
  if (!subcommand || subcommand === "help") {
    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "🦩 gwrk — Slack Commands",
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: [
              "*Clarity & Architecture*",
              "  `/gwrk research <initiative>` — scaffold & run first-principles research",
              "  `/gwrk adr [list|check|decide <ADR-NNN>|record <title>]` — manage architecture decisions",
              "  `/gwrk define <feature> [spec|plan|tasks|tests]` — define a feature artifact",
              "",
              "*Ship & Build*",
              "  `/gwrk ship <feature> <phase>` — ship a phase (branch → implement → review → PR)",
              "  `/gwrk dispatch <feature> <phase>` — enqueue a dispatch",
              "",
              "*Observe*",
              "  `/gwrk status [feature]` — system + feature status",
              "  `/gwrk pulse` — git velocity dashboard",
              "  `/gwrk effort <feature>` — effort estimation",
              "  `/gwrk logs [feature]` — latest run logs",
              "",
              "*Review*",
              "  `/gwrk approve <feature>` — approve a pending review",
              "  `/gwrk reject <feature>` — reject a pending review",
              "  `/gwrk pause` — pause the dispatch queue",
              "",
              "*Mentions*",
              "  `@gwrk <command>` — same commands, in-channel with threaded replies",
              "  `@gwrk what's the status?` — freeform → project summary",
              "  `/gwrk <command> --project <slug>` — select an enrolled project in shared channels or DMs",
            ].join("\n"),
          },
        },
      ],
    };
  }

  const handler = handlers[subcommand];
  if (!handler) {
    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:warning: Unknown command: \`${subcommand}\`\nRun \`/gwrk\` with no arguments to see all available commands.`,
          },
        },
      ],
    };
  }

  if (!context.routingService) {
    if (
      !context.workspaceId &&
      /^-?\d+$/.test(context.channelId) &&
      context.userId === `tg:${context.channelId}`
    ) {
      return handler(args, context);
    }
    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: ":warning: Slack service is running without project routing configuration (REMOTE_AUTH_REQUIRED).",
          },
        },
      ],
    };
  }

  const isDirectMessage = Boolean(context.channelId?.startsWith("D"));
  const requiredAccess = requiredAccessForSlackCommand(subcommand, args[0]);
  const envelope = {
    workspaceId: context.workspaceId || "",
    channelId: context.channelId || "",
    isDirectMessage,
    actorUserId: context.userId,
    threadTs: context.threadTs,
    messageTs: context.messageTs,
    requestedProject,
    requiredAccess,
  };

  const decision = context.routingService.authorizeCommand(envelope);
  if (!decision.ok) {
    let text = `:warning: ${decision.message}`;
    if (decision.candidateSlugs && decision.candidateSlugs.length > 0) {
      text += ` Candidate projects: ${decision.candidateSlugs.join(", ")}`;
    }
    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text,
          },
        },
      ],
    };
  }

  const hasMultiProjectQueue = supportsMultiProjectDispatch(context.queue);
  const isStartupQueueProject =
    context.queueProjectId === decision.project.projectId;
  const queueUnavailable =
    queueCommands.has(subcommand) &&
    !isStartupQueueProject &&
    !hasMultiProjectQueue;
  let threadTs = queueUnavailable
    ? undefined
    : (decision.recipient.threadTs ?? context.threadTs);
  const needsCheckout = !queueUnavailable && checkoutCommands.has(subcommand);
  const needsFeatureThread =
    !threadTs &&
    args[0] &&
    (queueUnavailable
      ? subcommand === "dispatch" || subcommand === "ship"
      : featureCommands.has(subcommand));
  const checkout =
    needsCheckout || needsFeatureThread || (subcommand === "status" && args[0])
      ? resolveSlackCheckout(
          decision.project,
          (subcommand === "dispatch" || subcommand === "ship") &&
            !queueUnavailable &&
            !hasMultiProjectQueue &&
            isStartupQueueProject
            ? context.projectRoot
            : undefined,
        )
      : undefined;

  const threadCheckout = needsFeatureThread
    ? (checkout ?? resolveSlackCheckout(decision.project))
    : undefined;
  if (threadCheckout && needsFeatureThread) {
    const featureId = resolveScopedSlackFeature(
      threadCheckout,
      args[0],
    )?.featureId;
    if (featureId) {
      const storedThread = context.routingService.getFeatureThread(
        decision.project.projectId,
        featureId,
      );
      if (
        storedThread?.projectId === decision.project.projectId &&
        storedThread.workspaceId === decision.recipient.workspaceId &&
        storedThread.channelId === decision.recipient.channelId
      ) {
        threadTs = storedThread.rootTs;
      }
    }
  }

  if (queueUnavailable) {
    return {
      response_type: "ephemeral",
      ...(threadTs ? { thread_ts: threadTs } : {}),
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: ":warning: The dispatch queue is unavailable for this project.",
          },
        },
      ],
    };
  }

  if (needsCheckout && !checkout) {
    return {
      response_type: "ephemeral",
      thread_ts: threadTs,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: ":warning: The project checkout is unavailable.",
          },
        },
      ],
    };
  }

  const projectContext: CommandContext = {
    ...context,
    projectRoot: checkout ?? context.projectRoot,
    verifiedCheckoutRoot: checkout,
    projectId: decision.project.projectId,
    projectSlug: decision.project.slug,
    enrolledProject: decision.project,
    projectRepository: decision.project.repoSlug
      ? (() => {
          const slug = normalizeGitRemoteSlug(decision.project.repoSlug);
          return slug?.split("/").length === 2
            ? `github.com/${slug}`
            : (slug ?? undefined);
        })()
      : undefined,
    recipient: {
      ...decision.recipient,
      ...(threadTs ? { threadTs } : {}),
    },
    threadTs,
  };

  const result = await handler(args, projectContext);
  if (threadTs?.trim() && !result.thread_ts) {
    result.thread_ts = threadTs;
  }
  return result;
}
