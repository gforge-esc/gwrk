import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { readPid } from "../server/pid.js";
import { loadConfig } from "../utils/config.js";
import { color } from "../utils/format.js";
import { getCurrentBranch, isWorkingTreeClean } from "../utils/git.js";
import { createOutput } from "../utils/output.js";
import { withSignal } from "../utils/signal.js";
const { BOLD, DIM, CYAN, GREEN, YELLOW, RED, RESET } = color;
export const statusCommand = new Command("status")
    .description("Show gwrk build server and system status")
    .option("--json", "Output status as JSON")
    .addHelpText("after", `
Type: query (read-only)
Formats: human, json
Exit codes:
  0: Success
  1: Server not responding or config missing
  2: Usage error
`)
    .action(async (options, command) => {
    await withSignal("status", async () => {
        // Traverse up to find root program options
        let root = command;
        while (root.parent)
            root = root.parent;
        const globalOpts = root.opts();
        const format = options.json ? "json" : globalOpts.format || "human";
        const out = createOutput(format);
        const projectRoot = process.cwd();
        const config = loadConfig(projectRoot);
        if (format === "json") {
            const branch = getCurrentBranch(projectRoot);
            const isDirty = !isWorkingTreeClean(projectRoot);
            const specsDir = path.join(projectRoot, "specs");
            const specs = fs.existsSync(specsDir)
                ? fs
                    .readdirSync(specsDir)
                    .filter((d) => fs.statSync(path.join(specsDir, d)).isDirectory())
                : [];
            out.write({
                project: {
                    name: config.project.name,
                    root: projectRoot,
                    git: { branch, clean: !isDirty },
                },
                specs: specs.length,
                agents: config.agents,
            });
            return;
        }
        const pid = readPid();
        if (!pid) {
            console.log(`\n  ${RED}●${RESET} ${BOLD}gwrk server is stopped${RESET}`);
            console.log(`    Run 'gwrk server start' to start the server.\n`);
            return;
        }
        const url = `http://${config.server.host}:${config.server.port}/api/status`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }
            const status = (await response.json());
            printStatus(status);
        }
        catch (err) {
            console.log(`\n  ${YELLOW}●${RESET} ${BOLD}gwrk server (PID ${pid}) is not responding${RESET}`);
            console.log(`    ${DIM}Endpoint: ${url}${RESET}\n`);
        }
    });
});
function printStatus(status) {
    const { server, system, dispatch, sandboxes } = status;
    console.log(`\n  ${GREEN}●${RESET} ${BOLD}gwrk server is running${RESET}`);
    console.log(`    ${DIM}PID:    ${RESET}${server.pid}`);
    console.log(`    ${DIM}Uptime: ${RESET}${formatUptime(server.uptime || 0)}`);
    console.log(`    ${DIM}Port:   ${RESET}${server.port}`);
    console.log(`\n  ${CYAN}System Resources${RESET}`);
    console.log(`    ${DIM}CPU:    ${RESET}${formatPercent(system.cpuPercent)}`);
    console.log(`    ${DIM}Memory: ${RESET}${formatPercent(system.memPercent)}`);
    console.log(`    ${DIM}Disk:   ${RESET}${system.diskFreeGb} GB free`);
    console.log(`\n  ${CYAN}Dispatch Queue${RESET}`);
    console.log(`    ${DIM}Queued:    ${RESET}${dispatch.queueDepth}`);
    console.log(`    ${DIM}Active:    ${RESET}${dispatch.activeCount}`);
    console.log(`    ${DIM}Completed: ${RESET}${dispatch.completedCount}`);
    console.log(`    ${DIM}Failed:    ${RESET}${dispatch.failedCount}`);
    if (sandboxes.length > 0) {
        console.log(`\n  ${CYAN}Active Sandboxes${RESET}`);
        for (const sb of sandboxes) {
            console.log(`    ${DIM}${sb.containerId.substring(0, 12)}${RESET} | ${sb.featureId} | ${sb.phaseId} | ${sb.status}`);
        }
    }
    console.log("");
}
function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
}
function formatPercent(val) {
    let c = RESET;
    if (val > 80)
        c = RED;
    else if (val > 60)
        c = YELLOW;
    return `${c}${val}%${RESET}`;
}
