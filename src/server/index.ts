import fastify from "fastify";
import type { GwrkConfig } from "../utils/config.js";
import { LocalInvocationStrategy } from "./backends/invocation-strategy.js";
import { DispatchOrchestrator } from "./dispatch-orchestrator.js";
import { DispatchQueue } from "./dispatch.js";
import { GitManager } from "./git-manager.js";
import { githubWebhookPlugin } from "./github.js";
import { PlanHeartbeat } from "./heartbeat.js";
import { HarvestWatcher } from "./harvest-watcher.js";
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
  monitor.startPolling();
  const sandbox = new SandboxManager();

  const git = new GitManager(projectRoot);
  const invocationStrategy = new LocalInvocationStrategy();
  const orchestrator = new DispatchOrchestrator(
    config,
    sandbox,
    invocationStrategy,
  );
  const queue = new DispatchQueue(
    config,
    monitor,
    sandbox,
    git,
    orchestrator,
    projectRoot,
  );

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

  lifecycle.start();
  network.start();

  // FR-015: Build Plan Heartbeat
  const slackApp = getSlackApp();
  const planHeartbeat = new PlanHeartbeat(config, slackApp, projectRoot);
  planHeartbeat.start();

  // Poll-based HarvestWatcher
  const harvestWatcher = new HarvestWatcher(config, slackApp, projectRoot);
  harvestWatcher.start();

  await healthRoutes(server, lifecycle, network, sandbox);
  await statusRoutes(server, monitor, queue, sandbox, lifecycle, network);
  await dispatchRoutes(server, queue);
  await githubWebhookPlugin(server, { config, projectRoot });
  await notifyRoutes(server);

  const shutdown = async () => {
    server.log.info("Shutting down server...");
    planHeartbeat.stop();
    harvestWatcher.stop();
    await stopSlackApp();
    lifecycle.stop();
    network.stop();
    monitor.stopPolling();
    await server.close();
    removePid();
    server.log.info("Server shut down.");
    if (options.handleSignals) {
      process.exit(0);
    }
  };

  if (options.handleSignals) {
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }

  try {
    const address = await server.listen({
      port: config.server.port,
      host: config.server.host,
    });
    console.log(`gwrk server listening on ${address}`);
    writePid(process.pid);

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

    return server;
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}
