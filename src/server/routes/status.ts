import type { FastifyInstance } from "fastify";
import type { DispatchQueue } from "../dispatch.js";
import type { LifecycleMonitor } from "../lifecycle.js";
import type { SystemMonitor } from "../monitor.js";
import type { NetworkMonitor } from "../network.js";
import type { SandboxManager } from "../sandbox.js";
import type { SandboxInfo, SystemStatus } from "../types.js";

const startTime = Date.now();

export async function statusRoutes(
  fastify: FastifyInstance,
  monitor: SystemMonitor,
  queue: DispatchQueue,
  sandbox: SandboxManager,
  lifecycle: LifecycleMonitor,
  network: NetworkMonitor,
) {
  fastify.get("/api/status", async (): Promise<SystemStatus> => {
    const stats = monitor.getResources();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const sandboxes = await sandbox.listSandboxes();

    // We assume server is running since this route is handling requests
    const address = fastify.server.address();
    const port =
      address && typeof address === "object" ? address.port : undefined;

    return {
      server: {
        status: "running",
        lifecycle: lifecycle.getStatus(),
        pid: process.pid,
        uptime,
        port,
      },
      system: {
        cpuPercent: stats.cpuPercent,
        memPercent: stats.memPercent,
        diskFreeGb: stats.diskFreeGb,
      },
      network: {
        status: network.getStatus(),
      },
      dispatch: {
        queueDepth: queue.getQueueDepth(),
        activeCount: queue.getActiveCount(),
        completedCount: queue.getCompletedCount(),
        failedCount: queue.getFailedCount(),
        paused: queue.getQueue().paused,
      },
      sandboxes: sandboxes as SandboxInfo[],
    };
  });
}
