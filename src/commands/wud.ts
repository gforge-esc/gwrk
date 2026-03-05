import { Command } from "commander";
import path from "node:path";
import { startRun, finishRun } from "../db/runs.js";
import { run } from "../utils/exec.js";
import { loadConfig } from "../utils/config.js";

/**
 * gwrk wud <feature> <phase> — Work Until Done
 * Wraps scripts/dev/work-until-done.sh with run recording in SQLite.
 */
export const wudCommand = new Command("wud")
  .description("Work Until Done — autonomous implement→review→PR loop")
  .argument("<feature>", "Feature ID (e.g. 004-wud-loop)")
  .argument("<phase>", "Phase number")
  .option("--dry-run", "Print the command without executing")
  .action(async (feature: string, phase: string, opts: { dryRun?: boolean }) => {
    const cwd = process.cwd();
    const scriptPath = path.join(cwd, "scripts/dev/work-until-done.sh");

    const config = loadConfig(cwd);
    const backend = config.agents.implement;

    console.log(`🏗️  gwrk wud ${feature} phase ${phase}`);
    console.log(`   Agent: ${backend}`);

    if (opts.dryRun) {
      console.log(`   [DRY RUN] Would execute: ${scriptPath} ${feature} ${phase}`);
      return;
    }

    // Record start in SQLite
    const runId = startRun({
      feature_id: feature,
      phase_id: `phase-${phase.padStart(2, "0")}`,
      command: "wud",
      agent_backend: backend,
      workflow: "work-until-done",
    });
    console.log(`   Run ID: ${runId}`);

    const startTime = Date.now();

    try {
      await run(scriptPath, [feature, phase], {
        cwd,
        env: { ...process.env, APPROVAL_MODE: "yolo" },
        stdio: "inherit",
      });

      const durationS = Math.round((Date.now() - startTime) / 1000);
      finishRun(runId, {
        exit_code: 0,
        duration_s: durationS,
      });
      console.log(`\n✅ Done, Done! (${durationS}s) — Run #${runId}`);
    } catch (error) {
      const durationS = Math.round((Date.now() - startTime) / 1000);
      const exitCode = error instanceof Error && "exitCode" in error
        ? (error as { exitCode: number }).exitCode
        : 1;
      finishRun(runId, {
        exit_code: exitCode,
        duration_s: durationS,
      });
      console.error(`\n❌ WUD failed (exit ${exitCode}, ${durationS}s) — Run #${runId}`);
      process.exit(exitCode);
    }
  });
