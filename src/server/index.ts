/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import fastify from "fastify";
import { loadRegistry } from "../adapters/agents/registry-loader.js";
import {
  exitCli,
  logCliOutput,
  warnCli,
} from "../adapters/cli/output-scope.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import type { GwrkConfig } from "../utils/config.js";
import { type DispatchLedgerScope, DispatchQueue } from "./dispatch.js";
import { GitManager } from "./git-manager.js";
import { githubWebhookPlugin } from "./github.js";
import { HarvestWatcher } from "./harvest-watcher.js";
import { PlanHeartbeat } from "./heartbeat.js";
import { LifecycleMonitor } from "./lifecycle.js";
import { SystemMonitor } from "./monitor.js";
import { NetworkMonitor } from "./network.js";
import { removePid, writePid } from "./pid.js";
import { dispatchRoutes } from "./routes/dispatch.js";
import { healthRoutes } from "./routes/health.js";
import { notifyRoutes } from "./routes/notify.js";
import { statusRoutes } from "./routes/status.js";
import { SandboxManager } from "./sandbox.js";
import { getSlackApp, startSlackApp, stopSlackApp } from "./slack.js";
import { startTelegramBot, stopTelegramBot } from "./telegram.js";
import type { SandboxInfo } from "./types.js";

import { QuotaProber } from "../adapters/agents/quota-prober.js";
import { BackendSelector } from "./backend-selector.js";

export { BackendSelector } from "./backend-selector.js";
export { QuotaProber } from "../adapters/agents/quota-prober.js";
export { loadRegistry } from "../adapters/agents/registry-loader.js";

let backendSelector: BackendSelector | undefined;
export function getBackendSelector(
  projectRoot: string = process.cwd(),
): BackendSelector {
  if (!backendSelector) {
    const registry = loadRegistry(projectRoot);
    const prober = new QuotaProber(projectRoot);
    backendSelector = new BackendSelector(registry, prober);
  }
  return backendSelector;
}

export interface ServerPidScope {
  writePid(pid: number): void;
  removePid(): void;
}

export interface ServerStartOptions {
  handleSignals?: boolean;
  projectRoot?: string;
  pid?: ServerPidScope;
  ledger?: DispatchLedgerScope;
}

export class ScopedSandboxManager extends SandboxManager {
  constructor(private readonly root: string) {
    super(root);
  }

  protected override gitOptions() {
    return { env: repositoryGitEnv(this.root) };
  }

