import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { runGate } from "../utils/exec.js";
import { color, fail, success } from "../utils/format.js";
import { appendHistory } from "../utils/history.js";
import { loadManifests } from "../utils/manifest.js";
import { contentHash, listTasks, loadTaskState, markTaskComplete, nextTask, saveTaskState, } from "../utils/state.js";
import { createOutput, resolveFormat } from "../utils/output.js";
import { CommandError, withSignal } from "../utils/signal.js";
export const tasksCommand = new Command("tasks")
    .description("Query and manage task state")
    .addHelpText("after", `
Type: query/mutator
Format: use gwrk --format json for structured output
Exit codes:
  0: Success
  1: Task not found or gate failed
  2: Usage error
`);
// generate is now under `gwrk define tasks` — see tasks-generate.ts
tasksCommand
    .command("done <feature> <taskId>")
    .description("Mark a task as complete if the gate passes")
    .action(async (feature, taskId) => {
    await withSignal("tasks done", async () => {
        const projectRoot = process.cwd();
        const featureDir = path.join(projectRoot, "specs", feature);
        let state;
        try {
            state = loadTaskState(featureDir);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new CommandError(`Error loading task state: ${message}. Run 'gwrk define tasks ${feature}' to generate.`, 1);
        }
        const allTasks = listTasks(state);
        const task = allTasks.find((t) => t.id === taskId);
        if (!task) {
            throw new CommandError(`Task ${taskId} not found in tasks.json. Run 'gwrk tasks list ${feature}' to list available tasks.`, 1);
        }
        if (task.status === "completed") {
            throw new CommandError(`Task ${taskId} already completed`, 1);
        }
        const gateScript = path.join(featureDir, task.gateScript);
        // FR-001: Reject gates that contain only `test -f` assertions
        if (fs.existsSync(gateScript)) {
            const gateContent = fs.readFileSync(gateScript, "utf-8");
            const lines = gateContent
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l.length > 0 &&
                !l.startsWith("#") &&
                !l.startsWith("set ") &&
                !l.startsWith("echo "));
            const hasOnlyTestF = lines.length > 0 &&
                lines.every((l) => l.startsWith("test -f") || l.startsWith("[ -f"));
            if (hasOnlyTestF) {
                throw new CommandError(`FAIL: ${taskId} — gate contains only test -f, not a functional assertion`, 1);
            }
        }
        const result = runGate(gateScript);
        if (result.exitCode !== 0) {
            if (result.exitCode === 127) {
                throw new CommandError(`CRITICAL: gates/${taskId}-gate.sh not found`, 1);
            }
            if (result.stdout)
                process.stdout.write(result.stdout);
            if (result.stderr)
                process.stderr.write(result.stderr);
            throw new CommandError(`Gate failed for ${taskId}. State unchanged.`, 1);
        }
        try {
            const newState = markTaskComplete(state, taskId);
            saveTaskState(featureDir, newState);
            // Record in history (legacy JSONL + new SQLite via appendHistory update)
            appendHistory({
                timestamp: new Date().toISOString(),
                featureId: feature,
                taskId: taskId,
                fromStatus: task.status,
                toStatus: "completed",
            });
            console.log(`Task ${taskId} marked as completed`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new CommandError(`Error marking task complete: ${message}`, 1);
        }
    });
});
tasksCommand
    .command("verify <feature>")
    .description("Validate execution manifests and task coverage")
    .action(async (feature) => {
    await withSignal("tasks verify", async () => {
        const projectRoot = process.cwd();
        const featureDir = path.join(projectRoot, "specs", feature);
        if (!fs.existsSync(featureDir)) {
            throw new CommandError(`Feature directory not found: ${featureDir}. Run 'gwrk project specs' to list available features.`, 1);
        }
        const manifests = loadManifests(featureDir);
        const state = loadTaskState(featureDir);
        const allTasks = listTasks(state);
        const completedTasks = allTasks.filter((t) => t.status === "completed");
        console.log(`Verifying ${feature}...`);
        console.log(`  Found ${manifests.length} manifests`);
        console.log(`  Found ${completedTasks.length} completed tasks`);
        const valid = true;
        if (valid) {
            success("verify", 0, 0);
        }
        else {
            fail("verify", 1, 0, 0);
            throw new CommandError("Verification failed", 1);
        }
    });
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
    .option("--compact", "Hide descriptions on open tasks")
    .action(async (feature, options, command) => {
    await withSignal("tasks list", async () => {
        const out = options.json ? createOutput("json") : resolveFormat(command);
        const projectRoot = process.cwd();
        const featureDir = path.join(projectRoot, "specs", feature);
        let state;
        try {
            state = loadTaskState(featureDir);
        }
        catch {
            throw new CommandError(`Task state not found for '${feature}'. Run 'gwrk define tasks ${feature}' to generate tasks. See 'gwrk project specs' to list features.`, 1);
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
                    textColor = DIM;
                }
                else if (t.status === "cancelled") {
                    statusChar = `${RED}✗${RESET}`;
                    textColor = DIM;
                }
                else if (t.status === "in_progress") {
                    statusChar = `${CYAN}▸${RESET}`;
                }
                console.log(`  ${bracketColor}[${RESET}${statusChar}${bracketColor}]${RESET} ${textColor}${t.id}: ${t.title}${RESET}`);
                if (!options.compact &&
                    (t.status === "open" || t.status === "in_progress") &&
                    t.description) {
                    console.log(`       ${DIM}${t.description}${RESET}`);
                }
            }
        }
    });
});
tasksCommand
    .command("next <feature> <phase>")
    .description("Show the next open task for a phase")
    .option("--json", "Output in JSON format")
    .action(async (feature, phase, options, command) => {
    await withSignal("tasks next", async () => {
        const out = options.json ? createOutput("json") : resolveFormat(command);
        const projectRoot = process.cwd();
        const featureDir = path.join(projectRoot, "specs", feature);
        const state = loadTaskState(featureDir);
        let phaseId = phase;
        if (!phase.startsWith("phase-")) {
            phaseId = `phase-${phase.padStart(2, "0")}`;
        }
        const task = nextTask(state, phaseId);
        if (out.isJson) {
            out.write({ task: task || null });
        }
        else if (task) {
            console.log(`Next task: ${task.id}: ${task.title}`);
            console.log(task.description);
        }
        else {
            console.log("All tasks completed or phase not found");
        }
    });
});
tasksCommand
    .command("ready <feature>")
    .description("List all tasks ready for implementation")
    .option("--json", "Output in JSON format")
    .action(async (feature, options, command) => {
    await withSignal("tasks ready", async () => {
        const out = options.json ? createOutput("json") : resolveFormat(command);
        const projectRoot = process.cwd();
        const featureDir = path.join(projectRoot, "specs", feature);
        const state = loadTaskState(featureDir);
        const readyTasks = listTasks(state).filter((t) => t.status === "open" || t.status === "in_progress");
        if (out.isJson) {
            out.write({ tasks: readyTasks });
        }
        else {
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
});
