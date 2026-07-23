/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { recordHistory } from "../db/runs.js";
import { runGate } from "../utils/gate-runner.js";
import { isHollowGate } from "../utils/gate-quality.js";
import { color, fail, success } from "../utils/format.js";
import {
  getCurrentBranch,
  getCurrentCommit,
  getDiffStats,
} from "../utils/git.js";
import { appendHistory } from "../utils/history.js";
import {
  generateRunId,
  loadManifests,
  writeManifest,
} from "../utils/manifest.js";
import {
  contentHash,
  listTasks,
  loadTaskState,
  markTaskComplete,
  nextTask,
  saveTaskState,
} from "../utils/state.js";
import type { Task, TaskState } from "../utils/state.js";

import { createOutput, resolveFormat } from "../utils/output.js";
import { resolveFeature } from "../utils/resolve-feature.js";
import { CommandError, withSignal } from "../utils/signal.js";

export const tasksCommand = new Command("tasks")
  .description("Query and manage task state")
  .addHelpText(
    "after",
    `
Type: query/mutator
Format: use gwrk --format json for structured output
Exit codes:
  0: Success
  1: Task not found or gate failed
  2: Usage error

Examples:
  gwrk tasks list 001
  gwrk tasks next 001 1
  gwrk tasks done 001 T001
  gwrk tasks verify 001
`,
  );

// generate is now under \`gwrk define tasks\` — see tasks-generate.ts

