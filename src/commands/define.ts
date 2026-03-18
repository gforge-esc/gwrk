import path from "node:path";
import { Command } from "commander";
import { finishRun, recordHistory, startRun } from "../db/runs.js";
import { loadConfig } from "../utils/config.js";
import { run } from "../utils/exec.js";
import { banner, dryRun as dryRunFmt, fail, success } from "../utils/format.js";
import {
  getCurrentBranch,
  getCurrentCommit,
  getDiffStats,
} from "../utils/git.js";
import { generateRunId, writeManifest } from "../utils/manifest.js";

import { planCommand } from "./plan.js";
// Subcommands — each is a standalone user action
import { specifyCommand } from "./specify.js";
import { tasksGenerateCommand } from "./tasks-generate.js";
import { testsGenerateCommand } from "./tests-generate.js";

import { CommandError, withSignal } from "../utils/signal.js";

/**
 * gwrk define — The Definition Pillar (Clarity)
 *
 * User-facing commands:
 *   gwrk define <feature> [--refs <path>]     Full definition loop
 *   gwrk define spec <feature>                Create/refine spec
 *   gwrk define plan <feature>                Create implementation plan
 *   gwrk define tasks <feature>               Decompose plan → tasks + gates
 *   gwrk define tests <feature> <phase>       Generate RED tests for a phase
 *
 * Internal definition stages (NOT exposed as subcommands):
 *   analyze, checklist — run inside the definition loop automatically
 */
export const defineCommand = new Command("define")
  .description("Define: spec → plan → tasks → analyze")
  .argument("[feature]", "Feature ID (e.g. 001-cli-core)")
  .option("--refs <path>", "Path to additional reference docs")
  .option("--dry-run", "Print the command without executing")
  .action(
    async (
      feature: string | undefined,
      opts: { dryRun?: boolean; refs?: string },
    ) => {
      await withSignal("define", async () => {
        if (!feature) {
          throw new CommandError(
            "Feature ID required. Run 'gwrk project specs' to list available features.",
            2,
          );
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

        const startedAt = new Date().toISOString();
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
        let exitCode = 0;

        try {
          const envVars: Record<string, string> = {
            ...(process.env as Record<string, string>),
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
          exitCode =
            error instanceof Error && "exitCode" in error
              ? (error as { exitCode: number }).exitCode
              : 1;
          finishRun(runId, { exit_code: exitCode, duration_s: durationS });
          fail("define", exitCode, durationS, runId);
        }

        // Write Execution Manifest (ADR-003)
        try {
          const finishedAt = new Date().toISOString();
          const durationS = Math.round((Date.now() - startTime) / 1000);
          const gitCommit = getCurrentCommit(cwd);
          const gitBranch = getCurrentBranch(cwd);
          const { filesChanged, linesAdded, linesDeleted } = getDiffStats(
            cwd,
            `${gitCommit}~1`,
          );

          const manifestId = generateRunId(startedAt, "define", "p00");
          const featureDir = path.join(cwd, "specs", feature);

          writeManifest(featureDir, {
            runId: manifestId,
            feature,
            phase: "p00",
            command: "define",
            agent: backend,
            model: "unknown",
            startedAt,
            finishedAt,
            durationS,
            exitCode,
            attempt: 1,
            filesChanged,
            linesAdded,
            linesDeleted,
            gitCommit,
            gitBranch,
            digest: [],
          });

          // Record in history table
          recordHistory({
            feature_id: feature,
            run_id: runId,
            from_status: "open", // Simplified
            to_status: exitCode === 0 ? "completed" : "open",
            metadata: JSON.stringify({ command: "define", manifestId }),
          });
        } catch (manifestError) {
          console.warn(
            `Warning: Could not write execution manifest: ${manifestError}`,
          );
        }

        if (exitCode !== 0) {
          process.exitCode = exitCode;
        }
      });
    },
  );

// Register user-facing subcommands only
defineCommand.addCommand(specifyCommand); // gwrk define spec
defineCommand.addCommand(planCommand); // gwrk define plan
defineCommand.addCommand(tasksGenerateCommand); // gwrk define tasks
defineCommand.addCommand(testsGenerateCommand); // gwrk define tests
