import type { FastifyInstance } from "fastify";
import type { DispatchQueue } from "../dispatch.js";
import type { SystemMonitor } from "../monitor.js";

export async function statusRoutes(
  fastify: FastifyInstance,
  monitor: SystemMonitor,
  queue: DispatchQueue,
) {
  fastify.get("/api/status", async () => {
    const stats = monitor.sample();
    return {
      server: {
        status: "running",
        pid: process.pid,
      },
      system: {
        cpuPercent: stats.cpuPercent,
        memPercent: stats.memPercent,
        diskFreeGb: stats.diskFreeGb,
      },
      dispatch: {
        queueDepth: queue.getQueueDepth(),
      },
      sandboxes: queue.getActiveCount(),
    };
  });
}
