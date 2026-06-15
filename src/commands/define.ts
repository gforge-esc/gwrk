import path from "node:path";
import { Command } from "commander";
import { finishRun, recordHistory, startRun } from "../db/runs.js";
import { DefineOrchestrator } from "../engine/define-orchestrator.js";
import { PlanStore } from "../engine/plan-store.js";
import { loadConfig } from "../utils/config.js";
import { run } from "../utils/exec.js";
import { banner, dryRun as dryRunFmt, fail, success } from "../utils/format.js";
import {
  getCurrentBranch,
  getCurrentCommit,
  getDiffStats,
} from "../utils/git.js";
import { generateRunId, writeManifest } from "../utils/manifest.js";

import { definePlanCommand } from "./define-plan.js";
// Subcommands — each is a standalone user action
import { specifyCommand } from "./specify.js";
import { tasksGenerateCommand } from "./tasks-generate.js";
import { testsGenerateCommand } from "./tests-generate.js";
import { researchCommand } from "./research.js";

import { defineOntologyCommand } from "./define-ontology.js";

import { resolveFeature } from "../utils/resolve-feature.js";
import { resolveProjectId } from "../utils/project-id.js";
import { resolveModelForTask } from "../utils/resolve-model.js";
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
  .addHelpText(
    "after",
    `
Examples:
  gwrk define 001
  gwrk define 001-cli-core --refs docs/grounding/
  gwrk define spec 001
  gwrk define plan 001
  gwrk define tasks 001
`,
  )
  .argument("[feature]", "Feature ID (e.g. 001-cli-core)")
  .option("--refs <path>", "Path to additional reference docs")
  .option("--dry-run", "Print the command without executing")
  .action(
    async (
      featureArg: string | undefined,
      opts: { dryRun?: boolean; refs?: string },
    ) => {
      await withSignal("define", async () => {
        if (!featureArg) {
          throw new CommandError(
            "Feature ID required. Run 'gwrk project specs' to list available features.",
            2,
          );
        }

        const cwd = process.cwd();
        // Resolve prefix: "003" → "003-slack"
        const feature = resolveFeature(featureArg, cwd);
        const config = loadConfig(cwd);
        const backend = config.agents.define;
        const model = resolveModelForTask("define", backend, cwd);

        const startedAt = new Date().toISOString();
        const runId = startRun({
          feature_id: feature,
          command: "define",
          agent_backend: backend,
          workflow: "define-orchestrator",
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
          const orchestrator = new DefineOrchestrator({
            featureId: feature,
            backend,
            model,
            cwd,
            refs: opts.refs,
            dryRun: opts.dryRun,
          });

          const planStore = new PlanStore(resolveProjectId(cwd));
          orchestrator.on("plan:define:complete", (event) => {
            planStore.handleDefineComplete(event);
          });

          exitCode = await orchestrator.run();

          const durationS = Math.round((Date.now() - startTime) / 1000);
          finishRun(runId, { exit_code: exitCode, duration_s: durationS });
          if (exitCode === 0) {
            success("define", durationS, runId);
          } else {
            fail("define", exitCode, durationS, runId);
          }
        } catch (error: unknown) {
          const durationS = Math.round((Date.now() - startTime) / 1000);
          exitCode = 1;
          finishRun(runId, { exit_code: exitCode, duration_s: durationS });
          fail("define", exitCode, durationS, runId);
          console.error(error);
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
defineCommand.addCommand(definePlanCommand); // gwrk define plan
defineCommand.addCommand(tasksGenerateCommand); // gwrk define tasks
defineCommand.addCommand(testsGenerateCommand); // gwrk define tests
defineCommand.addCommand(researchCommand); // gwrk define research

const ontologyCommand = new Command("ontology")
  .description("Define project domain ontology (classes, properties, relations)")
  .option("--run", "Execute automated construction workflow")
  .option("--agent <agent>", "Override agent")
  .option("--model <model>", "Override model")
  .action(defineOntologyCommand);

defineCommand.addCommand(ontologyCommand);
