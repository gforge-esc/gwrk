import { Command } from "commander";
import path from "node:path";
import { startRun, finishRun } from "../db/runs.js";
import { run } from "../utils/exec.js";
import { loadConfig } from "../utils/config.js";

/**
 * gwrk define <feature> — Define Until Solid
 * Wraps scripts/dev/define-until-solid.sh with run recording.
 * Runs the full DUS loop: specify → plan → tasks → analyze
 */
export const defineCommand = new Command("define")
  .description("Define Until Solid — specify→plan→tasks→analyze loop")
  .argument("<feature>", "Feature ID (e.g. 004-wud-loop)")
  .option("--dry-run", "Print the command without executing")
  .action(async (feature: string, opts: { dryRun?: boolean }) => {
    const cwd = process.cwd();
    const scriptPath = path.join(cwd, "scripts/dev/define-until-solid.sh");

    const config = loadConfig(cwd);
    const backend = config.agents.define;

    console.log(`📋 gwrk define ${feature}`);
    console.log(`   Agent: ${backend}`);

    if (opts.dryRun) {
      console.log(`   [DRY RUN] Would execute: ${scriptPath} ${feature}`);
      return;
    }

    const runId = startRun({
      feature_id: feature,
      command: "define",
      agent_backend: backend,
      workflow: "define-until-solid",
    });
    console.log(`   Run ID: ${runId}`);

    const startTime = Date.now();

    try {
      await run(scriptPath, [feature], {
        cwd,
        env: { ...process.env, APPROVAL_MODE: "yolo" },
        stdio: "inherit",
      });

      const durationS = Math.round((Date.now() - startTime) / 1000);
      finishRun(runId, { exit_code: 0, duration_s: durationS });
      console.log(`\n✅ Definition complete (${durationS}s) — Run #${runId}`);
    } catch (error) {
      const durationS = Math.round((Date.now() - startTime) / 1000);
      const exitCode = error instanceof Error && "exitCode" in error
        ? (error as { exitCode: number }).exitCode
        : 1;
      finishRun(runId, { exit_code: exitCode, duration_s: durationS });
      console.error(`\n❌ Define failed (exit ${exitCode}, ${durationS}s) — Run #${runId}`);
      process.exit(exitCode);
    }
  });
