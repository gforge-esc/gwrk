import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { startServer } from "../server/index.js";
import { isPidRunning, readPid, removePid } from "../server/pid.js";
import { loadConfig } from "../utils/config.js";

import { CommandError, withSignal } from "../utils/signal.js";

const GWRK_DIR = path.join(os.homedir(), ".gwrk");
const LOG_FILE = path.join(GWRK_DIR, "server.log");
const PLIST_NAME = "com.gwrk.server";
const PLIST_PATH = path.join(
  os.homedir(),
  "Library",
  "LaunchAgents",
  `${PLIST_NAME}.plist`,
);

export const serverCommand = new Command("server").description(
  "Manage the gwrk build server daemon",
);

serverCommand
  .command("start")
  .description("Start the gwrk build server daemon")
  .option("-f, --foreground", "Run the server in the foreground")
  .action(async (options) => {
    await withSignal("server start", async () => {
      const projectRoot = process.cwd();
      const config = loadConfig(projectRoot);

      const existingPid = readPid();
      if (existingPid && isPidRunning(existingPid)) {
        throw new CommandError(
          `Server already running (pid: ${existingPid}). Run 'gwrk server stop' first.`,
          1,
        );
      }

      if (options.foreground) {
        await startServer(config);
      } else {
        if (!fs.existsSync(GWRK_DIR)) {
          fs.mkdirSync(GWRK_DIR, { recursive: true });
        }
        const out = fs.openSync(LOG_FILE, "a");
        const err = fs.openSync(LOG_FILE, "a");

        const child = spawn(
          process.argv[0],
          [...process.execArgv, process.argv[1], "server", "_run"],
          {
            detached: true,
            stdio: ["ignore", out, err],
            cwd: projectRoot,
            env: { ...process.env, GWRK_PROJECT_ROOT: projectRoot },
          },
        );

        child.unref();

        // Wait for PID file to appear
        let attempts = 0;
        while (attempts < 10) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const pid = readPid();
          if (pid && isPidRunning(pid)) {
            console.log(`gwrk server started (pid: ${pid})`);
            console.log(
              `gwrk server listening on http://${config.server.host}:${config.server.port}`,
            );
            console.log(`Logs: ${LOG_FILE}`);
            return;
          }
          attempts++;
        }
        throw new CommandError(
          `Failed to start server. Check ${LOG_FILE} for details.`,
          1,
        );
      }
    });
  });

serverCommand
  .command("_run", { hidden: true })
  .description("Internal command to run the server")
  .action(async () => {
    await withSignal("server _run", async () => {
      const projectRoot =
        process.env.GWRK_PROJECT_ROOT || process.cwd();
      const config = loadConfig(projectRoot);
      await startServer(config, { handleSignals: true });
    });
  });

serverCommand
  .command("stop")
  .description("Stop the gwrk build server daemon")
  .action(async () => {
    await withSignal("server stop", async () => {
      const pid = readPid();
      if (!pid || !isPidRunning(pid)) {
        throw new CommandError("No server running", 1);
      }

      console.log(`Stopping server (pid: ${pid})...`);
      try {
        process.kill(pid, "SIGTERM");
      } catch (err) {
        throw new CommandError(`Failed to kill process ${pid}: ${err}`, 1);
      }

      let attempts = 0;
      while (attempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (!isPidRunning(pid)) {
          console.log("Server stopped.");
          return;
        }
        attempts++;
      }

      console.warn("Server did not stop gracefully. Force killing...");
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // ignore
      }
      removePid();
      console.log("Server force killed.");
    });
  });

serverCommand
  .command("status")
  .description("Check if the gwrk build server is running")
  .action(async () => {
    await withSignal("server status", async () => {
      const projectRoot = process.cwd();
      const config = loadConfig(projectRoot);
      const pid = readPid();

      if (!pid || !isPidRunning(pid)) {
        console.log("Server: not running");
        process.exitCode = 1;
        return;
      }

      const url = `http://${config.server.host}:${config.server.port}`;
      console.log(`Server: running (pid: ${pid})`);
      console.log(`Listen: ${url}`);
      console.log(`Logs:   ${LOG_FILE}`);

      // Health check
      try {
        const resp = await fetch(`${url}/health`);
        const data = (await resp.json()) as {
          status?: string;
          components?: Record<string, { status: string }>;
        };
        console.log(`Health: ${data.status || "unknown"}`);
        if (data.components) {
          for (const [name, info] of Object.entries(data.components)) {
            const icon = info.status === "ok" ? "✓" : "✗";
            console.log(`  ${icon} ${name}: ${info.status}`);
          }
        }
      } catch {
        console.log("Health: unreachable (port bound but not responding)");
      }
    });
  });

