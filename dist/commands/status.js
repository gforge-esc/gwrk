import { Command } from "commander";
import { loadConfig } from "../utils/config.js";
import { readPid } from "../server/pid.js";
import { color } from "../utils/format.js";
const { BOLD, DIM, CYAN, GREEN, YELLOW, RED, RESET } = color;
export const statusCommand = new Command("status")
    .description("Show gwrk build server and system status")
    .option("--json", "Output status as JSON")
    .action(async (options) => {
    const projectRoot = process.cwd();
    const config = loadConfig(projectRoot);
    const pid = readPid();
    if (!pid) {
        if (options.json) {
            console.log(JSON.stringify({ server: { status: "stopped" } }, null, 2));
        }
        else {
            console.log(`\n  ${RED}●${RESET} ${BOLD}gwrk server is stopped${RESET}\n`);
        }
        return;
    }
    const url = `http://${config.server.host}:${config.server.port}/api/status`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }
        const status = await response.json();
        if (options.json) {
            console.log(JSON.stringify(status, null, 2));
            return;
        }
        printStatus(status);
    }
    catch (err) {
        if (options.json) {
            console.log(JSON.stringify({ server: { status: "stopped", pid } }, null, 2));
        }
        else {
            console.log(`\n  ${YELLOW}●${RESET} ${BOLD}gwrk server (PID ${pid}) is not responding${RESET}`);
            console.log(`    ${DIM}Endpoint: ${url}${RESET}\n`);
        }
    }
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
