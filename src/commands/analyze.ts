/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Command } from "commander";
import { finishRun, startRun } from "../db/runs.js";
import { DefineOrchestrator } from "../engine/define-orchestrator.js";
import { DefineStage } from "../engine/define-types.js";
import { loadConfig } from "../utils/config.js";
import { banner, fail, success } from "../utils/format.js";
import { resolveFeature } from "../utils/resolve-feature.js";
import { resolveModelForTask } from "../utils/resolve-model.js";
import { CommandError, withSignal } from "../utils/signal.js";

/**
 * gwrk define analyze <feature> — Internal definition stage (hidden)
 */
export const analyzeCommand = new Command("analyze")
  .description("Analyze consistency for a feature specification and plan")
  .argument("<feature>", "Feature ID (e.g. 001-cli-core)")
  .option("--dry-run", "Print the command without executing")
  .action(async (featureArg: string, opts: { dryRun?: boolean }) => {
    await withSignal("define analyze", async () => {
      const projectRoot = process.cwd();
      const feature = resolveFeature(featureArg, projectRoot);

      const config = loadConfig(projectRoot);
      const backend = config.agents.define;
      const model = resolveModelForTask("define", backend, projectRoot);

      const runId = startRun({
        feature_id: feature,
        command: "define analyze",
        agent_backend: backend,
        workflow: "gwrk-analyze",
      });

      banner("define analyze", {
        Feature: feature,
        Agent: backend,
        "Run ID": `${runId}`,
      });

      const startTime = Date.now();
      const startedAt = new Date().toISOString();

      try {
        const orchestrator = new DefineOrchestrator(
          {
            featureId: feature,
            backend,
            model,
            cwd: projectRoot,
            dryRun: opts.dryRun,
          },
          {
            stage: DefineStage.ANALYZE,
            featureId: feature,
            startedAt,
            runId: `define-analyze-${feature}-${Date.now()}`,
            backend,
          },
        );

        const exitCode = await orchestrator.runLoop(undefined, {
          stopAfterOne: true,
        });

        if (exitCode !== 0) {
          throw new Error(`Workflow execution failed with exit code ${exitCode}`);
        }

        if (opts.dryRun) {
          return;
        }

        const durationS = Math.round((Date.now() - startTime) / 1000);
        finishRun(runId, { exit_code: 0, duration_s: durationS });
        success("define analyze", durationS, runId);
      } catch (error: unknown) {
        const durationS = Math.round((Date.now() - startTime) / 1000);
        const message = error instanceof Error ? error.message : String(error);
        finishRun(runId, { exit_code: 1, duration_s: durationS });
        fail("define analyze", 1, durationS, runId);
        throw new CommandError(`Error in analyze stage: ${message}`, 1);
      }
    });
  });
