import fastify from "fastify";
import type { GwrkConfig } from "../utils/config.js";
import { DispatchQueue } from "./dispatch.js";
import { ensureDocker } from "./docker.js";
import { GitManager } from "./git-manager.js";
import { LifecycleMonitor } from "./lifecycle.js";
import { SystemMonitor } from "./monitor.js";
import { NetworkMonitor } from "./network.js";
import { removePid, writePid } from "./pid.js";
import { dispatchRoutes } from "./routes/dispatch.js";
import { healthRoutes } from "./routes/health.js";
import { notifyRoutes } from "./routes/notify.js";
import { statusRoutes } from "./routes/status.js";
import { SandboxManager } from "./sandbox.js";
import { startSlackApp, stopSlackApp } from "./slack.js";

export async function startServer(
  config: GwrkConfig,
  options: { handleSignals?: boolean } = { handleSignals: true },
) {
  const projectRoot = process.cwd();
  const server = fastify({
    logger: true,
  });

  // Ensure Docker is available — auto-start if needed
  await ensureDocker();

  const monitor = new SystemMonitor(config);
  monitor.startPolling();
  const sandbox = new SandboxManager();

  const git = new GitManager(projectRoot);
  const queue = new DispatchQueue(config, monitor, sandbox, git, projectRoot);

  const lifecycle = new LifecycleMonitor(config);
  const network = new NetworkMonitor(config);

  const reconnect = async () => {
    server.log.info("Executing Graceful Reconnect Protocol...");
    lifecycle.setStatus("degraded");

    // 1. Re-sample system resources
    monitor.sample();

    // 2. Verify Docker daemon reachability
    const dockerOk = await sandbox.checkDocker();

    // 3. Verify network connectivity
    const networkOk = network.isOnline();

    if (dockerOk && networkOk) {
      server.log.info("Reconnect successful. Resuming...");
      lifecycle.setStatus("ready");
      await sandbox.unpauseAll();
      queue.resume();
    } else {
      server.log.warn(
        `Reconnect failed. Docker: ${dockerOk}, Network: ${networkOk}`,
      );
      lifecycle.setStatus("degraded");
    }
  };

  lifecycle.on("server:sleep", async () => {
    server.log.info("Sleep detected. Pausing...");
    queue.pause();
    await sandbox.pauseAll();
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

  await healthRoutes(server, lifecycle, network, sandbox);
  await statusRoutes(server, monitor, queue, sandbox, lifecycle, network);
  await dispatchRoutes(server, queue);
  await notifyRoutes(server);

  const shutdown = async () => {
    server.log.info("Shutting down server...");
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
