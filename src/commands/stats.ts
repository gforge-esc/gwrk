/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Command } from "commander";
import { logCliOutput } from "../adapters/cli/output-scope.js";
import { getStats } from "../db/runs.js";
import { resolveProjectId } from "../utils/project-id.js";
import { withSignal } from "../utils/signal.js";

export const createStatsCommand = () =>
  new Command("stats")
    .description("Show aggregate success rates and execution statistics")
    .option("--json", "Output structured JSON to stdout")
    .action(async (options) => {
      await withSignal("stats", async () => {
        const projectId = resolveProjectId(process.cwd());
        const stats = getStats(projectId);

        if (options.json) {
          logCliOutput(JSON.stringify(stats, null, 2));
          return;
        }

        logCliOutput("\n=== EXECUTION STATISTICS ===\n");
        if (stats.length === 0) {
          logCliOutput("No completed runs found in the database yet.");
          return;
        }

        logCliOutput(
          "  Command    | Workflow        | Agent     | Runs | Succ% | Avg Dur",
        );
        logCliOutput(
          "  -----------|-----------------|-----------|------|-------|--------",
        );
        for (const row of stats) {
          const cmd = row.command.padEnd(10);
          const wf = (row.workflow || "-").padEnd(15);
          const agent = (row.agent_backend || "-").padEnd(9);
          const runsStr = row.total_runs.toString().padStart(4);
          const succPct = Math.round((row.success_runs / row.total_runs) * 100);
          const succStr = `${succPct}%`.padStart(5);
          const durStr = `${Math.round(row.avg_duration_s || 0)}s`.padStart(7);
          logCliOutput(
            `  ${cmd} | ${wf} | ${agent} | ${runsStr} | ${succStr} | ${durStr}`,
          );
        }
        logCliOutput("\n");
      });
    });

export const statsCommand = createStatsCommand();
