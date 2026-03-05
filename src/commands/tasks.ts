import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { runGate } from "../utils/exec.js";
import { generateGates } from "../utils/gate-gen.js";
import { appendHistory } from "../utils/history.js";
import { parsePlan } from "../utils/parser.js";
import {
  listTasks,
  loadTaskState,
  markTaskComplete,
  nextTask,
  saveTaskState,
} from "../utils/state.js";
import type { Task, TaskState } from "../utils/state.js";

export const tasksCommand = new Command("tasks").description(
  "Manage feature tasks",
);

tasksCommand
  .command("generate <feature>")
  .description("Generate tasks and gates from plan.md")
  .action((feature: string) => {
    const projectRoot = process.cwd();
    const featureDir = path.join(projectRoot, "specs", feature);
    const planPath = path.join(featureDir, "plan.md");
    const tasksPath = path.join(featureDir, ".gwrk", "tasks.json");

    try {
      const parsedPlan = parsePlan(planPath);

      // Load existing state if it exists
      let existingState: TaskState | null = null;
      if (fs.existsSync(tasksPath)) {
        try {
          existingState = loadTaskState(featureDir);
        } catch (e) {
          console.warn(`Warning: Could not load existing task state: ${e}`);
        }
      }

      const taskState: TaskState = {
        featureId: feature,
        createdAt: existingState?.createdAt || new Date().toISOString(),
        phases: [],
      };

      let taskCounter = 1;
      for (const p of parsedPlan.phases) {
        const existingPhase = existingState?.phases.find(
          (ep) => ep.id === p.id,
        );

        const phaseTasks: Task[] = p.tasks.map((t) => {
          const taskId = `T${taskCounter.toString().padStart(3, "0")}`;
          taskCounter++;

          // Try to find existing task to preserve status
          const existingTask = existingPhase?.tasks.find(
            (et) => et.title === t.title,
          );

          return {
            id: taskId,
            title: t.title,
            description: t.description,
            status: existingTask?.status || "open",
            gateScript: `gates/${taskId}-gate.sh`,
            completedAt: existingTask?.completedAt,
          };
        });

        taskState.phases.push({
          id: p.id,
          title: p.title,
          tasks: phaseTasks,
          doneWhen: p.doneWhen,
        });
      }

      saveTaskState(featureDir, taskState);
      generateGates(featureDir, taskState.phases);
      console.log(`Successfully generated tasks for ${feature}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error generating tasks: ${message}`);
      process.exit(1);
    }
  });

tasksCommand
  .command("done <feature> <taskId>")
  .description("Mark a task as complete if the gate passes")
  .action((feature: string, taskId: string) => {
    const projectRoot = process.cwd();
    const featureDir = path.join(projectRoot, "specs", feature);

    let state: TaskState;
    try {
      state = loadTaskState(featureDir);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error loading task state: ${message}`);
      process.exit(1);
    }

    const allTasks = listTasks(state);
    const task = allTasks.find((t) => t.id === taskId);

    if (!task) {
      console.error(`Task ${taskId} not found in tasks.json`);
      process.exit(1);
    }

    if (task.status === "completed") {
      console.error(`Task ${taskId} already completed`);
      process.exit(1);
    }

    const gateScript = path.join(featureDir, task.gateScript);
    const result = runGate(gateScript);

    if (result.exitCode !== 0) {
      if (result.exitCode === 127) {
        console.error(`CRITICAL: gates/${taskId}-gate.sh not found`);
      } else {
        console.error(`Gate failed for ${taskId}. State unchanged.`);
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
      }
      process.exit(1);
    }

    try {
      const newState = markTaskComplete(state, taskId);
      saveTaskState(featureDir, newState);

      appendHistory({
        timestamp: new Date().toISOString(),
        featureId: feature,
        taskId: taskId,
        fromStatus: "open",
        toStatus: "completed",
      });

      console.log(`Task ${taskId} marked as completed`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error marking task complete: ${message}`);
      process.exit(1);
    }
  });

tasksCommand
  .command("list <feature>")
  .description("List all tasks for a feature")
  .option("--json", "Output in JSON format")
  .action((feature: string, options: { json?: boolean }) => {
    const projectRoot = process.cwd();
    const featureDir = path.join(projectRoot, "specs", feature);
    const state = loadTaskState(featureDir);
    const allTasks = listTasks(state);

    if (options.json) {
      console.log(JSON.stringify({ tasks: allTasks }, null, 2));
    } else {
      console.log(`Tasks for ${feature}:`);
      for (const t of allTasks) {
        const statusChar = t.status === "completed" ? "✓" : " ";
        console.log(`[${statusChar}] ${t.id}: ${t.title}`);
      }
    }
  });

tasksCommand
  .command("next <feature> <phase>")
  .description("Show the next open task for a phase")
  .option("--json", "Output in JSON format")
  .action((feature: string, phase: string, options: { json?: boolean }) => {
    const projectRoot = process.cwd();
    const featureDir = path.join(projectRoot, "specs", feature);
    const state = loadTaskState(featureDir);

    // Handle both phase-01 and 1
    let phaseId = phase;
    if (!phase.startsWith("phase-")) {
      phaseId = `phase-${phase.padStart(2, "0")}`;
    }

    const task = nextTask(state, phaseId);

    if (options.json) {
      console.log(JSON.stringify(task, null, 2));
    } else if (task) {
      console.log(`Next task: ${task.id}: ${task.title}`);
      console.log(task.description);
    } else {
      console.log("All tasks completed or phase not found");
    }
  });
