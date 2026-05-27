import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { finishRun, startRun } from "../db/runs.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import { loadConfig } from "../utils/config.js";
import { banner, blocked, fail, success } from "../utils/format.js";
import {
  extractPhaseRequirements,
  extractPhaseSection,
  extractSpecSections,
} from "../utils/parser.js";
import { resolveFeature } from "../utils/resolve-feature.js";
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
  gwrk define tests 001-cli-core --phase 1
  gwrk define tests 001 --force
`,
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
    async (
      featureArg: string,
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
                (f.includes(feature) || f.endsWith(".test.ts")) &&
                !f.startsWith("cli.e2e"),
            );
          } catch {
            return false;
          }
        })();

        const testsExist =
          fs.existsSync(gapMatrixPath) ||
          fs.existsSync(runsManifestDir) ||
          (hasTestFiles && !options.force);

        if (testsExist && !options.force) {
          blocked(
            `Tests already exist for ${feature} (artifacts found).\n  Re-run: gwrk define tests ${feature} --force`,
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
          const result = await runtime.executeWorkflow(
            "gwrk-define-tests",
            input,
            {
              agent: backend,
              projectRoot,
              quiet: true,
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
