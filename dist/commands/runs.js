import { Command } from "commander";
import { listRuns } from "../db/runs.js";
/**
 * gwrk runs <feature> — Query execution history from SQLite
 */
export const runsCommand = new Command("runs")
    .description("Show execution history for a feature")
    .argument("<feature>", "Feature ID")
    .option("--json", "Output as JSON")
    .action((feature, opts) => {
    const runs = listRuns(feature);
    if (runs.length === 0) {
        console.log(`No runs found for ${feature}`);
        return;
    }
    if (opts.json) {
        console.log(JSON.stringify(runs, null, 2));
        return;
    }
    console.log(`\n📊 Execution History: ${feature}`);
    console.log("─".repeat(80));
    console.log(`${"#".padEnd(5)} ${"Command".padEnd(12)} ${"Phase".padEnd(12)} ${"Agent".padEnd(14)} ${"Exit".padEnd(6)} ${"Duration".padEnd(10)} ${"Started"}`);
    console.log("─".repeat(80));
    for (const r of runs) {
        const dur = r.duration_s ? `${r.duration_s}s` : "—";
        const exit = r.exit_code !== undefined && r.exit_code !== null
            ? r.exit_code === 0 ? "✅ 0" : `❌ ${r.exit_code}`
            : "⏳";
        const phase = r.phase_id ?? "—";
        const agent = r.agent_backend ?? "—";
        const started = r.started_at ?? "—";
        console.log(`${String(r.id).padEnd(5)} ${r.command.padEnd(12)} ${phase.padEnd(12)} ${agent.padEnd(14)} ${exit.padEnd(6)} ${dur.padEnd(10)} ${started}`);
    }
    console.log("─".repeat(80));
    console.log(`Total: ${runs.length} runs\n`);
});
