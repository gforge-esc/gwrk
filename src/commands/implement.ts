import { Command } from "commander";
import path from "node:path";
import { startRun, finishRun } from "../db/runs.js";
import { run } from "../utils/exec.js";
import { loadConfig } from "../utils/config.js";

/**
 * gwrk implement <feature> <phase> — Execute a single phase
 * Wraps scripts/dev/agent-run.sh implement with run recording.
 */
export const implementCommand = new Command("implement")
  .description("Execute a single implementation phase via agent")
  .argument("<feature>", "Feature ID (e.g. 004-wud-loop)")
  .argument("<phase>", "Phase number")
  .option("--dry-run", "Print the command without executing")
  .action(async (feature: string, phase: string, opts: { dryRun?: boolean }) => {
    const cwd = process.cwd();
    const scriptPath = path.join(cwd, "scripts/dev/agent-run.sh");

    const config = loadConfig(cwd);
    const backend = config.agents.implement;

    console.log(`⚡ gwrk implement ${feature} phase ${phase}`);
    console.log(`   Agent: ${backend}`);

    if (opts.dryRun) {
      console.log(`   [DRY RUN] Would execute: ${scriptPath} implement ${feature} ${phase}`);
      return;
    }

    const runId = startRun({
      feature_id: feature,
      phase_id: `phase-${phase.padStart(2, "0")}`,
      command: "implement",
      agent_backend: backend,
      workflow: "implement",
    });
    console.log(`   Run ID: ${runId}`);

    const startTime = Date.now();

    try {
      await run(scriptPath, ["implement", feature, phase], {
        cwd,
        env: { ...process.env, APPROVAL_MODE: "yolo" },
        stdio: "inherit",
      });

      const durationS = Math.round((Date.now() - startTime) / 1000);
      finishRun(runId, { exit_code: 0, duration_s: durationS });
      console.log(`\n✅ Implementation complete (${durationS}s) — Run #${runId}`);
    } catch (error) {
      const durationS = Math.round((Date.now() - startTime) / 1000);
      const exitCode = error instanceof Error && "exitCode" in error
        ? (error as { exitCode: number }).exitCode
        : 1;
      finishRun(runId, { exit_code: exitCode, duration_s: durationS });
      console.error(`\n❌ Implement failed (exit ${exitCode}, ${durationS}s) — Run #${runId}`);
      process.exit(exitCode);
    }
  });
