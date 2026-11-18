/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Command } from "commander";
import { logCliOutput } from "../adapters/cli/output-scope.js";
import { listRuns } from "../db/runs.js";
import { resolveProjectId } from "../utils/project-id.js";
import { resolveFeature } from "../utils/resolve-feature.js";
import { withSignal } from "../utils/signal.js";

/**
 * gwrk runs <feature> — Query execution history from SQLite
 */
export const createRunsCommand = () =>
  new Command("runs")
    .description("Show execution history for a feature")
    .addHelpText(
      "after",
      `
Examples:
  gwrk db runs 001
  gwrk db runs 001-cli-core --json
`,
    )
    .argument("<feature>", "Feature ID")
    .option("--json", "Output as JSON")
    .action(async (featureArg: string, opts: { json?: boolean }) => {
      await withSignal("db runs", async () => {
        const projectRoot = process.cwd();
        const feature = resolveFeature(featureArg, projectRoot);
        const projectId = resolveProjectId(projectRoot);
        const runs = listRuns(feature, projectId);

        if (runs.length === 0) {
          logCliOutput(`No runs found for ${feature}`);
          return;
        }

        if (opts.json) {
          logCliOutput(JSON.stringify(runs, null, 2));
          return;
        }

        logCliOutput(`\n📊 Execution History: ${feature}`);
        logCliOutput("─".repeat(80));
        logCliOutput(
          `${"#".padEnd(5)} ${"Command".padEnd(12)} ${"Phase".padEnd(12)} ${"Agent".padEnd(14)} ${"Exit".padEnd(6)} ${"Duration".padEnd(10)} ${"Started"}`,
        );
        logCliOutput("─".repeat(80));

        for (const r of runs) {
          const dur = r.duration_s ? `${r.duration_s}s` : "—";
          const exit =
            r.exit_code !== undefined && r.exit_code !== null
              ? r.exit_code === 0
                ? "✅ 0"
                : `❌ ${r.exit_code}`
              : "⏳";
          const phase = r.phase_id ?? "—";
          const agent = r.agent_backend ?? "—";
          const started = r.started_at ?? "—";

          logCliOutput(
            `${String(r.id).padEnd(5)} ${r.command.padEnd(12)} ${phase.padEnd(12)} ${agent.padEnd(14)} ${exit.padEnd(6)} ${dur.padEnd(10)} ${started}`,
          );
        }

        logCliOutput("─".repeat(80));
        logCliOutput(`Total: ${runs.length} runs\n`);
      });
    });

export const runsCommand = createRunsCommand();
