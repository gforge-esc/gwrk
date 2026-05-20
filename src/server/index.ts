import fastify from "fastify";
import type { GwrkConfig } from "../utils/config.js";
import { healthRoutes } from "./routes/health.js";
import { removePid, writePid } from "./pid.js";

/**
 * Starts the gwrk build server.
 * Phase 1: Basic Fastify bootstrap and graceful shutdown.
 */
export async function startServer(
  config: GwrkConfig,
  options: { handleSignals?: boolean } = { handleSignals: true },
) {
  const server = fastify({
    logger: {
      level: "info",
    },
  });

  // Register routes
  await healthRoutes(server);

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
