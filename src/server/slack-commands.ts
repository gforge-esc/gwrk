import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { KnownBlock } from "@slack/types";
import { findOpenPr } from "../db/runs.js";
import { resolveFeature } from "../utils/resolve-feature.js";
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
    const { listRuns } = await import("../db/runs.js");
    const featureId = args[0];
    const resources = context.monitor.getResources();
    const queueInfo = context.queue.getQueue();

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
      // Check in-memory queue first (live dispatches)
      const featureDispatch = context.queue.getDispatch(featureId, "");
      if (featureDispatch) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Feature ${featureId}:* ${featureDispatch.status} (${featureDispatch.phaseId})`,
          },
        });
      }

      // Always query SQLite for run history
      try {
        const runs = listRuns(featureId);
        if (runs.length > 0) {
          const recent = runs.slice(0, 5);
          let text = `*Recent runs for ${featureId}:*`;
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
              text: `*Feature ${featureId}:* No dispatch runs found.`,
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
      const runsDir = path.join(
        context.projectRoot,
        "specs",
        featureId,
        ".gwrk",
        "runs",
      );
      if (fs.existsSync(runsDir)) {
        const files = fs
          .readdirSync(runsDir)
          .filter((f) => f.endsWith(".json"))
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
        const store = new PlanStore();
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
        const { listRuns: listAllRuns } = await import("../db/runs.js");
        // Find features with PRs that haven't been merged
        const { getStats } = await import("../db/runs.js");
        const stats = getStats();
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
      const activeDispatches = queueInfo.active;
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

    try {
      const resolved = resolveFeature(featureId, context.projectRoot);
      const phaseId = phaseArg
        ? phaseArg.startsWith("phase-")
          ? phaseArg
          : `phase-${phaseArg.padStart(2, "0")}`
        : "phase-01";
      context.queue.enqueue({ featureId: resolved, phaseId });

      return {
        response_type: "in_channel",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🚀 Dispatching feature *${resolved}* phase *${phaseId}*...`,
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
      const resolved = resolveFeature(featureArg, context.projectRoot);
      const phaseId = phaseArg
        ? phaseArg.startsWith("phase-")
          ? phaseArg
          : `phase-${phaseArg.padStart(2, "0")}`
        : undefined;

      const pr = findOpenPr(resolved, phaseId);
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

      execSync(`gh pr merge ${pr.pr_number} --merge --delete-branch`, {
        cwd: context.projectRoot,
        encoding: "utf-8",
        timeout: 30_000,
      });

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
      const featureDir = path.join(
        context.projectRoot,
        "specs",
        featureId || "",
      );

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

  logs: async (args, context) => {
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
    const runsDir = path.join(
      context.projectRoot,
      "specs",
      featureId,
      ".gwrk",
      "runs",
    );
    if (!fs.existsSync(runsDir)) {
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
      .filter((f) => f.endsWith(".json"))
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
      const content = fs.readFileSync(path.join(runsDir, latestFile), "utf-8");
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
  },

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

    try {
      const resolved = resolveFeature(featureArg, context.projectRoot);

      // Spawn gwrk ship as background process
      const child = spawn("gwrk", ["ship", resolved, phaseArg], {
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
              text: `🚀 Dispatching *${resolved}* phase *${phaseArg}*... Progress will be posted here.`,
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
      const resolved = resolveFeature(featureId, context.projectRoot);

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
};

export async function handleSlashCommand(
  commandText: string,
  context: CommandContext,
): Promise<SlackBlockKit> {
  const [subcommand, ...args] = commandText.trim().split(/\s+/);

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
              "*Ship & Build*",
              "  `/gwrk ship <feature> <phase>` — ship a phase (branch → implement → review → PR)",
              "  `/gwrk define <feature> [spec|plan|tasks|tests]` — define a feature artifact",
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

  return handler(args, context);
}
