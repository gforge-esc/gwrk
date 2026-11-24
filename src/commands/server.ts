/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { createHostedAuthFactory } from "../adapters/auth/hosted-auth-factory.js";
import {
  logCliOutput,
  setCliExitCode,
  warnCli,
} from "../adapters/cli/output-scope.js";
import { gwrkHome, usesHostedRuntime } from "../adapters/config/paths.js";
import {
  createSqliteAuthStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";
import { resolveHostedAuthConfig } from "../domain/hosted-auth-config.js";
import type { ClockPort } from "../ports/operations-port.js";
import { isLoopbackListenHost, startServer } from "../server/index.js";
import { isPidRunning, readPid, removePid } from "../server/pid.js";
import type { HealthResponse } from "../server/types.js";
import {
  type GwrkConfig,
  GwrkConfigSchema,
  deepMerge,
  loadConfig,
  validateTypedAuthSource,
} from "../utils/config.js";
import { isRemote } from "../utils/device.js";
import { getLogs, installServer, uninstallServer } from "./server-install.js";

import { CommandError, withSignal } from "../utils/signal.js";

function logFile(): string {
  return path.join(gwrkHome(), "server.log");
}

function loadServerConfig(projectRoot: string): GwrkConfig {
  try {
    return loadConfig(projectRoot);
  } catch (err) {
    const configPath = path.join(projectRoot, ".gwrkrc.json");
    if (fs.existsSync(configPath)) {
      throw err;
    }
    const registry = createSqliteProjectRegistryAdapter();
    try {
      const enrolled = registry.listProjects();
      if (enrolled.length === 0) {
        throw err;
      }
      let raw: Record<string, unknown> = {
        project: { name: enrolled[0].name },
      };
      const globalConfigPath = path.join(gwrkHome(), "config.json");
      if (fs.existsSync(globalConfigPath)) {
        const content = fs.readFileSync(globalConfigPath, "utf-8");
        let overlay: Record<string, unknown> | undefined;
        try {
          overlay = JSON.parse(content) as Record<string, unknown>;
        } catch {
          if (content.includes("auth") || /\\u0061uth/i.test(content)) {
            throw new Error(
              "Configuration error: Authentication configuration denied",
            );
          }
          // Ignore malformed global overlay and fall back to defaults.
        }
        if (overlay) {
          validateTypedAuthSource(overlay);
          raw = deepMerge(raw, overlay);
        }
      }
      if (process.env.GITHUB_WEBHOOK_SECRET) {
        raw.server = {
          ...(typeof raw.server === "object" && raw.server !== null
            ? (raw.server as Record<string, unknown>)
            : {}),
          githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
        };
      }
      return GwrkConfigSchema.parse(raw);
    } finally {
      registry.close();
    }
  }
}

function validateServerAuth(config: GwrkConfig): {
  readonly isHosted: boolean;
  readonly rawAuth: unknown;
} {
  const hostedRuntime = usesHostedRuntime();
  const isLoopback = isLoopbackListenHost(config.server.host);
  const rawAuth = Reflect.get(config.server, "auth");
  const pureRes = resolveHostedAuthConfig({
    auth: rawAuth,
    environment: process.env,
  });

  if (!pureRes.ok) {
    throw new CommandError(
      `${pureRes.error.message}: ${pureRes.error.field} (${pureRes.error.code})`,
      1,
    );
  }

  const isHosted = pureRes.value.mode === "hosted";

  if (hostedRuntime && !isHosted) {
    throw new CommandError(
      "Hosted runner requires hosted authentication mode",
      1,
    );
  }

  if (!isLoopback && !isHosted) {
    throw new CommandError(
      "Non-loopback listen address requires hosted authentication mode",
      1,
    );
  }

  return { isHosted, rawAuth };
}

async function runServerForeground(
  config: GwrkConfig,
  projectRoot: string,
): Promise<void> {
  const authOpts = validateServerAuth(config);
  await startServer(config, {
    handleSignals: true,
    projectRoot,
    useProjectRegistry: true,
    ...(authOpts.isHosted
      ? {
          transport: "hosted" as const,
          runnerKind: "hosted" as const,
          initHostedAuth: async ({ db, clock }) => {
            const authStore = createSqliteAuthStoreAdapter({ db });
            const factory = createHostedAuthFactory({
              store: authStore,
              clock,
            });
            const authInit = await factory.initialize({
              auth: authOpts.rawAuth,
              environment: process.env,
              secretsRoot: process.env.GWRK_SECRETS_DIR,
            });
            if (!authInit.ok) {
              throw new CommandError(
                `${authInit.error.message}: ${authInit.error.field} (${authInit.error.code})`,
                1,
              );
            }
            if (authInit.mode !== "hosted") {
              throw new CommandError(
                "Hosted runner requires hosted authentication mode",
                1,
              );
            }
            return authInit.hostedAuth;
          },
        }
      : {}),
  });
}

export function createServerCommand(): Command {
  const serverCommand = new Command("server").description(
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
        const config = loadServerConfig(projectRoot);
        validateServerAuth(config);

        const existingPid = readPid();
        if (!usesHostedRuntime() && existingPid && isPidRunning(existingPid)) {
          throw new CommandError(
            `Server already running (pid: ${existingPid}). Run 'gwrk server stop' first.`,
            1,
          );
        }

        if (options.foreground) {
          await runServerForeground(config, projectRoot);
        } else {
          fs.mkdirSync(gwrkHome(), { recursive: true });
          const out = fs.openSync(logFile(), "a");
          const err = fs.openSync(logFile(), "a");

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
            if (
              pid &&
              (!usesHostedRuntime() || pid === child.pid) &&
              isPidRunning(pid)
            ) {
              logCliOutput(`gwrk server started (pid: ${pid})`);
              logCliOutput(
                `gwrk server listening on http://${config.server.host}:${config.server.port}`,
              );
              logCliOutput(`Logs: ${logFile()}`);
              return;
            }
            attempts++;
          }
          throw new CommandError(
            `Failed to start server. Check ${logFile()} for details.`,
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
        const config = loadServerConfig(projectRoot);
        await runServerForeground(config, projectRoot);
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

        logCliOutput(`Stopping server (pid: ${pid})...`);
        try {
          process.kill(pid, "SIGTERM");
        } catch (err) {
          throw new CommandError(`Failed to kill process ${pid}: ${err}`, 1);
        }

        let attempts = 0;
        while (attempts < 20) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (!isPidRunning(pid)) {
            logCliOutput("Server stopped.");
            return;
          }
          attempts++;
        }

        warnCli("Server did not stop gracefully. Force killing...");
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // ignore
        }
        removePid();
        logCliOutput("Server force killed.");
      });
    });

  serverCommand
    .command("status")
    .description("Check if the gwrk build server is running")
    .action(async () => {
      await withSignal("server status", async () => {
        const projectRoot = process.cwd();
        const config = loadServerConfig(projectRoot);
        const pid = readPid();

        if (!pid || !isPidRunning(pid)) {
          logCliOutput("Server: not running");
          setCliExitCode(1);
          return;
        }

        const url = `http://${config.server.host}:${config.server.port}`;
        logCliOutput(`Server: running (pid: ${pid})`);
        logCliOutput(`Listen: ${url}`);
        logCliOutput(`Logs:   ${logFile()}`);

        // Health check
        try {
          const resp = await fetch(`${url}/health`, {
            signal: AbortSignal.timeout(5_000),
            redirect: "manual",
          });
          if (resp.status >= 300 && resp.status < 400) {
            void resp.body?.cancel().catch(() => {});
            logCliOutput("Health: unreachable (redirect not allowed)");
            setCliExitCode(1);
            return;
          }
          if (!resp.ok) {
            void resp.body?.cancel().catch(() => {});
            throw new Error(`HTTP ${resp.status}`);
          }
          const data = (await resp.json()) as Partial<HealthResponse>;
          logCliOutput(`Health: ${data.status || "unknown"}`);
          if (data.daemonLiveness) {
            logCliOutput(`Daemon: ${data.daemonLiveness}`);
          }
        } catch {
          logCliOutput("Health: unreachable (port bound but not responding)");
          setCliExitCode(1);
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
        if (isRemote()) {
          throw new CommandError(
            "This machine is registered as a remote device. The daemon runs on the server only.\n" +
              "To change this machine's role: gwrk init --server",
            1,
          );
        }
        if (process.platform !== "darwin") {
          throw new CommandError(
            "LaunchAgent install is only supported on macOS. On Linux, use systemd.",
            1,
          );
        }
        await installServer();
        logCliOutput("LaunchAgent installed and loaded.");
      });
    });

  serverCommand
    .command("uninstall")
    .description("Remove gwrk server LaunchAgent")
    .action(async () => {
      await withSignal("server uninstall", async () => {
        await uninstallServer();
        logCliOutput("LaunchAgent uninstalled.");
      });
    });
  return serverCommand;
}

export const serverCommand = createServerCommand();
