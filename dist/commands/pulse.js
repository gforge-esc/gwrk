import fs from "node:fs";
import path from "node:path";
import { generatePulseReport, scanRepository } from "../engine/pulse.js";
import { loadConfig } from "../utils/config.js";
export function renderPulseTable(report) {
    let out = "\n=== GWRK PULSE SNAPSHOT ===\n";
    out += `Generated: ${new Date(report.generatedAt).toLocaleString()}\n`;
    out += `Spec Progress: ${report.specProgress.totalSpecs} specs | ${report.specProgress.totalPlans} plans\n\n`;
    for (const snap of report.repositories) {
        out += `${renderSnapshotTable(snap)}\n`;
    }
    return out;
}
export function renderSnapshotTable(snap) {
    let out = `Repository: ${snap.repoName} (${snap.repoPath})\n`;
    out += `Branch: ${snap.defaultBranch}\n`;
    out += `LOC: ${snap.mainLoc} (Main) / ${snap.draftLoc} (Draft)\n\n`;
    if (snap.weeklyBuckets.length > 0) {
        out += "Week Start | Total LOC | Added | Deleted\n";
        out += "-----------|-----------|-------|--------\n";
        for (const bucket of snap.weeklyBuckets.slice(-4)) {
            // Show last 4 weeks
            const dateStr = bucket.weekStart.split("T")[0];
            out += `${dateStr.padEnd(10)} | ${bucket.totalMain.toString().padEnd(9)} | +${bucket.added.toString().padEnd(4)} | -${bucket.deleted}\n`;
        }
    }
    else {
        out += "No git history found.\n";
    }
    return out.trimEnd();
}
export function registerPulseCommands(program) {
    registerPulseSubcommands(program);
}
export function registerPulseSubcommands(program) {
    const pulseCmd = program
        .command("pulse")
        .description("Pulse productivity dashboard")
        .option("--json", "Output full PulseReport as JSON")
        .action((options) => {
        try {
            const config = loadConfig(process.cwd());
            const report = generatePulseReport(config);
            if (options.json) {
                console.log(JSON.stringify(report, null, 2));
            }
            else {
                console.log(renderPulseTable(report));
            }
        }
        catch (err) {
            console.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    });
    pulseCmd
        .command("scan <path>")
        .description("Run a historical scan of any git repository")
        .option("--json", "Output PulseSnapshot as JSON")
        .action((repoPath, options) => {
        try {
            const absolutePath = path.resolve(process.cwd(), repoPath);
            if (!fs.existsSync(absolutePath)) {
                console.error(`Path not found: ${absolutePath}`);
                process.exit(1);
            }
            if (!fs.existsSync(path.join(absolutePath, ".git"))) {
                console.error(`Not a git repository: ${absolutePath}`);
                process.exit(1);
            }
            const snapshot = scanRepository(absolutePath);
            if (options.json) {
                console.log(JSON.stringify(snapshot, null, 2));
            }
            else {
                console.log(renderSnapshotTable(snapshot));
            }
        }
        catch (err) {
            console.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    });
}
