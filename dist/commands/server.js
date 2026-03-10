import { Command } from "commander";
import { startServer } from "../server/index.js";
import { readPid, isPidRunning, removePid } from "../server/pid.js";
import { loadConfig } from "../utils/config.js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
export const serverCommand = new Command("server")
    .description("Manage the gwrk build server daemon");
serverCommand
    .command("start")
    .description("Start the gwrk build server daemon")
    .option("-f, --foreground", "Run the server in the foreground")
    .action(async (options) => {
    const projectRoot = process.cwd();
    const config = loadConfig(projectRoot);
    const existingPid = readPid();
    if (existingPid && isPidRunning(existingPid)) {
        console.error(`Server already running (pid: ${existingPid})`);
        process.exit(1);
    }
    if (options.foreground) {
        await startServer(config);
    }
    else {
        const logDir = path.join(projectRoot, ".gwrk");
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const logFile = path.join(logDir, "server.log");
        const out = fs.openSync(logFile, "a");
        const err = fs.openSync(logFile, "a");
        const child = spawn(process.argv[0], [
            ...process.execArgv,
            process.argv[1],
            "server",
            "_run"
        ], {
            detached: true,
            stdio: ["ignore", out, err],
            cwd: projectRoot,
            env: { ...process.env, GWRK_PROJECT_ROOT: projectRoot }
        });
        child.unref();
        // Wait for PID file to appear
        let attempts = 0;
        while (attempts < 10) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const pid = readPid();
            if (pid && isPidRunning(pid)) {
                console.log(`gwrk server started (pid: ${pid})`);
                console.log(`gwrk server listening on http://${config.server.host}:${config.server.port}`);
                return;
            }
            attempts++;
        }
        console.error("Failed to start server. Check .gwrk/server.log for details.");
        process.exit(1);
    }
});
serverCommand
    .command("_run", { hidden: true })
    .description("Internal command to run the server")
    .action(async () => {
    const projectRoot = process.cwd();
    const config = loadConfig(projectRoot);
    await startServer(config, { handleSignals: true });
});
serverCommand
    .command("stop")
    .description("Stop the gwrk build server daemon")
    .action(async () => {
    const pid = readPid();
    if (!pid || !isPidRunning(pid)) {
        console.error("No server running");
        process.exit(1);
    }
    console.log(`Stopping server (pid: ${pid})...`);
    try {
        process.kill(pid, "SIGTERM");
    }
    catch (err) {
        console.error(`Failed to kill process ${pid}: ${err}`);
        process.exit(1);
    }
    let attempts = 0;
    while (attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (!isPidRunning(pid)) {
            console.log("Server stopped.");
            return;
        }
        attempts++;
    }
    console.warn("Server did not stop gracefully. Force killing...");
    try {
        process.kill(pid, "SIGKILL");
    }
    catch (err) {
        // ignore
    }
    removePid();
    console.log("Server force killed.");
});
