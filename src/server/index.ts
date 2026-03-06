import fastify from "fastify";
import type { GwrkConfig } from "../utils/config.js";
import { removePid, writePid } from "./pid.js";
import { SystemMonitor } from "./monitor.js";
import { statusRoutes } from "./routes/status.js";
import { SandboxManager } from "./sandbox.js";
import { GitManager } from "./git-manager.js";
import { DispatchQueue } from "./dispatch.js";
import { dispatchRoutes } from "./routes/dispatch.js";

export async function startServer(config: GwrkConfig, options: { handleSignals?: boolean } = { handleSignals: true }) {
  const projectRoot = process.cwd();
  const server = fastify({
    logger: true,
  });
  
  const monitor = new SystemMonitor();
  const sandbox = new SandboxManager();
  const git = new GitManager(projectRoot);
  const queue = new DispatchQueue(config, monitor, sandbox, git, projectRoot);

  server.get("/health", async () => {
    return { status: "ok" };
  });

  await statusRoutes(server, monitor, queue);
  await dispatchRoutes(server, queue);

  const shutdown = async () => {
    server.log.info("Shutting down server...");
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
    return server;
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}
