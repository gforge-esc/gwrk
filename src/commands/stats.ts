import { Command } from "commander";
import { getStats } from "../db/runs.js";

export const statsCommand = new Command("stats")
  .description("Show aggregate success rates and execution statistics")
  .option("--json", "Output structured JSON to stdout")
  .action((options) => {
    try {
      const stats = getStats();

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log("\n=== EXECUTION STATISTICS ===\n");
      if (stats.length === 0) {
        console.log("No completed runs found in the database yet.");
        return;
      }

      console.log(
        "  Command    | Workflow        | Agent     | Runs | Succ% | Avg Dur",
      );
      console.log(
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
        console.log(
          `  ${cmd} | ${wf} | ${agent} | ${runsStr} | ${succStr} | ${durStr}`,
        );
      }
      console.log("\n");
    } catch (err: unknown) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
