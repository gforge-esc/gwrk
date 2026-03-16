import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { finishRun, startRun } from "../db/runs.js";
import { dispatchAgent } from "../utils/agent.js";
import { loadConfig } from "../utils/config.js";
import { banner, blocked, fail, success } from "../utils/format.js";
import { loadTaskState } from "../utils/state.js";

import { CommandError, withSignal } from "../utils/signal.js";
import { generateRunId, writeManifest } from "../utils/manifest.js";
import { getCurrentBranch, getCurrentCommit, getDiffStats } from "../utils/git.js";

/**
 * gwrk define tests <feature> [options] — Generate RED test files from spec/plan
 */
export const testsGenerateCommand = new Command("tests")
  .description("Generate RED test files for a whole feature (or specific phase)")
  .argument("<feature>", "Feature ID (e.g. 001-cli-core)")
  .option("-p, --phase <phase>", "Specific phase string or number to generate tests for (e.g. p01 or 1)")
  .action(async (feature: string, options: { phase?: string }) => {
    await withSignal(`define tests ${feature}`, async () => {
      const projectRoot = process.cwd();
      const relativeFeatureDir = path.join("specs", feature);
      const featureDir = path.join(projectRoot, relativeFeatureDir);
      
      const specPath = path.join(featureDir, "spec.md");
      const planPath = path.join(featureDir, "plan.md");
      const tasksPath = path.join(featureDir, ".gwrk", "tasks.json");

      if (!fs.existsSync(specPath) || !fs.existsSync(planPath) || !fs.existsSync(tasksPath)) {
        blocked("Missing required files (spec.md, plan.md, or tasks.json)");
        throw new CommandError(
          "spec, plan, and tasks must exist before generating tests. Run 'gwrk define tasks' first.",
          1,
        );
      }

      // Format phase uniformly if provided
      let paddedPhase: string | undefined = undefined;
      if (options.phase) {
        paddedPhase = options.phase.match(/^\d+$/) ? `p${options.phase.padStart(2, '0')}` : options.phase;
      }

      const config = loadConfig(projectRoot);
      const backend = config.agents.define;

      const startedAt = new Date().toISOString();
      const runId = startRun({
        feature_id: feature,
        command: "define tests",
        agent_backend: backend,
        workflow: "define-tests",
      });

      banner("define tests", { Feature: feature, Phase: paddedPhase || "All", Agent: backend });
      const startTime = Date.now();

      const result = await dispatchAgent({
        backend,
        workflowPath: ".agents/workflows/define-tests.md",
        featureDir: relativeFeatureDir,
        contextPath: paddedPhase, // Optional: restricts context to specific phase if provided
      });

      const durationS = Math.round((Date.now() - startTime) / 1000);
      const exitCode = result.exitCode;

      try {
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
          exitCode,
          attempt: 1,
          filesChanged,
          linesAdded,
          linesDeleted,
          gitCommit,
          gitBranch,
          digest: [],
        });
      } catch (err) {
         console.warn(`Warning: Could not write execution manifest: ${err}`);
      }

      if (exitCode !== 0) {
        finishRun(runId, { exit_code: exitCode, duration_s: durationS });
        fail("define tests", exitCode, durationS, runId, result.logPath);
        process.exitCode = exitCode;
        return;
      }

      finishRun(runId, { exit_code: 0, duration_s: durationS });
      success("define tests", durationS, runId, result.logPath);
    });
  });
