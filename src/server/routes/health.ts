import type { FastifyInstance } from "fastify";
import type { LifecycleMonitor } from "../lifecycle.js";
import type { NetworkMonitor } from "../network.js";
import type { SandboxManager } from "../sandbox.js";
import { isSlackConnected } from "../slack.js";
import type { HealthResponse } from "../types.js";

export async function healthRoutes(
  server: FastifyInstance,
  lifecycle: LifecycleMonitor,
  network: NetworkMonitor,
  sandbox: SandboxManager,
) {
  server.get("/health", async (): Promise<HealthResponse> => {
    const gitOk = await sandbox.checkGit();
    const networkOk = network.isOnline();
    const slackOk = await isSlackConnected();
    const lifecycleStatus = lifecycle.getStatus();

    const components = {
      server: {
        status: lifecycleStatus === "degraded" ? "degraded" : "ok",
      } as const,
      git: {
        status: gitOk ? "ok" : "unavailable",
      } as const,
      network: {
        status: networkOk ? "ok" : "unavailable",
      } as const,
      slack: {
        status: slackOk ? "ok" : "unavailable",
      } as const,
    };

    const overallStatus =
      components.server.status === "ok" &&
      components.git.status === "ok" &&
      components.network.status === "ok" &&
      components.slack.status === "ok"
        ? "ok"
        : "degraded";

    return {
      status: overallStatus,
      components,
    };
  });
}