tasksCommand
  .command("done <feature> <taskId>")
  .description("Mark a task as complete if the gate passes")
  .addHelpText(
    "after",
    `
Examples:
  gwrk tasks done 001 T001
  gwrk tasks done 001-cli-core T042
`,
  )
  .action(async (featureInput: string, taskId: string) => {
    await withSignal("tasks done", async () => {
      const startedAt = new Date().toISOString();
      const startTime = Date.now();
      const projectRoot = process.cwd();
      const feature = resolveFeature(featureInput, projectRoot);
      const featureDir = path.join(projectRoot, "specs", feature);

      let state: TaskState;
      try {
        state = loadTaskState(featureDir);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CommandError(
          `Error loading task state: ${message}. Run 'gwrk define tasks ${feature}' to generate.`,
          1,
        );
      }

      const allTasks = listTasks(state);
      const task = allTasks.find((t) => t.id === taskId);

      if (!task) {
        throw new CommandError(
          `Task ${taskId} not found in tasks.json. Run 'gwrk tasks list ${feature}' to list available tasks.`,
          1,
        );
      }

      const phase = state.phases.find((p) =>
        p.tasks.some((t) => t.id === taskId),
      );
      if (!phase) {
        throw new CommandError(`Phase for task ${taskId} not found`, 1);
      }

      if (task.status === "completed") {
        throw new CommandError(`Task ${taskId} already completed`, 1);
      }

      const gateScript = path.join(featureDir, task.gateScript);

      // FR-001: Reject gates that contain only `test -f` assertions
      if (fs.existsSync(gateScript)) {
        const gateContent = fs.readFileSync(gateScript, "utf-8");
        if (isHollowGate(gateContent)) {
          throw new CommandError(
            `FAIL: ${taskId} — gate contains only test -f, not a functional assertion`,
            1,
          );
        }
      }

      const result = await runGate(gateScript);

      if (!result.passed) {
        if (result.exitCode === 127) {
          throw new CommandError(
            `CRITICAL: gates/${taskId}-gate.sh not found`,
            1,
          );
        }
        if (result.output) process.stderr.write(result.output);
        throw new CommandError(
          `Gate failed for ${taskId}. State unchanged.`,
          1,
        );
      }

      try {
        const newState = markTaskComplete(state, taskId);
        saveTaskState(featureDir, newState);

        // Record in history (legacy JSONL + new SQLite via appendHistory update)
        appendHistory({
          timestamp: new Date().toISOString(),
          featureId: feature,
          taskId: taskId,
          fromStatus: task.status as
            | "open"
            | "in_progress"
            | "completed"
            | "cancelled",
          toStatus: "completed",
        });

        // Write Execution Manifest (ADR-003) to satisfy 'tasks verify'
        try {
          const finishedAt = new Date().toISOString();
          const durationS = Math.round((Date.now() - startTime) / 1000);
          const gitCommit = getCurrentCommit(projectRoot);
          const gitBranch = getCurrentBranch(projectRoot);
          const { filesChanged, linesAdded, linesDeleted } = getDiffStats(
            projectRoot,
            gitCommit === "unknown" ? "HEAD" : `${gitCommit}`,
          );

          const manifestId = `${startedAt}_tasks-done_${taskId}`;

          writeManifest(featureDir, {
            runId: manifestId,
            feature,
            phase: phase.id,
            command: "tasks-done",
            agent: "manual",
            model: "none",
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

        console.log(`Task ${taskId} marked as completed`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CommandError(`Error marking task complete: ${message}`, 1);
      }
    });
  });

tasksCommand
  .command("verify <feature>")
  .description("Validate execution manifests and task coverage")
  .addHelpText(
    "after",
    `
Examples:
  gwrk tasks verify 001
  gwrk tasks verify 001-cli-core
`,
  )
  .action(async (featureInput: string) => {
    await withSignal("tasks verify", async () => {
      const projectRoot = process.cwd();
      const feature = resolveFeature(featureInput, projectRoot);
      const featureDir = path.join(projectRoot, "specs", feature);

      if (!fs.existsSync(featureDir)) {
        throw new CommandError(
          `Feature directory not found: ${featureDir}. Run 'gwrk project specs' to list available features.`,
          1,
        );
      }

      let state: TaskState;
      try {
        state = loadTaskState(featureDir);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CommandError(`Task state invalid: ${message}`, 1);
      }

      const manifests = loadManifests(featureDir);
      const allTasks = listTasks(state);
      const completedTasks = allTasks.filter((t) => t.status === "completed");

      const { GREEN, RED, RESET, BOLD, YELLOW, DIM } = color;
      console.log(`Verifying ${BOLD}${feature}${RESET}...`);

      const issues: string[] = [];
      const successfulShipPhases = new Set(
        manifests
          .filter((m) => m.exitCode === 0 && m.command === "ship")
          .map((m) => m.phase),
      );

      const successfulTasksDone = new Set(
        manifests
          .filter((m) => m.exitCode === 0 && m.command === "tasks-done")
          .map((m) => {
            const parts = m.runId.split("_tasks-done_");
            return parts.length > 1 ? parts[1] : null;
          })
          .filter(Boolean),
      );

      // Check 1: Every completed task has a corresponding execution manifest
      for (const task of completedTasks) {
        const phase = state.phases.find((p) =>
          p.tasks.some((t) => t.id === task.id),
        );
        if (
          phase &&
          !successfulShipPhases.has(phase.id) &&
          !successfulTasksDone.has(task.id)
        ) {
          issues.push(
            `Task ${BOLD}${task.id}${RESET} is ${GREEN}completed${RESET} but no successful manifest found (ship phase or tasks-done)`,
          );
        }
      }

      // Check 2: Orphaned/Regressed tasks (ship manifest exists but task is not completed)
      for (const phase of state.phases) {
        if (successfulShipPhases.has(phase.id)) {
          const openTasks = phase.tasks.filter(
            (t) => t.status === "open" || t.status === "in_progress",
          );
          if (openTasks.length > 0) {
            for (const task of openTasks) {
              issues.push(
                `Task ${BOLD}${task.id}${RESET} is ${YELLOW}${task.status}${RESET} but ${phase.id} has a successful ship manifest (Regressed/Orphaned)`,
              );
            }
          }
        }
      }

      console.log(`  Found ${manifests.length} manifests`);
      console.log(`  Found ${completedTasks.length} completed tasks`);

      if (issues.length === 0) {
        success("verify", 0, 0);
      } else {
        console.log("");
        for (const issue of issues) {
          console.log(`  ${RED}✗${RESET} ${issue}`);
        }
        console.log("");
        fail("verify", 1, 0, 0);
        throw new CommandError(
          `Verification failed with ${issues.length} issues`,
          1,
        );
      }
    });
  });

/** Check if tasks.json was generated from the current plan.md */
function checkDrift(
  featureDir: string,
  state: TaskState,
  feature: string,
): void {
  const planPath = path.join(featureDir, "plan.md");
  if (!state.generatedFrom?.plan || !fs.existsSync(planPath)) return;

  const currentHash = contentHash(planPath);
  if (currentHash !== state.generatedFrom.plan.hash) {
    const { YELLOW, DIM, RESET, BOLD } = color;
    console.log(
      `${YELLOW}⚠ plan.md has changed since tasks were generated${RESET}`,
    );
    console.log(
      `${DIM}  Run: ${BOLD}gwrk define tasks ${feature} --force${RESET}`,
    );
    console.log("");
  }
}

tasksCommand
  .command("list <feature>")
  .description("List all tasks for a feature")
  .addHelpText(
    "after",
    `
Examples:
  gwrk tasks list 001
  gwrk tasks list 001-cli-core --compact
  gwrk tasks list 001 --json
`,
  )
  .option("--json", "Output in JSON format")
  .option("--compact", "Hide descriptions on open tasks")
  .action(
    async (
      featureInput: string,
      options: { json?: boolean; compact?: boolean },
      command,
    ) => {
      await withSignal("tasks list", async () => {
        const out = options.json
          ? createOutput("json")
          : resolveFormat(command);

        const projectRoot = process.cwd();
        const feature = resolveFeature(featureInput, projectRoot);
        const featureDir = path.join(projectRoot, "specs", feature);
        let state: TaskState;
        try {
          state = loadTaskState(featureDir);
        } catch {
          throw new CommandError(
            `Task state not found for '${feature}'. Run 'gwrk define tasks ${feature}' to generate tasks. See 'gwrk project specs' to list features.`,
            1,
          );
        }
        const allTasks = listTasks(state);

        if (out.isJson) {
          out.write({ tasks: allTasks });
          return;
        }

        checkDrift(featureDir, state, feature);

        console.log(`Tasks for ${feature}:`);
        const { CYAN, BOLD, RESET, GREEN, RED, DIM } = color;

        for (const phase of state.phases) {
          if (phase.tasks.length === 0) continue;

          const phaseNum = Number.parseInt(phase.id.replace("phase-", ""), 10);
          console.log(
            `\n  ${CYAN}${BOLD}Phase ${phaseNum}: ${phase.title}${RESET}`,
          );

          for (const t of phase.tasks) {
            let statusChar = " ";
            const bracketColor = DIM;
            let textColor = RESET;

            if (t.status === "completed") {
              statusChar = `${GREEN}✓${RESET}`;
              textColor = DIM;
            } else if (t.status === "cancelled") {
              statusChar = `${RED}✗${RESET}`;
              textColor = DIM;
            } else if (t.status === "in_progress") {
              statusChar = `${CYAN}▸${RESET}`;
            }

            console.log(
              `  ${bracketColor}[${RESET}${statusChar}${bracketColor}]${RESET} ${textColor}${t.id}: ${t.title}${RESET}`,
            );

            if (
              !options.compact &&
              (t.status === "open" || t.status === "in_progress") &&
              t.description
            ) {
              console.log(`       ${DIM}${t.description}${RESET}`);
            }
          }
        }
      });
    },
  );

tasksCommand
  .command("next <feature> <phase>")
  .description("Show the next open task for a phase")
  .addHelpText(
    "after",
    `
Examples:
  gwrk tasks next 001 1
  gwrk tasks next 001-cli-core p02
  gwrk tasks next 001 3 --json
`,
  )
  .option("--json", "Output in JSON format")
  .action(
    async (
      featureInput: string,
      phase: string,
      options: { json?: boolean },
      command,
    ) => {
      await withSignal("tasks next", async () => {
        const out = options.json
          ? createOutput("json")
          : resolveFormat(command);

        const projectRoot = process.cwd();
        const feature = resolveFeature(featureInput, projectRoot);
        const featureDir = path.join(projectRoot, "specs", feature);
        const state = loadTaskState(featureDir);

        let phaseId = phase;
        if (!phase.startsWith("phase-")) {
          phaseId = `phase-${phase.padStart(2, "0")}`;
        }

        const task = nextTask(state, phaseId);

        if (out.isJson) {
          out.write({ task: task || null });
        } else if (task) {
          console.log(`Next task: ${task.id}: ${task.title}`);
          console.log(task.description);
        } else {
          console.log("All tasks completed or phase not found");
        }
      });
    },
  );

tasksCommand
  .command("ready <feature>")
  .description("List all tasks ready for implementation")
  .addHelpText(
    "after",
    `
Examples:
  gwrk tasks ready 001
  gwrk tasks ready 001-cli-core --json
`,
  )
  .option("--json", "Output in JSON format")
  .action(
    async (featureInput: string, options: { json?: boolean }, command) => {
      await withSignal("tasks ready", async () => {
        const out = options.json
          ? createOutput("json")
          : resolveFormat(command);

        const projectRoot = process.cwd();
        const feature = resolveFeature(featureInput, projectRoot);
        const featureDir = path.join(projectRoot, "specs", feature);
        const state = loadTaskState(featureDir);
        const readyTasks = listTasks(state).filter(
          (t) => t.status === "open" || t.status === "in_progress",
        );

        if (out.isJson) {
          out.write({ tasks: readyTasks });
        } else {
          console.log(`Ready tasks for ${feature}:`);
          if (readyTasks.length === 0) {
            console.log("  (none)");
            return;
          }
          for (const t of readyTasks) {
            console.log(`  ${t.id}: ${t.title}`);
          }
        }
      });
    },
  );
