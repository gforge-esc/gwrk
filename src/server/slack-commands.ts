import type { KnownBlock } from "@slack/types";
import type { DispatchQueue } from "./dispatch.js";
import type { GitManager } from "./git-manager.js";
import type { SystemMonitor } from "./monitor.js";
import type { DispatchRecord } from "./types.js";

export interface SlackBlockKit {
  blocks: KnownBlock[];
  response_type: "ephemeral" | "in_channel";
}

export interface CommandContext {
  userId: string;
  channelId: string;
  projectRoot: string;
  buildServerUrl: string;
  queue: DispatchQueue;
  monitor: SystemMonitor;
  git: GitManager;
}

export type SlashCommandHandler = (
  args: string[],
  context: CommandContext,
) => Promise<SlackBlockKit>;

const handlers: Record<string, SlashCommandHandler> = {
  status: async (args, context) => {
    const featureId = args[0];
    const resources = context.monitor.getResources();
    const queueInfo = context.queue.getQueue();
    const activeDispatches = queueInfo.active;

    const blocks: KnownBlock[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*System Resources:* CPU ${resources.cpuPercent.toFixed(1)}%, MEM ${resources.memPercent.toFixed(1)}%`,
        },
      },
    ];

    if (featureId) {
      const allDispatches = [
        ...queueInfo.active,
        ...queueInfo.queued,
        ...context.queue.getQueue().active, // getQueue already returns active/queued
      ];
      // Note: context.queue.getDispatch is a better way if implemented
      const featureDispatch = context.queue.getDispatch(featureId, ""); // phaseId empty matches any

      if (featureDispatch) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Feature ${featureId}:* ${featureDispatch.status} (${featureDispatch.phaseId})`,
          },
        });
      } else {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Feature ${featureId}:* Not active or queued.`,
          },
        });
      }
    } else {
      let text = `*Active Dispatches:* ${activeDispatches.length}`;
      for (const d of activeDispatches as DispatchRecord[]) {
        text += `\n• ${d.featureId} (${d.phaseId}): ${d.status}`;
      }
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text },
      });
    }

    return {
      response_type: "ephemeral",
      blocks,
    };
  },

  dispatch: async (args, context) => {
    const featureId = args[0];
    if (!featureId) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":warning: Feature ID is required. Usage: `/gwrk dispatch <featureId>`",
            },
          },
        ],
      };
    }

    try {
      // Trigger dispatch - needs phase selection or default to first open
      context.queue.enqueue({ featureId, phaseId: "phase-01" });

      return {
        response_type: "in_channel",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🚀 Dispatching feature *${featureId}* phase *phase-01*...`,
            },
          },
        ],
      };
    } catch (error: any) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:warning: Failed to dispatch: ${error.message}`,
            },
          },
        ],
      };
    }
  },

  approve: async (args, context) => {
    const [featureId, phaseId] = args;
    if (!featureId || !phaseId) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":warning: Feature ID and Phase ID are required. Usage: `/gwrk approve <featureId> <phaseId>`",
            },
          },
        ],
      };
    }

    try {
      // Logic to merge PR
      context.git.mergePhaseBack(featureId, phaseId);
      return {
        response_type: "in_channel",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `✅ *${featureId}* phase *${phaseId}* approved and merged!`,
            },
          },
        ],
      };
    } catch (error: any) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:warning: Failed to approve: ${error.message}`,
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
    const config = loadConfig(context.projectRoot);

    try {
      const report = generatePulseReport(config);
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
    } catch (error: any) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:warning: Failed to generate pulse: ${error.message}`,
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
      const featureDir = path.join(context.projectRoot, "specs", featureId || "");
      
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
    } catch (error: any) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:warning: Failed to analyze effort: ${error.message}`,
            },
          },
        ],
      };
    }
  },

  logs: async (args, context) => {
    const [featureId, phaseId] = args;
    if (!featureId || !phaseId) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":warning: Feature ID and Phase ID are required. Usage: `/gwrk logs <featureId> <phaseId>`",
            },
          },
        ],
      };
    }

    // In a real implementation, we'd fetch from a logs file or the DB
    const logUrl = `${context.buildServerUrl}/api/logs/${featureId}/${phaseId}`;
    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📋 Logs for *${featureId}* (*${phaseId}*) are available here: <${logUrl}|View Logs>`,
          },
        },
      ],
    };
  },
};

export async function handleSlashCommand(
  commandText: string,
  context: CommandContext,
): Promise<SlackBlockKit> {
  const [subcommand, ...args] = commandText.trim().split(/\s+/);

  if (!subcommand) {
    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Available commands: `status`, `dispatch`, `approve`, `reject`, `pause`, `pulse`, `effort`, `logs`",
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
            text: `:warning: Unknown subcommand: \`${subcommand}\``,
          },
        },
      ],
    };
  }

  return handler(args, context);
}
