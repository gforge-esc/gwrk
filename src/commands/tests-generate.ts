import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { finishRun, startRun } from "../db/runs.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import { loadConfig } from "../utils/config.js";
import { banner, blocked, fail, success } from "../utils/format.js";
import { loadTaskState } from "../utils/state.js";

import {
  getCurrentBranch,
  getCurrentCommit,
  getDiffStats,
} from "../utils/git.js";
import { generateRunId, writeManifest } from "../utils/manifest.js";
import { CommandError, withSignal } from "../utils/signal.js";

/**
 * gwrk define tests <feature> [options] — Generate RED test files from spec/plan
 */
export const testsGenerateCommand = new Command("tests")
  .description(
    "Generate RED test files for a whole feature (or specific phase)",
  )
  .argument("<feature>", "Feature ID (e.g. 001-cli-core)")
  .option(
    "-p, --phase <phase>",
    "Specific phase string or number to generate tests for (e.g. p01 or 1)",
  )
  .option(
    "--force",
    "Overwrite existing test artifacts (gap-matrix.md, test files)",
  )
  .action(
    async (feature: string, options: { phase?: string; force?: boolean }) => {
      await withSignal(`define tests ${feature}`, async () => {
        const projectRoot = process.cwd();
        const relativeFeatureDir = path.join("specs", feature);
        const featureDir = path.join(projectRoot, relativeFeatureDir);

        const specPath = path.join(featureDir, "spec.md");
        const planPath = path.join(featureDir, "plan.md");

        if (!fs.existsSync(specPath) || !fs.existsSync(planPath)) {
          blocked("Missing required files (spec.md or plan.md)");
          throw new CommandError(
            "spec and plan must exist before generating tests. Run 'gwrk define plan' first.",
            1,
          );
        }

        // Guard: refuse to overwrite existing tests without --force
        const gapMatrixPath = path.join(featureDir, "gap-matrix.md");
        if (fs.existsSync(gapMatrixPath) && !options.force) {
          blocked(
            `Tests already exist for ${feature} (gap-matrix.md found).\n  Re-run: gwrk define tests ${feature} --force`,
          );
          throw new CommandError(
            "Tests already exist. Use --force to regenerate.",
            1,
          );
        }

        // Format phase uniformly if provided
        let paddedPhase: string | undefined = undefined;
        if (options.phase) {
          paddedPhase = options.phase.match(/^\d+$/)
            ? `p${options.phase.padStart(2, "0")}`
            : options.phase;
        }

        const config = loadConfig(projectRoot);
        const backend = config.agents.define;
        const runtime = new WorkflowRuntime();

        const startedAt = new Date().toISOString();
        const runId = startRun({
          feature_id: feature,
          command: "define tests",
          agent_backend: backend,
          workflow: "define-tests",
        });

        banner("define tests", {
          Feature: feature,
          Phase: paddedPhase || "All",
          Agent: backend,
        });
        const startTime = Date.now();

        let exitCode = 0;
        try {
          const input = `Generate tests for feature ${feature}${paddedPhase ? ` phase ${paddedPhase}` : ""}`;
          const result = await runtime.executeWorkflow(
            "gwrk-define-tests",
            input,
            {
              agent: backend,
              projectRoot,
            },
          );

          const durationS = Math.round((Date.now() - startTime) / 1000);

          const finishedAt = new Date().toISOString();
          const gitCommit = getCurrentCommit(projectRoot);
          const gitBranch = getCurrentBranch(projectRoot);
          const { filesChanged, linesAdded, linesDeleted } = getDiffStats(
            projectRoot,
            `${gitCommit}~1`,
          );

          const manifestPhase = paddedPhase || "all";
          const manifestId = generateRunId(startedAt, "define", manifestPhase);

          writeManifest(featureDir, {
            runId: manifestId,
            feature,
            phase: manifestPhase,
            command: "define tests",
            agent: backend,
            model: "unknown",
            startedAt,
            finishedAt,
            durationS,
            exitCode: 0,
            attempt: 1,
            filesChanged,
            linesAdded,
            linesDeleted,
            gitCommit,
            gitBranch,
            digest: [],
          });

          // Output contract: gap-matrix.md must exist after successful run
          if (!fs.existsSync(gapMatrixPath)) {
            finishRun(runId, { exit_code: 2, duration_s: durationS });
            fail("define tests", 2, durationS, runId);
            throw new CommandError(
              `Agent exited 0 but did not produce gap-matrix.md. Output contract violated.`,
              2,
            );
          }

          finishRun(runId, { exit_code: 0, duration_s: durationS });
          success("define tests", durationS, runId);
        } catch (err: unknown) {
          const durationS = Math.round((Date.now() - startTime) / 1000);
          const msg = err instanceof Error ? err.message : String(err);
          exitCode = 1;
          finishRun(runId, { exit_code: exitCode, duration_s: durationS });
          fail("define tests", exitCode, durationS, runId);
          console.error(msg);
          process.exitCode = exitCode;
          return;
        }
      });
    },
  );
