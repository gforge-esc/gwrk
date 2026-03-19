import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { finishRun, startRun } from "../db/runs.js";
import { classifyTask, extractFilePaths } from "../engine/classify.js";
import { dispatchAgent } from "../utils/agent.js";
import { loadConfig } from "../utils/config.js";
import { banner, blocked, fail, success } from "../utils/format.js";
import { generateGateBrief, generateRunner, generateVitestGates } from "../utils/gate-gen.js";
import { parsePlan } from "../utils/parser.js";
import { contentHash, loadTaskState, saveTaskState } from "../utils/state.js";
import { CommandError, withSignal } from "../utils/signal.js";
/**
 * gwrk define tasks <feature> — Decompose plan → tasks.json + gates
 *
 * Without flags:      refuses to overwrite existing tasks.json.
 * With --force:       blows away existing tasks.json + gates and regenerates fresh.
 * With --reconcile:   merges new plan into existing tasks, preserving completed status.
 */
export const tasksGenerateCommand = new Command("tasks")
    .description("Decompose plan into tasks.json + gate scripts")
    .argument("<feature>", "Feature ID (e.g. 001-cli-core)")
    .option("-p, --phase <phase>", "Specific phase string or number to generate tasks for (e.g. p01 or 1)")
    .option("--force", "Overwrite existing tasks.json and gate scripts")
    .option("--reconcile", "Merge updated plan, preserving completed task status")
    .option("--no-llm", "Skip LLM gate authoring (writes tasks.json only, no gates)")
    .action(async (feature, opts) => {
    await withSignal(`define tasks ${feature}`, async () => {
        const projectRoot = process.cwd();
        const featureDir = path.join(projectRoot, "specs", feature);
        const planPath = path.join(featureDir, "plan.md");
        const tasksPath = path.join(featureDir, ".gwrk", "tasks.json");
        const gatesDir = path.join(featureDir, "gates");
        // Format phase uniformly to p0X if it's just a number
        let paddedPhase = undefined;
        if (opts.phase) {
            paddedPhase = opts.phase.match(/^\d+$/) ? `p${opts.phase.padStart(2, '0')}` : opts.phase;
        }
        banner("define tasks", { Feature: feature, Phase: paddedPhase || "All" });
        const startTime = Date.now();
        // Guard: refuse to overwrite without --force or --reconcile
        if (fs.existsSync(tasksPath) && !opts.force && !opts.reconcile) {
            blocked(`tasks.json already exists for ${feature}.\n` +
                `  Regenerate:  gwrk define tasks ${feature} --force\n` +
                `  Reconcile:   gwrk define tasks ${feature} --reconcile`);
            throw new CommandError("tasks.json already exists", 1);
        }
        try {
            console.log("  Parsing plan.md...");
            const parsedPlan = parsePlan(planPath);
            const planHash = contentHash(planPath);
            const planMtime = fs.statSync(planPath).mtime.toISOString();
            console.log(`  Found ${parsedPlan.phases.length} phases in plan.md`);
            // Load existing state for reconcile mode
            let existingState = null;
            if (opts.reconcile && fs.existsSync(tasksPath)) {
                try {
                    existingState = loadTaskState(featureDir);
                    console.log(`  Loaded existing tasks (${existingState.phases.reduce((n, p) => n + p.tasks.length, 0)} tasks)`);
                }
                catch {
                    // If we can't load, fall through to fresh generation
                }
            }
            // If --force, wipe existing gates (except AUTHORED ones)
            if (opts.force && fs.existsSync(gatesDir)) {
                const existing = fs
                    .readdirSync(gatesDir)
                    .filter((f) => f.match(/^T\d+-gate\.sh$/));
                let removed = 0;
                let preserved = 0;
                for (const f of existing) {
                    const gatePath = path.join(gatesDir, f);
                    const content = fs.readFileSync(gatePath, "utf-8");
                    if (content.includes("# AUTHORED")) {
                        preserved++;
                        continue;
                    }
                    fs.unlinkSync(gatePath);
                    removed++;
                }
                if (removed > 0) {
                    console.log(`  Removing ${removed} old gate scripts...`);
                }
                if (preserved > 0) {
                    console.log(`  Preserving ${preserved} # AUTHORED gate scripts...`);
                }
            }
            // Build new tasks from plan
            let taskCounter = 1;
            // Track which existing tasks have been consumed by a new task (first-match-wins)
            const consumedExistingIds = new Set();
            const newPhases = parsedPlan.phases.map((p) => {
                const phaseTasks = p.tasks.map((t) => {
                    const taskId = `T${taskCounter.toString().padStart(3, "0")}`;
                    taskCounter++;
                    let status = "open";
                    let completedAt;
                    if (opts.reconcile && existingState) {
                        const allExisting = existingState.phases.flatMap((ep) => ep.tasks);
                        // Pass 1: exact title match (only unconsumed tasks)
                        let existingTask = allExisting.find((et) => !consumedExistingIds.has(et.id) && et.title === t.title);
                        // Pass 2: file path match (only unconsumed tasks)
                        if (!existingTask) {
                            const newPath = t.title.match(/(?:src|tests|docs|scripts)\/\S+|\S+\.(?:ts|json|md|sh|yml)/);
                            if (newPath) {
                                existingTask = allExisting.find((et) => !consumedExistingIds.has(et.id) &&
                                    et.title.includes(newPath[0]));
                            }
                        }
                        if (existingTask) {
                            // Mark as consumed so it can't match another new task
                            consumedExistingIds.add(existingTask.id);
                            if (existingTask.status === "completed" ||
                                existingTask.status === "in_progress") {
                                status = existingTask.status;
                                completedAt = existingTask.completedAt;
                            }
                        }
                    }
                    // Classification: greenfield, change, refactor, noop
                    const files = extractFilePaths(`${t.title} ${t.description}`);
                    const refactorKeywords = [
                        "refactor",
                        "cleanup",
                        "reorganize",
                        "rename",
                        "move",
                        "restructure",
                    ];
                    const isRefactor = refactorKeywords.some((kw) => t.title.toLowerCase().includes(kw) ||
                        t.description.toLowerCase().includes(kw));
                    return {
                        id: taskId,
                        title: t.title,
                        description: t.description,
                        status,
                        gateScript: `gates/${taskId}-gate.sh`,
                        completedAt,
                        classification: classifyTask({
                            files,
                            rootDir: projectRoot,
                            modifiesBehavior: !isRefactor,
                        }),
                    };
                });
                return {
                    id: p.id,
                    title: p.title,
                    tasks: phaseTasks,
                    doneWhen: p.doneWhen,
                };
            });
            // In reconcile mode, append cancelled tasks back into their ORIGINAL phase
            // (not the last phase). This keeps the task list clean when adding scope.
            if (opts.reconcile && existingState) {
                // Build a map of new phase IDs for lookup
                const newPhaseMap = new Map(newPhases.map((p) => [p.id, p]));
                for (const oldPhase of existingState.phases) {
                    for (const task of oldPhase.tasks) {
                        if (consumedExistingIds.has(task.id))
                            continue; // Already matched
                        if (task.status === "cancelled")
                            continue; // Already cancelled before
                        // This task is no longer in the plan — cancel it in its original phase
                        const cancelledId = `T${taskCounter.toString().padStart(3, "0")}`;
                        taskCounter++;
                        const cancelledTask = {
                            id: cancelledId,
                            title: task.title,
                            description: task.description,
                            status: "cancelled",
                            gateScript: task.gateScript,
                            completedAt: task.completedAt,
                        };
                        // Try to put it back in the same phase if that phase still exists
                        const targetPhase = newPhaseMap.get(oldPhase.id);
                        if (targetPhase) {
                            targetPhase.tasks.push(cancelledTask);
                        }
                        else {
                            // Phase itself was removed — append to last phase as before
                            const lastPhase = newPhases[newPhases.length - 1];
                            lastPhase.tasks.push(cancelledTask);
                        }
                    }
                }
            }
            const taskState = {
                featureId: feature,
                createdAt: existingState?.createdAt ?? new Date().toISOString(),
                generatedFrom: {
                    plan: { hash: planHash, modifiedAt: planMtime },
                },
                phases: newPhases,
            };
            console.log("  Writing tasks.json...");
            saveTaskState(featureDir, taskState);
            // ── Gate authoring (ADR-005 §8) ────────────────────────────────
            const skipLlm = opts.llm === false; // --no-llm
            // Step 4: Gap matrix check — deterministic vitest gates (ADR-005 §8)
            const gapMatrixPath = path.join(featureDir, "gap-matrix.md");
            let vitestGatesGenerated = 0;
            let vitestGatesSkipped = 0;
            if (fs.existsSync(gapMatrixPath)) {
                console.log("  Reading gap-matrix.md for deterministic vitest gates...");
                const result = generateVitestGates(featureDir, gapMatrixPath, taskState.phases);
                vitestGatesGenerated = result.generated;
                vitestGatesSkipped = result.skipped;
                console.log(`  Deterministic vitest gates: ${vitestGatesGenerated} generated, ${vitestGatesSkipped} skipped`);
            }
            if (skipLlm) {
                if (vitestGatesGenerated > 0) {
                    console.log("  ⚠ --no-llm: LLM dispatch skipped (vitest gates generated from gap matrix)");
                }
                else {
                    console.log("  ⚠ --no-llm: skipping gate authoring (tasks.json only)");
                }
            }
            else {
                // Contracts guard — contracts are a define plan deliverable
                const contractsDir = path.join(featureDir, "contracts");
                const hasContracts = fs.existsSync(contractsDir) &&
                    fs.readdirSync(contractsDir).filter((f) => f.endsWith(".md")).length > 0;
                if (!hasContracts) {
                    console.log("");
                    console.log("  ✗ Contracts required for gate authoring.");
                    console.log(`    Run 'gwrk define plan ${feature}' to generate plan.md and contracts/.`);
                    console.log("    See 'gwrk define plan --help'.");
                    throw new CommandError(`Contracts required for gate authoring. Run 'gwrk define plan ${feature}' first.`, 1);
                }
                // Determine if LLM dispatch is needed (tasks not covered by vitest gates)
                const totalTasks = taskState.phases.reduce((n, p) => n + p.tasks.length, 0);
                const uncoveredCount = totalTasks - vitestGatesGenerated;
                if (vitestGatesGenerated > 0 && uncoveredCount <= 0) {
                    console.log("  ✓ All tasks covered by deterministic vitest gates — LLM dispatch skipped");
                }
                else {
                    // Generate structured brief for the LLM agent (for uncovered tasks)
                    console.log("  Generating gate brief...");
                    const briefPath = generateGateBrief(featureDir, taskState.phases, feature);
                    console.log(`  Brief: ${briefPath}`);
                    // Dispatch agent for gate authoring (same pattern as plan.ts)
                    const config = loadConfig(projectRoot);
                    const backend = config.agents.define;
                    const relativeFeatureDir = path.join("specs", feature);
                    const runId = startRun({
                        feature_id: feature,
                        command: "define tasks:gates",
                        agent_backend: backend,
                        workflow: "author-gates",
                    });
                    console.log(`  Dispatching ${backend} for gate authoring...`);
                    if (vitestGatesGenerated > 0) {
                        console.log(`    (${uncoveredCount} tasks not covered by gap matrix — LLM will author remaining gates)`);
                    }
                    const agentStart = Date.now();
                    const result = await dispatchAgent({
                        backend,
                        workflowPath: ".agents/workflows/gwrk-author-gates.md",
                        featureDir: relativeFeatureDir,
                        contextPath: paddedPhase || briefPath,
                    });
                    const agentDurationS = Math.round((Date.now() - agentStart) / 1000);
                    if (result.exitCode !== 0) {
                        finishRun(runId, { exit_code: result.exitCode, duration_s: agentDurationS });
                        console.log(`  ✗ Gate authoring failed (exit ${result.exitCode})`);
                        console.log(`    Log: ${result.logPath}`);
                        throw new CommandError(`Gate authoring failed (exit ${result.exitCode}). See ${result.logPath}`, 1);
                    }
                    finishRun(runId, { exit_code: 0, duration_s: agentDurationS });
                    console.log(`  ✓ Gates authored (${agentDurationS}s)`);
                }
                // Generate runner after all gates are written
                const gatesDirPath = path.join(featureDir, "gates");
                if (fs.existsSync(gatesDirPath)) {
                    generateRunner(gatesDirPath);
                }
            }
            // Generate runner for --no-llm path too (if vitest gates were generated)
            if (skipLlm && vitestGatesGenerated > 0) {
                const gatesDirPath = path.join(featureDir, "gates");
                if (fs.existsSync(gatesDirPath)) {
                    generateRunner(gatesDirPath);
                }
            }
            // In reconcile mode, audit gates against reality
            if (opts.reconcile) {
                console.log("  Auditing gates against reality...");
                let audited = 0;
                let passed = 0;
                for (const phase of taskState.phases) {
                    for (const task of phase.tasks) {
                        if (task.status !== "open")
                            continue;
                        const gatePath = path.join(featureDir, task.gateScript);
                        if (!fs.existsSync(gatePath))
                            continue;
                        audited++;
                        try {
                            execSync(`bash "${gatePath}"`, {
                                cwd: projectRoot,
                                stdio: "ignore",
                                timeout: 10_000,
                            });
                            task.status = "completed";
                            task.completedAt = new Date().toISOString();
                            passed++;
                        }
                        catch {
                            // Gate failed — task stays open
                        }
                    }
                }
                if (audited > 0) {
                    console.log(`  ${passed}/${audited} gates passed — tasks marked completed`);
                    // Re-save with updated statuses
                    saveTaskState(featureDir, taskState);
                }
            }
            const totalTasks = taskState.phases.reduce((n, p) => n + p.tasks.length, 0);
            const activeTasks = taskState.phases.reduce((n, p) => n + p.tasks.filter((t) => t.status !== "cancelled").length, 0);
            const cancelledTasks = totalTasks - activeTasks;
            const completedTasks = taskState.phases.reduce((n, p) => n + p.tasks.filter((t) => t.status === "completed").length, 0);
            console.log("");
            const summary = [
                `${taskState.phases.length} phases`,
                `${activeTasks} tasks`,
                `${activeTasks} gates`,
            ];
            if (completedTasks > 0)
                summary.push(`${completedTasks} preserved`);
            if (cancelledTasks > 0)
                summary.push(`${cancelledTasks} cancelled`);
            console.log(`  ✓ ${summary.join(", ")}`);
            const durationS = Math.round((Date.now() - startTime) / 1000);
            success("define tasks", durationS);
        }
        catch (error) {
            const durationS = Math.round((Date.now() - startTime) / 1000);
            const message = error instanceof Error ? error.message : String(error);
            fail("define tasks", 1, durationS);
            throw new CommandError(`Error generating tasks: ${message}`, 1);
        }
    });
});
