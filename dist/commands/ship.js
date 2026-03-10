import path from "node:path";
import { Command } from "commander";
import { finishRun, recordHistory, startRun } from "../db/runs.js";
import { loadConfig } from "../utils/config.js";
import { run } from "../utils/exec.js";
import { banner, color, dryRun as dryRunFmt, fail, success, } from "../utils/format.js";
import { getCurrentBranch, getCurrentCommit, getDiffStats, } from "../utils/git.js";
import { generateRunId, writeManifest } from "../utils/manifest.js";
import { loadTaskState } from "../utils/state.js";
const { GREEN, DIM, RESET } = color;
/**
 * Ship a single phase through the full lifecycle.
 * Returns the exit code (0 = success, non-zero = failure).
 */
async function shipPhase(feature, phase, backend, opts, cwd) {
    const scriptPath = path.join(cwd, "scripts/dev/work-until-done.sh");
    const phaseId = `phase-${phase.padStart(2, "0")}`;
    const startedAt = new Date().toISOString();
    const runId = startRun({
        feature_id: feature,
        phase_id: phaseId,
        command: "ship",
        agent_backend: backend,
        workflow: "work-until-done",
    });
    banner("ship", {
        Feature: feature,
        Phase: phase,
        Agent: backend,
        "Max Iter": opts.maxIterations,
        "CI Timeout": `${opts.ciTimeout}m`,
        "Run ID": `${runId}`,
    });
    const startTime = Date.now();
    let exitCode = 0;
    try {
        await run(scriptPath, [feature, phase], {
            cwd,
            env: {
                ...process.env,
                APPROVAL_MODE: "yolo",
                MAX_ITERATIONS: opts.maxIterations,
                CI_TIMEOUT: opts.ciTimeout,
                AGENT_BACKEND: backend,
            },
            stdio: "inherit",
        });
        const durationS = Math.round((Date.now() - startTime) / 1000);
        finishRun(runId, { exit_code: 0, duration_s: durationS });
        success("ship", durationS, runId);
    }
    catch (err) {
        const durationS = Math.round((Date.now() - startTime) / 1000);
        exitCode =
            err instanceof Error && "code" in err
                ? err.code
                : 1;
        finishRun(runId, { exit_code: exitCode, duration_s: durationS });
        fail("ship", exitCode, durationS, runId);
    }
    // Write Execution Manifest (ADR-003)
    try {
        const finishedAt = new Date().toISOString();
        const durationS = Math.round((Date.now() - startTime) / 1000);
        const gitCommit = getCurrentCommit(cwd);
        const gitBranch = getCurrentBranch(cwd);
        const { filesChanged, linesAdded, linesDeleted } = getDiffStats(cwd, `${gitCommit}~1`);
        const manifestId = generateRunId(startedAt, "ship", phaseId);
        const featureDir = path.join(cwd, "specs", feature);
        writeManifest(featureDir, {
            runId: manifestId,
            feature,
            phase: phaseId,
            command: "ship",
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
        });
        recordHistory({
            feature_id: feature,
            run_id: runId,
            from_status: "open",
            to_status: exitCode === 0 ? "completed" : "open",
            metadata: JSON.stringify({ command: "ship", manifestId }),
        });
    }
    catch (manifestError) {
        console.warn(`Warning: Could not write execution manifest: ${manifestError}`);
    }
    return exitCode;
}
/**
 * gwrk ship — The Shipping Pillar (Throughput)
 *
 * Full autonomous lifecycle: branch → implement → review → PR → CI → done.
 * Phase is optional — when omitted, ships all phases of the feature sequentially.
 */
export const shipCommand = new Command("ship")
    .description("Ship: autonomous branch→implement→review→PR→CI loop")
    .argument("<feature>", "Feature ID")
    .argument("[phase]", "Phase number (omit to ship all phases)")
    .option("--dry-run", "Dry run mode")
    .option("--max-iterations <n>", "Max implement→review cycles", "3")
    .option("--ci-timeout <n>", "CI wait timeout in minutes", "30")
    .option("--agent <agent>", "Override the default agent (e.g., gemini, claude, codex)")
    .action(async (feature, phase, opts) => {
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    const backend = opts.agent || config.agents.implement;
    // Determine which phases to ship
    let phases;
    if (phase) {
        phases = [phase];
    }
    else {
        const specDir = path.join(cwd, "specs", feature);
        const taskState = loadTaskState(specDir);
        const allPhases = taskState.phases.map((p) => p.id.replace("phase-", ""));
        // FR-014: Skip phases where all tasks are already completed
        phases = allPhases.filter((phaseNum) => {
            const phaseData = taskState.phases.find((p) => p.id === `phase-${phaseNum.padStart(2, "0")}`);
            if (!phaseData)
                return true;
            const allComplete = phaseData.tasks.every((t) => t.status === "completed");
            if (allComplete) {
                console.log(`  ⏭  Phase ${phaseNum}: all tasks complete — skipping`);
                return false;
            }
            return true;
        });
        if (phases.length === 0) {
            console.log(`${GREEN}✓${RESET} All phases complete for ${feature} — nothing to ship`);
            return;
        }
        console.log(`${GREEN}▶${RESET} Shipping feature ${feature}: ${phases.length} phases${DIM} (${phases.map((p) => `P${p}`).join(", ")})${RESET}`);
    }
    if (opts.dryRun) {
        const scriptPath = path.join(cwd, "scripts/dev/work-until-done.sh");
        for (const p of phases) {
            dryRunFmt(`${scriptPath} ${feature} ${p}`);
        }
        return;
    }
    // Ship each phase sequentially — stop on first failure
    for (const p of phases) {
        const exitCode = await shipPhase(feature, p, backend, opts, cwd);
        if (exitCode !== 0) {
            process.exit(exitCode);
        }
    }
});