  override async pruneSandboxes(): Promise<void> {
    if (!existsSync(join(this.root, ".git"))) return;
    execFileSync("git", ["worktree", "prune"], {
      cwd: this.root,
      ...this.gitOptions(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    });
  }

  override async listSandboxes(): Promise<SandboxInfo[]> {
    return this.listRecords()
      .filter(({ orphaned }) => !orphaned)
      .map(
        ({ workDir, featureId, createdAt }) =>
          ({
            workDir,
            featureId,
            taskId: basename(workDir).split("-").at(-2) ?? "",
            status: "running",
            startedAt: createdAt,
          }) as SandboxInfo,
      );
  }
}

let slackInUse = false;
let telegramInUse = false;

export async function startServer(
  config: GwrkConfig,
  options: ServerStartOptions = { handleSignals: true },
) {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const pid = options.pid ?? { writePid, removePid };
  const server = fastify({
    logger: true,
  });

  // GitHub webhook is optional — plugin handles the missing case gracefully
  if (!config.server.githubWebhookSecret) {
    warnCli(
      "GitHub webhook secret not configured. Webhook endpoint will be disabled. Set GITHUB_WEBHOOK_SECRET to enable.",
    );
  }

  const monitor = new SystemMonitor(config);
  const sandbox =
    options.projectRoot === undefined
      ? new SandboxManager(projectRoot)
      : new ScopedSandboxManager(projectRoot);

  const git = new GitManager(projectRoot);
  const queue = new DispatchQueue(
    config,
    monitor,
    sandbox,
    projectRoot,
    options.ledger,
  );

  const lifecycle = new LifecycleMonitor(config);
  const network = new NetworkMonitor(config);

  let closing = false;
  const reconnect = async () => {
    if (closing) return;
    server.log.info("Executing Graceful Reconnect Protocol...");
    lifecycle.setStatus("degraded");

    // 1. Re-sample system resources
    monitor.sample();

    // 2. Verify Git availability
    const gitOk = await sandbox.checkGit();

    if (closing) return;

    // 3. Verify network connectivity
    const networkOk = network.isOnline();

    if (gitOk && networkOk) {
      server.log.info("Reconnect successful. Resuming...");
      lifecycle.setStatus("ready");
      queue.resume();
    } else {
      server.log.warn(`Reconnect failed. Git: ${gitOk}, Network: ${networkOk}`);
      lifecycle.setStatus("degraded");
    }
  };

  lifecycle.on("server:sleep", async () => {
    server.log.info("Sleep detected. Pausing...");
    queue.pause();
  });

  lifecycle.on("server:wake", async () => {
    server.log.info("Wake detected. Waiting for health checks...");
    await reconnect();
  });

  network.on("network:down", () => {
    server.log.warn("Network down. Pausing dispatch queue.");
    queue.pause();
  });

  network.on("network:up", async () => {
    server.log.info("Network up. Verifying health...");
    await reconnect();
  });

  let pidWriteAttempted = false;
  const cleanup: Array<() => void | Promise<void>> = [() => queue.close()];

  const shutdown = async () => {
    server.log.info("Shutting down server...");
    try {
      await server.close();
      server.log.info("Server shut down.");
      if (options.handleSignals) process.exit(0);
    } catch (err) {
      server.log.error(err);
      if (options.handleSignals) exitCli(1);
    }
  };

  server.addHook("onClose", async () => {
    closing = true;
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
    const errors: unknown[] = [];
    const releases = cleanup.splice(0);
    if (pidWriteAttempted) {
      pidWriteAttempted = false;
      releases.push(() => pid.removePid());
    }
    for (const release of releases) {
      try {
        await release();
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(errors, "Server cleanup failed");
  });

  try {
    await healthRoutes(server, lifecycle, network, sandbox);
    await statusRoutes(server, monitor, queue, sandbox, lifecycle, network);
    await dispatchRoutes(server, queue);
    await githubWebhookPlugin(server, {
      config,
      projectRoot,
      ledger: options.ledger,
    });
    await notifyRoutes(server);

    const address = await server.listen({
      port: config.server.port,
      host: config.server.host,
    });
    logCliOutput(`gwrk server listening on ${address}`);

    // Register cleanup before any service can start.
    const stopPolling = () => monitor.stopPolling();
    const stopLifecycle = () => lifecycle.stop();
    const stopNetwork = () => network.stop();
    cleanup.push(stopPolling, stopLifecycle, stopNetwork);

    pidWriteAttempted = true;
    pid.writePid(process.pid);

    // FR-002: Prune worktrees on startup
    await sandbox.pruneSandboxes();

    monitor.startPolling();
    lifecycle.start();
    network.start();

    const slackApp = slackInUse ? null : getSlackApp();
    const planHeartbeat = new PlanHeartbeat(
      config,
      slackApp,
      projectRoot,
      options.ledger,
    );
    cleanup.push(() => planHeartbeat.stop());
    planHeartbeat.start();

    const harvestWatcher = new HarvestWatcher(
      config,
      slackApp,
      projectRoot,
      options.ledger,
    );
    cleanup.push(() => harvestWatcher.stop());
    harvestWatcher.start();

    if (!slackInUse) {
      if (slackApp) {
        slackInUse = true;
        cleanup.push(async () => {
          try {
            await stopSlackApp();
          } finally {
            slackInUse = false;
          }
        });
      }
      await startSlackApp({
        queue,
        monitor,
        sandbox,
        lifecycle,
        network,
        git,
        projectRoot,
        config,
      });
    }

    if (!telegramInUse) {
      telegramInUse = true;
      cleanup.push(async () => {
        try {
          await stopTelegramBot();
        } finally {
          telegramInUse = false;
        }
      });
      await startTelegramBot({ queue, monitor, git, projectRoot, config });
    }

    if (options.handleSignals) {
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);
    }

    return server;
  } catch (err) {
    try {
      await server.close();
    } catch (cleanupError) {
      server.log.error(cleanupError);
    }
    server.log.error(err);
    if (options.handleSignals) exitCli(1);
    throw err;
  }
}
