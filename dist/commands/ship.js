import { Command } from "commander";
import path from "node:path";
import { startRun, finishRun } from "../db/runs.js";
import { run } from "../utils/exec.js";
import { loadConfig } from "../utils/config.js";
import { banner, success, fail, dryRun as dryRunFmt } from "../utils/format.js";
/**
 * gwrk ship — The ZFG/WUD Pillar (Throughput)
 *
 * Everything that creates throughput — implementing and completing work autonomously.
 *
 *   gwrk ship <feature> <phase>      Work Until Done (implement→review→PR loop)
 */
export const shipCommand = new Command("ship")
    .description("Ship: autonomous implement→review→PR loop (ZFG/WUD)")
    .argument("<feature>", "Feature ID")
    .argument("<phase>", "Phase number")
    .option("--dry-run", "Dry run mode")
    .option("--max-iterations <n>", "Max iterations", "3")
    .action(async (feature, phase, opts) => {
    const cwd = process.cwd();
    const scriptPath = path.join(cwd, "scripts/dev/work-until-done.sh");
    const config = loadConfig(cwd);
    const backend = config.agents.implement;
    if (opts.dryRun) {
        dryRunFmt(`${scriptPath} ${feature} ${phase}`);
        return;
    }
    const runId = startRun({
        feature_id: feature,
        phase_id: `phase-${phase.padStart(2, "0")}`,
        command: "ship",
        agent_backend: backend,
        workflow: "work-until-done",
    });
    banner("ship", {
        Feature: feature,
        Phase: phase,
        Agent: backend,
        "Max Iter": opts.maxIterations,
        "Run ID": `${runId}`,
    });
    const startTime = Date.now();
    try {
        await run(scriptPath, [feature, phase], {
            cwd,
            env: {
                ...process.env,
                APPROVAL_MODE: "yolo",
                MAX_ITERATIONS: opts.maxIterations,
            },
            stdio: "inherit",
        });
        const durationS = Math.round((Date.now() - startTime) / 1000);
        finishRun(runId, { exit_code: 0, duration_s: durationS });
        success("ship", durationS, runId);
    }
    catch (err) {
        const durationS = Math.round((Date.now() - startTime) / 1000);
        const exitCode = err instanceof Error && "code" in err ? err.code : 1;
        finishRun(runId, { exit_code: exitCode, duration_s: durationS });
        fail("ship", exitCode, durationS, runId);
        process.exit(exitCode);
    }
});
