/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import fastify from "fastify";
import { gwrkRuntimeDir, usesHostedRuntime } from "../adapters/config/paths.js";
import {
  acquireInstanceLock,
  acquireLedgerLock,
} from "../adapters/server/instance-lock.js";
import { closeDb, getDbPath } from "../db/index.js";
import { PENDING_LEDGER_RESTORE } from "../domain/ledger-backup.js";
import { isPrivateRunnerBind } from "../domain/release-packaging.js";
import type { InstanceLockHandle } from "../ports/release-ops-port.js";
import type { GwrkConfig } from "../utils/config.js";
import { DispatchQueue } from "./dispatch.js";
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

import { loadRegistry } from "./agent-registry.js";
import { BackendSelector } from "./backend-selector.js";
import { QuotaProber } from "./quota-prober.js";

export { BackendSelector } from "./backend-selector.js";
export { QuotaProber } from "./quota-prober.js";
export { loadRegistry } from "./agent-registry.js";

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

export async function startServer(
  config: GwrkConfig,
  options: { handleSignals?: boolean } = { handleSignals: true },
) {
  const hosted = usesHostedRuntime();
  if (hosted && !isPrivateRunnerBind(config.server.host)) {
    throw new Error("The hosted runner requires a private listen address.");
  }
  const instanceLock = hosted
    ? acquireInstanceLock(gwrkRuntimeDir(), process.pid)
    : undefined;
  let ledgerLock: InstanceLockHandle | undefined;
  try {
    if (instanceLock) ledgerLock = acquireLedgerLock(getDbPath(), process.pid);
    if (
      instanceLock &&
      existsSync(join(dirname(getDbPath()), PENDING_LEDGER_RESTORE))
    ) {
      throw new Error(
        "An unfinished ledger restore blocks startup. Retry 'gwrk db restore' with the original backup.",
      );
    }
    return await startLockedServer(config, options, instanceLock, ledgerLock);
  } catch (error) {
    ledgerLock?.release();
    instanceLock?.release();
    throw error;
  }
}

async function startLockedServer(
  config: GwrkConfig,
  options: { handleSignals?: boolean },
  instanceLock: InstanceLockHandle | undefined,
  ledgerLock: InstanceLockHandle | undefined,
) {
  const projectRoot = process.cwd();
  const server = fastify({
    logger: true,
  });

  // GitHub webhook is optional — plugin handles the missing case gracefully
  if (!config.server.githubWebhookSecret) {
    console.warn(
      "GitHub webhook secret not configured. Webhook endpoint will be disabled. Set GITHUB_WEBHOOK_SECRET to enable.",
    );
  }

  const monitor = new SystemMonitor(config);
  const sandbox = new SandboxManager();

  const git = new GitManager(projectRoot);
  const queue = new DispatchQueue(config, monitor, sandbox, projectRoot);

  const lifecycle = new LifecycleMonitor(config);
  const network = new NetworkMonitor(config);

  const reconnect = async () => {
    server.log.info("Executing Graceful Reconnect Protocol...");
    lifecycle.setStatus("degraded");

    // 1. Re-sample system resources
    monitor.sample();

    // 2. Verify Git availability
    const gitOk = await sandbox.checkGit();

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

  // FR-015: Build Plan Heartbeat
  const slackApp = getSlackApp();
  const planHeartbeat = new PlanHeartbeat(config, slackApp, projectRoot);

  // Poll-based HarvestWatcher
  const harvestWatcher = new HarvestWatcher(config, slackApp, projectRoot);

  let pidWritten = false;
  const shutdown = () => {
    server.log.info("Shutting down server...");
    void server.close().then(
      () => process.exit(0),
      (error) => {
        server.log.error(error);
        process.exit(1);
      },
    );
  };
  server.addHook("onClose", async () => {
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
    queue.pause();
    planHeartbeat.stop();
    harvestWatcher.stop();
    lifecycle.stop();
    network.stop();
    monitor.stopPolling();
    try {
      const results = await Promise.allSettled([
        stopSlackApp(),
        stopTelegramBot(),
      ]);
      for (const result of results) {
        if (result.status === "rejected") server.log.error(result.reason);
      }
    } finally {
      try {
        if (ledgerLock) closeDb();
        if (pidWritten) removePid();
      } finally {
        ledgerLock?.release();
        instanceLock?.release();
      }
    }
  });

  try {
    await healthRoutes(server, lifecycle, network, sandbox);
    await statusRoutes(server, monitor, queue, sandbox, lifecycle, network);
    await dispatchRoutes(server, queue);
    await githubWebhookPlugin(server, { config, projectRoot });
    await notifyRoutes(server);

    monitor.startPolling();
    lifecycle.start();
    network.start();
    planHeartbeat.start();
    harvestWatcher.start();

    if (options.handleSignals) {
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
    }

    const address = await server.listen({
      port: config.server.port,
      host: config.server.host,
    });
    console.log(`gwrk server listening on ${address}`);
    writePid(process.pid);
    pidWritten = true;

    // FR-002: Prune worktrees on startup
    await sandbox.pruneSandboxes();

    // Start Slack if configured
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

    // Start Telegram if configured
    await startTelegramBot({
      queue,
      monitor,
      git,
      projectRoot,
      config,
    });

    return server;
  } catch (error) {
    await server.close().catch((closeError) => server.log.error(closeError));
    throw error;
  }
}
