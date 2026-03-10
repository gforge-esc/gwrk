import type { FastifyInstance } from "fastify";
import type { LifecycleMonitor } from "../lifecycle.js";
import type { NetworkMonitor } from "../network.js";
import type { SandboxManager } from "../sandbox.js";
import type { HealthResponse } from "../types.js";

export async function healthRoutes(
  server: FastifyInstance,
  lifecycle: LifecycleMonitor,
  network: NetworkMonitor,
  sandbox: SandboxManager,
) {
  server.get("/health", async (): Promise<HealthResponse> => {
    const dockerOk = await sandbox.checkDocker();
    const networkOk = network.isOnline();
    const lifecycleStatus = lifecycle.getStatus();

    const components = {
      server: {
        status: lifecycleStatus === "degraded" ? "degraded" : "ok",
      } as const,
      docker: {
        status: dockerOk ? "ok" : "unavailable",
      } as const,
      network: {
        status: networkOk ? "ok" : "unavailable",
      } as const,
    };

    const overallStatus =
      components.server.status === "ok" &&
      components.docker.status === "ok" &&
      components.network.status === "ok"
        ? "ok"
        : "degraded";

    return {
      status: overallStatus,
      components,
    };
  });
}
