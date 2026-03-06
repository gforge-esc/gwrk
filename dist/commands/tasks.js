import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { runGate } from "../utils/exec.js";
import { appendHistory } from "../utils/history.js";
import { color } from "../utils/format.js";
import { contentHash, listTasks, loadTaskState, markTaskComplete, nextTask, saveTaskState, } from "../utils/state.js";
export const tasksCommand = new Command("tasks").description("Query and manage task state");
// generate is now under `gwrk define tasks` — see tasks-generate.ts
tasksCommand
    .command("done <feature> <taskId>")
    .description("Mark a task as complete if the gate passes")
    .action((feature, taskId) => {
    const projectRoot = process.cwd();
    const featureDir = path.join(projectRoot, "specs", feature);
    let state;
    try {
        state = loadTaskState(featureDir);
    }
    catch (error) {
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
        }
        else {
            console.error(`Gate failed for ${taskId}. State unchanged.`);
            if (result.stdout)
                process.stdout.write(result.stdout);
            if (result.stderr)
                process.stderr.write(result.stderr);
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error marking task complete: ${message}`);
        process.exit(1);
    }
});
/** Check if tasks.json was generated from the current plan.md */
function checkDrift(featureDir, state, feature) {
    const planPath = path.join(featureDir, "plan.md");
    if (!state.generatedFrom?.plan || !fs.existsSync(planPath))
        return;
    const currentHash = contentHash(planPath);
    if (currentHash !== state.generatedFrom.plan.hash) {
        const { YELLOW, DIM, RESET, BOLD } = color;
        console.log(`${YELLOW}⚠ plan.md has changed since tasks were generated${RESET}`);
        console.log(`${DIM}  Run: ${BOLD}gwrk define tasks ${feature} --force${RESET}`);
        console.log("");
    }
}
tasksCommand
    .command("list <feature>")
    .description("List all tasks for a feature")
    .option("--json", "Output in JSON format")
    .action((feature, options) => {
    const projectRoot = process.cwd();
    const featureDir = path.join(projectRoot, "specs", feature);
    const state = loadTaskState(featureDir);
    const allTasks = listTasks(state);
    if (!options.json) {
        checkDrift(featureDir, state, feature);
    }
    if (options.json) {
        console.log(JSON.stringify({ tasks: allTasks }, null, 2));
    }
    else {
        console.log(`Tasks for ${feature}:`);
        const { CYAN, BOLD, RESET, GREEN, RED, DIM } = color;
        for (const phase of state.phases) {
            if (phase.tasks.length === 0)
                continue;
            const phaseNum = Number.parseInt(phase.id.replace("phase-", ""), 10);
            console.log(`\n  ${CYAN}${BOLD}Phase ${phaseNum}: ${phase.title}${RESET}`);
            for (const t of phase.tasks) {
                let statusChar = " ";
                const bracketColor = DIM;
                let textColor = RESET;
                if (t.status === "completed") {
                    statusChar = `${GREEN}✓${RESET}`;
                    textColor = DIM; // Dim completed tasks to reduce noise
                }
                else if (t.status === "cancelled") {
                    statusChar = `${RED}✗${RESET}`;
                    textColor = DIM; // Dim cancelled tasks
                }
                else if (t.status === "in_progress") {
                    statusChar = `${CYAN}▸${RESET}`;
                }
                console.log(`  ${bracketColor}[${RESET}${statusChar}${bracketColor}]${RESET} ${textColor}${t.id}: ${t.title}${RESET}`);
            }
        }
    }
});
tasksCommand
    .command("next <feature> <phase>")
    .description("Show the next open task for a phase")
    .option("--json", "Output in JSON format")
    .action((feature, phase, options) => {
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
    }
    else if (task) {
        console.log(`Next task: ${task.id}: ${task.title}`);
        console.log(task.description);
    }
    else {
        console.log("All tasks completed or phase not found");
    }
});
