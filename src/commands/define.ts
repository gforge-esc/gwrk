import { Command } from "commander";
import path from "node:path";
import { startRun, finishRun } from "../db/runs.js";
import { run } from "../utils/exec.js";
import { loadConfig } from "../utils/config.js";
import { banner, success, fail, dryRun as dryRunFmt } from "../utils/format.js";

// Subcommands — each is a standalone user action
import { specifyCommand } from "./specify.js";
import { planCommand } from "./plan.js";
import { tasksGenerateCommand } from "./tasks-generate.js";

/**
 * gwrk define — The Definition Pillar (Clarity)
 *
 * User-facing commands:
 *   gwrk define <feature> [--refs <path>]     Full definition loop
 *   gwrk define spec <feature>                Create/refine spec
 *   gwrk define plan <feature>                Create implementation plan
 *   gwrk define tasks <feature>               Decompose plan → tasks + gates
 *
 * Internal definition stages (NOT exposed as subcommands):
 *   analyze, checklist, tests — run inside the definition loop automatically
 */
export const defineCommand = new Command("define")
  .description("Define: spec → plan → tasks → analyze")
  .argument("[feature]", "Feature ID (e.g. 001-cli-core)")
  .option("--refs <path>", "Path to additional reference docs")
  .option("--dry-run", "Print the command without executing")
  .action(async (feature: string | undefined, opts: { dryRun?: boolean; refs?: string }) => {
    if (!feature) {
      defineCommand.help();
      return;
    }

    // Bare `gwrk define <feature>` = full definition loop
    const cwd = process.cwd();
    const scriptPath = path.join(cwd, "scripts/dev/define-until-solid.sh");

    const config = loadConfig(cwd);
    const backend = config.agents.define;

    if (opts.dryRun) {
      dryRunFmt(`${scriptPath} ${feature}`);
      return;
    }

    const runId = startRun({
      feature_id: feature,
      command: "define",
      agent_backend: backend,
      workflow: "define-until-solid",
    });

    banner("define", {
      Feature: feature,
      Agent: backend,
      "Run ID": `${runId}`,
      ...(opts.refs ? { Refs: opts.refs } : {}),
    });

    const startTime = Date.now();

    try {
      const envVars: Record<string, string> = {
        ...process.env as Record<string, string>,
        APPROVAL_MODE: "yolo",
      };
      if (opts.refs) envVars.GWRK_REFS = opts.refs;

      await run(scriptPath, [feature], {
        cwd,
        env: envVars,
        stdio: "inherit",
      });

      const durationS = Math.round((Date.now() - startTime) / 1000);
      finishRun(runId, { exit_code: 0, duration_s: durationS });
      success("define", durationS, runId);
    } catch (error) {
      const durationS = Math.round((Date.now() - startTime) / 1000);
      const exitCode = error instanceof Error && "exitCode" in error
        ? (error as { exitCode: number }).exitCode
        : 1;
      finishRun(runId, { exit_code: exitCode, duration_s: durationS });
      fail("define", exitCode, durationS, runId);
      process.exit(exitCode);
    }
  });

// Register user-facing subcommands only
defineCommand.addCommand(specifyCommand);       // gwrk define spec
defineCommand.addCommand(planCommand);          // gwrk define plan
defineCommand.addCommand(tasksGenerateCommand); // gwrk define tasks
