/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import * as path from "node:path";
import type { App } from "@slack/bolt";
import { loadTaskState } from "../utils/state.js";
import type { CommandContext } from "./slack-commands.js";
import { handleSlashCommand } from "./slack-commands.js";

/**
 * Known command verbs that route through handleSlashCommand().
 * Everything else is treated as a freeform question.
 */
const COMMAND_VERBS = [
  "status",
  "ship",
  "define",
  "pulse",
  "effort",
  "logs",
  "dispatch",
  "approve",
  "reject",
  "pause",
];

/**
 * Assemble a concise project context summary from all specs/ directories.
 * Returns a Slack mrkdwn string.
 */
function assembleProjectContext(projectRoot: string): string {
  const specsDir = path.join(projectRoot, "specs");
  if (!fs.existsSync(specsDir)) {
    return "_No specs/ directory found._";
  }

  const features = fs
    .readdirSync(specsDir)
    .filter((d) => {
      const full = path.join(specsDir, d);
      return fs.statSync(full).isDirectory();
    })
    .sort();

  const lines: string[] = [];
  for (const feature of features) {
    try {
      const featureDir = path.join(specsDir, feature);
      const taskState = loadTaskState(featureDir);
      const allTasks = taskState.phases.flatMap((p) => p.tasks);
      const completed = allTasks.filter((t) => t.status === "completed").length;
      const total = allTasks.length;
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      const icon = pct === 100 ? "✅" : pct > 0 ? "🟡" : "⬜";
      lines.push(`${icon} *${feature}*: ${completed}/${total} tasks (${pct}%)`);
    } catch {
      // No tasks.json — check if spec.md exists
      const specPath = path.join(specsDir, feature, "spec.md");
      if (fs.existsSync(specPath)) {
        lines.push(`📋 *${feature}*: specified (no tasks)`);
      }
    }
  }

  return lines.length > 0
    ? lines.join("\n")
    : "_No features with tasks.json found._";
}

/**
 * Register the @gwrk mention handler.
 *
 * When someone mentions @gwrk in a channel:
 * 1. If the text starts with a known command verb → route to handleSlashCommand()
 * 2. If freeform → reply with project context summary
 */
export function registerMentionHandler(
  app: App,
  context: CommandContext,
): void {
  app.event("app_mention", async ({ event, say }) => {
    // Strip the @gwrk mention prefix to get the user's text
    const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();

    if (!text) {
      await say({
        thread_ts: event.ts,
        text: "👋 What do you need? Try `@gwrk status 001` or `@gwrk ship 003 1`",
      });
      return;
    }

    const [firstWord, ...rest] = text.split(/\s+/);
    const verb = firstWord.toLowerCase();

    // Route known command verbs through the existing slash command handler
    // "help" routes as empty string to trigger the full help text
    if (COMMAND_VERBS.includes(verb) || verb === "help") {
      try {
        const commandText = verb === "help" ? "" : text;
        const response = await handleSlashCommand(commandText, context);
        await say({
          thread_ts: event.ts,
          blocks: response.blocks,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await say({
          thread_ts: event.ts,
          text: `⚠️ Error: ${msg}`,
        });
      }
      return;
    }

    // Freeform question → reply with project context summary
    const contextSummary = assembleProjectContext(context.projectRoot);
    await say({
      thread_ts: event.ts,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📊 *Project Status*\n\n${contextSummary}`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "*Ship:* `@gwrk ship <feature> <phase>` · `@gwrk define spec <feature>` · *Observe:* `@gwrk status <feature>` · `@gwrk pulse` · `@gwrk logs` · *Review:* `@gwrk approve <feature>`",
            },
          ],
        },
      ],
    });
  });
}
