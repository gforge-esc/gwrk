/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { finishRun, startRun } from "../db/runs.js";
import { DefineOrchestrator } from "../engine/define-orchestrator.js";
import { DefineStage } from "../engine/define-types.js";
import { PlanStore } from "../engine/plan-store.js";
import { loadConfig } from "../utils/config.js";
import { banner, blocked, fail, success } from "../utils/format.js";
import {
  extractPhaseFiles,
  extractPhaseRequirements,
  extractPhaseSection,
  extractSpecSections,
} from "../utils/parser.js";
import { resolveFeature } from "../utils/resolve-feature.js";
import { resolveProjectId } from "../utils/project-id.js";
import { resolveModelForTask } from "../utils/resolve-model.js";
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
  .addHelpText(
    "after",
    `
Examples:
  gwrk define tests 001
  gwrk define tests 001 10
  gwrk define tests 001 --phase 10 --force
`,
  )
  .argument("<feature>", "Feature ID (e.g. 001-cli-core)")
  .argument("[phase]", "Phase number (e.g. 10)")
  .option(
    "-p, --phase <phase>",
    "Specific phase string or number to generate tests for (e.g. p01 or 1)",
  )
  .option(
    "--force",
    "Overwrite existing test artifacts (gap-matrix.md, test files)",
  )
  .option("--dry-run", "Print the command without executing")
  .action(
    async (
      featureArg: string,
      phaseArg: string | undefined,
      options: { phase?: string; force?: boolean; dryRun?: boolean },
    ) => {
      await withSignal(`define tests ${featureArg}`, async () => {
        const projectRoot = process.cwd();
        // Resolve prefix: "001" → "001-cli-core"
        const feature = resolveFeature(featureArg, projectRoot);
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

        // Guard: refuse to overwrite existing tests without --force (ADR-005 §8.4)
        // When a specific phase is targeted, skip this guard — the user is adding
        // tests for a new phase, not regenerating existing ones.
        const rawPhase = phaseArg || options.phase;
        const gapMatrixPath = path.join(featureDir, "gap-matrix.md");
        const hasTestFiles = (() => {
          try {
            const srcDir = path.join(projectRoot, "src");
            if (!fs.existsSync(srcDir)) return false;
            const allFiles = fs.readdirSync(srcDir);
            // Look for tests that match the feature ID or are generally feature tests
            return allFiles.some(
              (f) =>
                f.includes(feature) && f.endsWith(".test.ts"),
            );
          } catch {
            return false;
          }
        })();

        // NOTE: do NOT treat specs/<feature>/.gwrk/runs/ as evidence of tests.
        // That directory holds an execution manifest for EVERY define stage
        // (spec, plan, tests…), so it exists after `define spec`/`define plan`
        // on every feature — using it here blocked the first, legitimate
        // `define tests` run for any feature that had been specced/planned.
        // The real test-stage signals are gap-matrix.md and actual test files.
        const testsAlreadyExist =
          fs.existsSync(gapMatrixPath) || hasTestFiles;

        if (testsAlreadyExist && !rawPhase && !options.force && !options.dryRun) {
          blocked(
            `Test artifacts already exist for ${feature}. Use --force to overwrite.`,
          );
          throw new CommandError(
            `Test artifacts already exist. Use --force to overwrite.`,
            1,
          );
        }

        // Format phase uniformly to p0X if it's just a number
        let paddedPhase: string | undefined = undefined;
        if (rawPhase) {
          paddedPhase = rawPhase.match(/^\d+$/)
            ? `p${rawPhase.padStart(2, "0")}`
            : rawPhase;
        }

        banner("define tests", {
          Feature: feature,
          Phase: paddedPhase || "All",
          "Dry Run": options.dryRun ? "Yes" : "No",
        });

        const startTime = Date.now();
        const startedAt = new Date().toISOString();

        const config = loadConfig(projectRoot);
        const backend = config.agents.define;
        const model = resolveModelForTask("define", backend, projectRoot);

        const runId = startRun({
          feature_id: feature,
          command: "define tests",
          agent_backend: backend,
          workflow: "define-tests",
        });

        try {
          const orchestrator = new DefineOrchestrator({
            featureId: feature,
            backend,
            model,
            cwd: projectRoot,
            dryRun: options.dryRun,
            quiet: true,
            tolerant: true,
          }, {
            stage: DefineStage.DEFINE_TESTS,
            featureId: feature,
            startedAt,
            runId: `define-tests-${feature}-${Date.now()}`,
            backend,
          });

          const input = `Generate tests for feature ${feature}${paddedPhase ? ` phase ${paddedPhase}` : ""}${options.force ? " --force" : ""}`;
          const exitCode = await orchestrator.runLoop(input, { stopAfterOne: true });

          if (exitCode !== 0) {
            // T015: Detect agent-native success by checking for committed test files
            // even when JSON parsing fails (which causes exitCode 1 in non-tolerant mode)
            const hasTests = (() => {
              try {
                const srcDir = path.join(projectRoot, "src");
                if (!fs.existsSync(srcDir)) return false;
                const allFiles = fs.readdirSync(srcDir);
                // Look for tests that match the feature ID or are generally feature tests
                return allFiles.some(
                  (f) => f.includes(feature) && f.endsWith(".test.ts"),
                );
              } catch {
                return false;
              }
            })();

            if (hasTests) {
              console.warn(
                `[define tests] Workflow returned ${exitCode} but test files were detected. Treating as success (native execution).`,
              );
            } else {
              throw new Error(
                `Workflow execution failed with exit code ${exitCode}`,
              );
            }
          }

          if (options.dryRun) {
            return;
          }

          const durationS = Math.round((Date.now() - startTime) / 1000);
          finishRun(runId, { exit_code: 0, duration_s: durationS });
          success("define tests", durationS, runId);

          // Write Execution Manifest (ADR-003)
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
              model: model || "unknown",
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
          } catch (manifestError) {
            console.warn(
              `Warning: Could not write execution manifest: ${manifestError}`,
            );
          }

          // Define must always leave a clean working tree
          try {
            execSync("git add -A", { cwd: projectRoot });
            execSync(
              `git commit --author="$(git config user.name) <$(git config user.email)>" -m "chore(${feature}): define tests execution manifest"`,
              {
                cwd: projectRoot,
                env: { ...process.env, GWRK_SHIP: "1" },
                stdio: "ignore",
              },
            );
          } catch {
            // Non-fatal
          }

          const planStore = new PlanStore(resolveProjectId(projectRoot));
          planStore.handleDefineComplete({
            featureId: feature,
            status: "DEFINED",
          });
        } catch (error: unknown) {
          const durationS = Math.round((Date.now() - startTime) / 1000);
          const message = error instanceof Error ? error.message : String(error);
          finishRun(runId, { exit_code: 1, duration_s: durationS });
          fail("define tests", 1, durationS, runId);
          throw new CommandError(`Error generating tests: ${message}`, 1);
        }
      });
    },
  );
