import { Command } from "commander";
import path from "node:path";
import { startRun, finishRun } from "../db/runs.js";
import { run } from "../utils/exec.js";
import { loadConfig } from "../utils/config.js";
import { banner, success, fail, dryRun as dryRunFmt } from "../utils/format.js";
import { implementAction } from "./implement.js";

/**
 * gwrk ship — The Shipping Pillar (Throughput)
 *
 * Everything that creates throughput — implementing and completing work autonomously.
 */
export const shipCommand = new Command("ship")
  .description("Ship: autonomous implement→review→PR loop")
  .argument("[feature]", "Feature ID")
  .argument("[phase]", "Phase number")
  .option("--dry-run", "Dry run mode")
  .option("--agent <agent>", "Override the default agent (e.g., gemini, claude, codex)")
  .action(async (feature, phase, opts) => {
    if (!feature || !phase) {
      shipCommand.help();
      return;
    }
    await implementAction(feature, phase, opts);
  });

shipCommand.command("done")
  .description("Autonomous implement→review→PR loop")
  .argument("<feature>", "Feature ID")
  .argument("<phase>", "Phase number")
  .option("--dry-run", "Dry run mode")
  .option("--max-iterations <n>", "Max iterations", "3")
  .option("--agent <agent>", "Override the default agent (e.g., gemini, claude, codex)")
  .action(async (feature: string, phase: string, options: any, cmd: Command) => {
    const opts = cmd.opts();
    const cwd = process.cwd();
    const scriptPath = path.join(cwd, "scripts/dev/work-until-done.sh");

    const config = loadConfig(cwd);
    const backend = opts.agent || options.agent || config.agents.implement;

    const isDryRun = opts.dryRun || options.dryRun || cmd.parent?.opts().dryRun;

    if (isDryRun) {
      dryRunFmt(`${scriptPath} ${feature} ${phase}`);
      return;
    }

    const runId = startRun({
      feature_id: feature,
      phase_id: `phase-${phase.padStart(2, "0")}`,
      command: "ship done",
      agent_backend: backend,
      workflow: "work-until-done",
    });

    banner("ship done", {
      Feature: feature,
      Phase: phase,
      Agent: backend,
      "Max Iter": opts.maxIterations,
      "Run ID": `${runId}`,
    });

    const startTime = Date.now();

    try {
      await run(scriptPath, [feature, phase], {
        cwd,
        env: {
          ...process.env,
          APPROVAL_MODE: "yolo",
          MAX_ITERATIONS: opts.maxIterations,
          AGENT_BACKEND: backend,
        },
        stdio: "inherit",
      });

      const durationS = Math.round((Date.now() - startTime) / 1000);
      finishRun(runId, { exit_code: 0, duration_s: durationS });
      success("ship done", durationS, runId);
    } catch (err: unknown) {
      const durationS = Math.round((Date.now() - startTime) / 1000);
      const exitCode = err instanceof Error && "code" in err ? (err as { code: number }).code : 1;
      finishRun(runId, { exit_code: exitCode, duration_s: durationS });
      fail("ship done", exitCode, durationS, runId);
      process.exit(exitCode);
    }
  });