serverCommand
  .command("logs")
  .description("Tail the gwrk server log")
  .option("-n, --lines <count>", "Number of lines to show", "50")
  .option("-f, --follow", "Follow the log output in real-time")
  .action(async (options) => {
    await withSignal("server logs", async () => {
      if (!fs.existsSync(LOG_FILE)) {
        throw new CommandError(
          `No server log found at ${LOG_FILE}. Has the server been started?`,
          1,
        );
      }

      const args = ["-n", options.lines];
      if (options.follow) {
        args.push("-f");
      }
      args.push(LOG_FILE);

      const tail = spawn("tail", args, {
        stdio: "inherit",
      });

      // Forward SIGINT to tail for clean exit
      process.on("SIGINT", () => {
        tail.kill("SIGINT");
      });

      await new Promise<void>((resolve, reject) => {
        tail.on("exit", (code) => {
          if (code === 0 || code === null) {
            resolve();
          } else {
            reject(new CommandError(`tail exited with code ${code}`, 1));
          }
        });
      });
    });
  });

serverCommand
  .command("install")
  .description("Install gwrk server as a macOS LaunchAgent (starts on login, restarts on crash)")
  .action(async () => {
    await withSignal("server install", async () => {
      if (process.platform !== "darwin") {
        throw new CommandError(
          "LaunchAgent install is only supported on macOS. On Linux, use systemd.",
          1,
        );
      }

      const projectRoot = process.cwd();
      // Verify config exists
      loadConfig(projectRoot);

      // Resolve the gwrk binary path
      const gwrkBin = process.argv[1];
      const nodeBin = process.argv[0];

      if (!fs.existsSync(GWRK_DIR)) {
        fs.mkdirSync(GWRK_DIR, { recursive: true });
      }

      // launchd KeepAlive restarts the process if it dies during sleep.
      // lifecycle.ts detects wake via heartbeat drift and reconnects Slack.
      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${gwrkBin}</string>
    <string>server</string>
    <string>_run</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${projectRoot}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>GWRK_PROJECT_ROOT</key>
    <string>${projectRoot}</string>
    <key>PATH</key>
    <string>${process.env.PATH}</string>
    <key>HOME</key>
    <string>${os.homedir()}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>`;

      // Ensure LaunchAgents directory exists
      const launchAgentsDir = path.dirname(PLIST_PATH);
      if (!fs.existsSync(launchAgentsDir)) {
        fs.mkdirSync(launchAgentsDir, { recursive: true });
      }

      // Unload existing if present
      if (fs.existsSync(PLIST_PATH)) {
        try {
          execSync(`launchctl unload ${PLIST_PATH}`, { stdio: "ignore" });
        } catch {
          // ignore — may not be loaded
        }
      }

      // Stop any existing manual server
      const pid = readPid();
      if (pid && isPidRunning(pid)) {
        console.log(`Stopping existing server (pid: ${pid})...`);
        try {
          process.kill(pid, "SIGTERM");
          // Wait briefly
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch {
          // ignore
        }
      }

      fs.writeFileSync(PLIST_PATH, plistContent, "utf8");
      console.log(`Wrote ${PLIST_PATH}`);

      execSync(`launchctl load ${PLIST_PATH}`);
      console.log("LaunchAgent loaded. Server will:");
      console.log("  • Start on login (RunAtLoad)");
      console.log("  • Restart on crash or wake (KeepAlive)");
      console.log(`  • Log to ${LOG_FILE}`);
      console.log("");
      console.log("Use 'gwrk server status' to verify.");
      console.log("Use 'gwrk server logs' to tail output.");
      console.log("Use 'gwrk server uninstall' to remove.");
    });
  });

serverCommand
  .command("uninstall")
  .description("Remove gwrk server LaunchAgent")
  .action(async () => {
    await withSignal("server uninstall", async () => {
      if (!fs.existsSync(PLIST_PATH)) {
        throw new CommandError(
          "No LaunchAgent installed. Nothing to uninstall.",
          1,
        );
      }

      try {
        execSync(`launchctl unload ${PLIST_PATH}`, { stdio: "ignore" });
      } catch {
        // may not be loaded
      }

      fs.unlinkSync(PLIST_PATH);
      console.log("LaunchAgent unloaded and removed.");
      console.log("Server will no longer start on login or restart on crash.");
    });
  });
