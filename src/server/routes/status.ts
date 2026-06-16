/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { FastifyInstance } from "fastify";
import type { DispatchQueue } from "../dispatch.js";
import type { LifecycleMonitor } from "../lifecycle.js";
import type { SystemMonitor } from "../monitor.js";
import type { NetworkMonitor } from "../network.js";
import type { SandboxManager } from "../sandbox.js";
import type { SandboxInfo, SystemStatus } from "../types.js";

const startTime = Date.now();

export async function getStatusData(
  monitor: SystemMonitor,
  queue: DispatchQueue,
  sandbox: SandboxManager,
  lifecycle: LifecycleMonitor,
  network: NetworkMonitor,
  fastify?: FastifyInstance,
): Promise<SystemStatus> {
  const stats = monitor.getResources();
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const sandboxes = await sandbox.listSandboxes();

  let port: number | undefined;
  if (fastify) {
    const address = fastify.server.address();
    port = address && typeof address === "object" ? address.port : undefined;
  }

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
}

export async function statusRoutes(
  fastify: FastifyInstance,
  monitor: SystemMonitor,
  queue: DispatchQueue,
  sandbox: SandboxManager,
  lifecycle: LifecycleMonitor,
  network: NetworkMonitor,
) {
  fastify.get("/api/status", async (): Promise<SystemStatus> => {
    return getStatusData(monitor, queue, sandbox, lifecycle, network, fastify);
  });
}
