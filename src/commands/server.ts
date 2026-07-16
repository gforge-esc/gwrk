/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { startServer } from "../server/index.js";
import { isPidRunning, readPid, removePid } from "../server/pid.js";
import { loadConfig } from "../utils/config.js";
import { isRemote } from "../utils/device.js";
import {
  getLogs,
  installServer,
  uninstallServer,
} from "./server-install.js";

import { CommandError, withSignal } from "../utils/signal.js";

const GWRK_DIR = path.join(os.homedir(), ".gwrk");
const LOG_FILE = path.join(GWRK_DIR, "server.log");

export const serverCommand = new Command("server").description(
  "Manage the gwrk build server daemon",
);

serverCommand
  .command("start")
  .description("Start the gwrk build server daemon")
  .option("-f, --foreground", "Run the server in the foreground")
  .action(async (options) => {
    await withSignal("server start", async () => {
      if (isRemote()) {
        throw new CommandError(
          "This machine is registered as a remote device. The daemon runs on the server only.\n" +
            "To change this machine's role: gwrk init --server",
          1,
        );
      }

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
      const projectRoot = process.env.GWRK_PROJECT_ROOT || process.cwd();
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
  .option("-f, --follow", "Follow the log output in real-time")
  .action(async (options) => {
    await withSignal("server logs", async () => {
      await getLogs(options);
    });
  });

serverCommand
  .command("install")
  .description(
    "Install gwrk server as a macOS LaunchAgent (starts on login, restarts on crash)",
  )
  .action(async () => {
    await withSignal("server install", async () => {
      if (process.platform !== "darwin") {
        throw new CommandError(
          "LaunchAgent install is only supported on macOS. On Linux, use systemd.",
          1,
        );
      }
      await installServer();
      console.log("LaunchAgent installed and loaded.");
    });
  });

serverCommand
  .command("uninstall")
  .description("Remove gwrk server LaunchAgent")
  .action(async () => {
    await withSignal("server uninstall", async () => {
      await uninstallServer();
      console.log("LaunchAgent uninstalled.");
    });
  });
