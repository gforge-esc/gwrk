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
  generateFilesystemGates,
  generateRunner,
  generateVitestGates,
} from "../utils/gate-gen.js";
import {
  getCurrentBranch,
  getCurrentCommit,
  getDiffStats,
} from "../utils/git.js";
import { generateRunId, writeManifest } from "../utils/manifest.js";
import { resolveFeature } from "../utils/resolve-feature.js";
import { CommandError, withSignal } from "../utils/signal.js";
import { loadTaskState } from "../utils/state.js";

/**
 * gwrk define tasks <feature> — Decompose plan → tasks.json + gates
 *
 * Without flags:      refuses to overwrite existing tasks.json.
 * With --force:       blows away existing tasks.json + gates and regenerates fresh.
 * With --reconcile:   merges new plan into existing tasks, preserving completed status.
 */
export const tasksGenerateCommand = new Command("tasks")
  .description("Decompose plan into tasks.json + gate scripts")
  .addHelpText(
    "after",
    `
Examples:
  gwrk define tasks 001
  gwrk define tasks 001 10
  gwrk define tasks 001 --reconcile
  gwrk define tasks 001 --force --no-llm
`,
  )
  .argument("<feature>", "Feature ID (e.g. 001-cli-core)")
  .argument("[phase]", "Phase number (e.g. 10)")
  .option(
    "-p, --phase <phase>",
    "Specific phase string or number to generate tasks for (e.g. p01 or 1)",
  )
  .option("--force", "Overwrite existing tasks.json and gate scripts")
  .option("--reconcile", "Merge updated plan, preserving completed task status")
  .option(
    "--no-llm",
    "Skip LLM gate authoring (writes tasks.json only, no gates)",
  )
  .action(
    async (
      featureArg: string,
      phaseArg: string | undefined,
      opts: {
        force?: boolean;
        reconcile?: boolean;
        llm?: boolean;
        phase?: string;
      },
    ) => {
      await withSignal(`define tasks ${featureArg}`, async () => {
        const projectRoot = process.cwd();
        // Resolve prefix: "003" → "003-slack"
        const feature = resolveFeature(featureArg, projectRoot);
        const featureDir = path.join(projectRoot, "specs", feature);
        const planPath = path.join(featureDir, "plan.md");

        // Format phase uniformly to p0X if it's just a number (positional takes precedence)
        const rawPhase = phaseArg || opts.phase;
        let paddedPhase: string | undefined = undefined;
        if (rawPhase) {
          paddedPhase = rawPhase.match(/^\d+$/)
            ? `p${rawPhase.padStart(2, "0")}`
            : rawPhase;
        }

        // Guard: ADR-005 §8.4 — define tests must run before define tasks
        const gapMatrixPath = path.join(featureDir, "gap-matrix.md");
        const runsManifestDir = path.join(featureDir, ".gwrk", "runs");
        const hasTestFiles = (() => {
          try {
            const srcDir = path.join(projectRoot, "src");
            if (!fs.existsSync(srcDir)) return false;
            const allFiles = fs.readdirSync(srcDir);
            return allFiles.some(
              (f) => f.endsWith(".test.ts") && !f.startsWith("cli.e2e"),
            );
          } catch {
            return false;
          }
        })();
        const testsRan =
          fs.existsSync(gapMatrixPath) ||
          fs.existsSync(runsManifestDir) ||
          hasTestFiles;
        if (!testsRan) {
          blocked(
            `RED tests must exist before generating tasks (ADR-005 §8.4).\n  Run: gwrk define tests ${feature}`,
          );
          throw new CommandError(
            `Run 'gwrk define tests ${feature}' first. See ADR-005 §8.4.`,
            1,
          );
        }

        banner("define tasks", {
          Feature: feature,
          Phase: paddedPhase || "All",
        });
        const startTime = Date.now();
        const startedAt = new Date().toISOString();

        const config = loadConfig(projectRoot);
        const backend = config.agents.define;

        const runId = startRun({
          feature_id: feature,
          command: "define tasks",
          agent_backend: backend,
          workflow: "plan-to-tasks",
        });
try {
  const input = `Decompose plan for feature ${feature}${paddedPhase ? ` phase ${paddedPhase}` : ""}${opts.force ? " --force" : ""}${opts.reconcile ? " --reconcile" : ""}`;

  const orchestrator = new DefineOrchestrator({
    featureId: feature,
    backend,
    cwd: projectRoot,
  }, {
    stage: DefineStage.PLAN_TO_TASKS,
    featureId: feature,
    startedAt,
    runId: `define-tasks-${feature}-${Date.now()}`,
    backend,
  });

  const exitCode = await orchestrator.runLoop(input, { stopAfterOne: true });

  if (exitCode !== 0) {
    throw new Error(`Workflow execution failed with exit code ${exitCode}`);
  }

  // ── Deterministic gate generation (Block 0C) ──
  // After tasks.json is written by the agent, generate vitest gates
  // deterministically. This replaces LLM gate authoring entirely.
  try {
    const state = loadTaskState(featureDir);
    const gapMatrixPath = path.join(featureDir, "gap-matrix.md");

    let gateResult: { generated: number; skipped: number };
    if (fs.existsSync(gapMatrixPath)) {
      console.error("  ▸ generating vitest gates from gap-matrix.md");
      gateResult = generateVitestGates(featureDir, gapMatrixPath, state.phases);
    } else {
      console.error("  ▸ generating vitest gates from filesystem convention");
      gateResult = generateFilesystemGates(featureDir, state.phases);
    }

    // Regenerate the run-all-gates.sh runner
    const gatesDir = path.join(featureDir, "gates");
    if (fs.existsSync(gatesDir)) {
      generateRunner(gatesDir);
    }

    console.error(`  ✓ gates: ${gateResult.generated} generated, ${gateResult.skipped} skipped`);
  } catch (gateError) {
    console.warn(`  ⚠ gate generation failed (non-fatal): ${gateError}`);
  }

          const durationS = Math.round((Date.now() - startTime) / 1000);
          finishRun(runId, { exit_code: 0, duration_s: durationS });
          success("define tasks", durationS, runId);

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
            const manifestId = generateRunId(
              startedAt,
              "define",
              manifestPhase,
            );

            writeManifest(featureDir, {
              runId: manifestId,
              feature,
              phase: manifestPhase,
              command: "define tasks",
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
          } catch (manifestError) {
            console.warn(
              `Warning: Could not write execution manifest: ${manifestError}`,
            );
          }

          const planStore = new PlanStore();
          planStore.handleDefineComplete({
            featureId: feature,
            status: "DEFINED",
          });
        } catch (error: unknown) {
          const durationS = Math.round((Date.now() - startTime) / 1000);
          const message =
            error instanceof Error ? error.message : String(error);
          finishRun(runId, { exit_code: 1, duration_s: durationS });
          fail("define tasks", 1, durationS, runId);
          throw new CommandError(`Error generating tasks: ${message}`, 1);
        }
      });
    },
  );
