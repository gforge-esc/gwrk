import type { FastifyInstance } from "fastify";
import type { SystemMonitor } from "../monitor.js";
import type { DispatchQueue } from "../dispatch.js";
import type { SandboxManager } from "../sandbox.js";
import type { SystemStatus, SandboxInfo } from "../types.js";

const startTime = Date.now();

export async function statusRoutes(
  fastify: FastifyInstance,
  monitor: SystemMonitor,
  queue: DispatchQueue,
  sandbox: SandboxManager,
) {
  fastify.get("/api/status", async (): Promise<SystemStatus> => {
    const stats = monitor.getResources();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const sandboxes = await sandbox.listSandboxes();
    
    // We assume server is running since this route is handling requests
    const port = (fastify.server.address() as any)?.port;

    return {
      server: {
        status: "running",
        pid: process.pid,
        uptime,
        port,
      },
      system: {
        cpuPercent: stats.cpuPercent,
        memPercent: stats.memPercent,
        diskFreeGb: stats.diskFreeGb,
      },
      dispatch: {
        queueDepth: queue.getQueueDepth(),
        activeCount: queue.getActiveCount(),
        completedCount: queue.getCompletedCount(),
        failedCount: queue.getFailedCount(),
      },
      sandboxes: sandboxes as SandboxInfo[],
    };
  });
}
