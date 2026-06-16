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
import { loadConfig } from "../utils/config.js";
import { banner, blocked, fail, success } from "../utils/format.js";
import {
  extractPhaseFiles,
  extractPhaseRequirements,
  extractPhaseSection,
  extractSpecSections,
} from "../utils/parser.js";
import { resolveFeature } from "../utils/resolve-feature.js";
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
  .action(
    async (
      featureArg: string,
      phaseArg: string | undefined,
      options: { phase?: string; force?: boolean },
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
        const runsManifestDir = path.join(featureDir, ".gwrk", "runs");
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

        // Staleness check: if plan.md is newer than the most recent test artifact
        // (gap-matrix OR run manifest), the plan changed and tests should be
        // regenerable without --force.
        const planMtime = fs.statSync(planPath).mtimeMs;
        const latestTestArtifactMtime = (() => {
          let latest = 0;
          if (fs.existsSync(gapMatrixPath)) {
            latest = Math.max(latest, fs.statSync(gapMatrixPath).mtimeMs);
          }
          if (fs.existsSync(runsManifestDir)) {
            try {
              const files = fs.readdirSync(runsManifestDir);
              for (const f of files) {
                if (f.includes("define tests") || f.includes("define_tests")) {
                  const fpath = path.join(runsManifestDir, f);
                  latest = Math.max(latest, fs.statSync(fpath).mtimeMs);
                }
              }
            } catch { /* ignore */ }
          }
          return latest;
        })();

        const planIsNewer = latestTestArtifactMtime > 0 && planMtime > latestTestArtifactMtime;

        const testsExist =
          !planIsNewer && (
            latestTestArtifactMtime > 0 ||
            (hasTestFiles && !options.force)
          );

        if (testsExist && !options.force && !rawPhase) {
          blocked(
            `Tests already exist for ${feature} (artifacts found).\n  Re-run: gwrk define tests ${feature} --force`,
          );
          throw new CommandError(
            "Tests already exist. Use --force to regenerate.",
            1,
          );
        }

        // Format phase uniformly if provided (positional takes precedence over --phase)
        let paddedPhase: string | undefined = undefined;
        if (rawPhase) {
          paddedPhase = rawPhase.match(/^\d+$/)
            ? `p${rawPhase.padStart(2, "0")}`
            : rawPhase;
        }

        const config = loadConfig(projectRoot);
        const backend = config.agents.define;
        const model = resolveModelForTask("define", backend, projectRoot);

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
          // Build structured input with phase-scoped context when --phase is provided.
          // Without this, the agent reads the full 500+ line plan and goes rogue.
          let input: string;
          if (paddedPhase) {
            const phaseNum = Number.parseInt(
              paddedPhase.replace(/^p0*/, ""),
              10,
            );
            const phaseSection = extractPhaseSection(planPath, phaseNum);
            const reqIds = phaseSection
              ? extractPhaseRequirements(phaseSection)
              : [];
            const specContext = extractSpecSections(specPath, reqIds);

            input = [
              `Generate RED tests for feature ${feature} phase ${paddedPhase}`,
              "",
              "SCOPE CONSTRAINT: Generate tests ONLY for the phase below.",
              "Do NOT read the full plan.md or spec.md — all relevant context is provided here.",
              "Do NOT modify any production source files (src/**/*.ts excluding *.test.ts).",
              "",
              "## Plan Section (Phase Only)",
              "",
              phaseSection || "(Phase not found in plan.md)",
              "",
              reqIds.length > 0
                ? [
                    "## Relevant Spec Requirements",
                    "",
                    specContext || "(No matching spec sections found)",
                  ].join("\n")
                : "",
            ]
              .filter(Boolean)
              .join("\n");
          } else {
            input = `Generate tests for feature ${feature}`;
          }
          const orchestrator = new DefineOrchestrator({
            featureId: feature,
            backend,
            model,
            cwd: projectRoot,
          }, {
            stage: DefineStage.DEFINE_TESTS,
            featureId: feature,
            startedAt,
            runId: `define-tests-${feature}-${Date.now()}`,
            backend,
          });

          const exitCode = await orchestrator.runLoop(input, { stopAfterOne: true });

          if (exitCode !== 0) {
            throw new Error(`Workflow execution failed with exit code ${exitCode}`);
          }

          // Post-execution guardrail: revert non-test modifications to src/
          // The define-tests agent sometimes overwrites production source files
          // using native tools (bypassing the JSON intent engine). Detect and
          // revert any src/ file that isn't a test file.
          try {
            const changedFiles = execSync(
              "git diff --name-only HEAD",
              { cwd: projectRoot, encoding: "utf-8" },
            ).trim().split("\n").filter(Boolean);

            const illegal = changedFiles.filter((f) => {
              // Allow test files
              if (f.endsWith(".test.ts") || f.endsWith(".spec.ts")) return false;
              // Allow e2e tests
              if (f.startsWith("e2e/") || f.startsWith("tests/e2e/")) return false;
              // Allow spec artifacts (gap-matrix, etc.)
              if (f.startsWith("specs/")) return false;
              // Everything else in src/ is illegal for define-tests
              if (f.startsWith("src/")) return true;
              return false;
            });

            if (illegal.length > 0) {
              execSync(
                `git checkout HEAD -- ${illegal.map((f) => `"${f}"`).join(" ")}`,
                { cwd: projectRoot },
              );
              console.warn(
                `  ⚠ Reverted ${illegal.length} non-test file(s) modified by agent: ${illegal.join(", ")}`,
              );
            }
          } catch {
            // Guard is best-effort — don't fail the command if git ops fail
          }

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

          // Output contract: agent must produce EITHER gap-matrix.md OR new test files
          // The agent may write test files directly into src/ without a gap-matrix artifact
          const hasGapMatrix = fs.existsSync(gapMatrixPath);
          const hasNewTestFiles = (() => {
            try {
              const srcDir = path.join(projectRoot, "src");
              if (!fs.existsSync(srcDir)) return false;
              return fs.readdirSync(srcDir).some((f) => f.endsWith(".test.ts"));
            } catch {
              return false;
            }
          })();

          if (!hasGapMatrix && !hasNewTestFiles) {
            finishRun(runId, { exit_code: 2, duration_s: durationS });
            fail("define tests", 2, durationS, runId);
            throw new CommandError(
              "Agent exited 0 but produced no test artifacts (gap-matrix.md or *.test.ts files).",
              2,
            );
          }

          // Mechanical Enforcement: Prevent production source modification
          const diffOutput = execSync("git status --porcelain", {
            cwd: projectRoot,
            encoding: "utf-8",
          }).trim();

          if (diffOutput) {
            const rogueModifications = diffOutput.split("\n").filter((line) => {
              const file = line.slice(3);
              return (
                file.startsWith("src/") &&
                file.endsWith(".ts") &&
                !file.endsWith(".test.ts")
              );
            });

            if (rogueModifications.length > 0) {
              execSync("git restore src/", {
                cwd: projectRoot,
                stdio: "ignore",
              });
              finishRun(runId, { exit_code: 2, duration_s: durationS });
              fail("define tests", 2, durationS, runId);
              throw new CommandError(
                `Agent violated guardrails and modified production code:\n${rogueModifications.join(
                  "\n",
                )}\nChanges to src/ reverted.`,
                2,
              );
            }

            // If valid, orchestrator commits the tests
            execSync("git add -A", { cwd: projectRoot });
            execSync(
              `git commit --author="$(git config user.name) <$(git config user.email)>" -m "test(${feature}): red tests for phase ${manifestPhase}"`,
              {
                cwd: projectRoot,
                env: { ...process.env, GWRK_SHIP: "1" },
                stdio: "ignore",
              },
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
