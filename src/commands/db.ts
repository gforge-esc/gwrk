import { Command } from "commander";
import { recordRun } from "../db/runs.js";
import { success } from "../utils/format.js";
import { runsCommand } from "./runs.js";
import { statsCommand } from "./stats.js";

import { CommandError, withSignal } from "../utils/signal.js";

export const recordCommand = new Command("record")
  .description("Record a run in the execution ledger")
  .requiredOption("-f, --feature <id>", "Feature ID")
  .option("-p, --phase <id>", "Phase ID")
  .requiredOption("-c, --command <name>", "Command name")
  .option("-w, --workflow <name>", "Workflow name")
  .option("-a, --agent <name>", "Agent backend")
  .option("-x, --exit-code <n>", "Exit code", "0")
  .option("-d, --duration <n>", "Duration in seconds", "0")
  .option("-v, --verdict <v>", "Review verdict (GO/NO-GO)")
  .option("-g, --gate <g>", "Gate result (PASS/FAIL)")
  .option("-l, --log <path>", "Path to log file")
  .action(async (opts) => {
    await withSignal("record", async () => {
      const runId = recordRun({
        feature_id: opts.feature,
        phase_id: opts.phase,
        command: opts.command,
        workflow: opts.workflow,
        agent_backend: opts.agent,
        exit_code: Number(opts.exitCode),
        duration_s: Number(opts.duration),
        review_verdict: opts.verdict,
        gate_result: opts.gate,
        log_file: opts.log,
      });
      success("record", Number(opts.duration), runId);
    });
  });

export const dbCommand = new Command("db")
  .description("Query the local execution ledger")
  .addHelpText(
    "after",
    `
Examples:
  gwrk db runs
  gwrk db runs 001
  gwrk db stats
`,
  )
  .addCommand(runsCommand)
  .addCommand(statsCommand)
  .addCommand(recordCommand, { hidden: true });
