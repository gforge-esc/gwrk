/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fastify from "fastify";
import { expect, it, vi } from "vitest";
import { GwrkConfigSchema } from "../../utils/config.js";
import { DispatchQueue } from "../dispatch.js";
import { LifecycleMonitor } from "../lifecycle.js";
import { SystemMonitor } from "../monitor.js";
import { NetworkMonitor } from "../network.js";
import { SandboxManager } from "../sandbox.js";
import { statusRoutes } from "./status.js";

it("serves status without starting the daemon", async () => {
  const config = GwrkConfigSchema.parse({
    project: { name: "status fixture" },
  });
  const resources = { cpuPercent: 12, memPercent: 18, diskFreeGb: 40 };
  const sample = vi
    .spyOn(SystemMonitor.prototype, "sample")
    .mockReturnValue(resources);
  const server = fastify();
  try {
    const monitor = new SystemMonitor(config);
    const sandbox = new SandboxManager();
    vi.spyOn(sandbox, "listSandboxes").mockResolvedValue([]);
    const queue = new DispatchQueue(config, monitor, sandbox, process.cwd());
    const lifecycle = new LifecycleMonitor(config);
    lifecycle.setStatus("ready");
    const network = new NetworkMonitor(config);
    await statusRoutes(server, monitor, queue, sandbox, lifecycle, network);

    const response = await server.inject({ method: "GET", url: "/api/status" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      server: { status: "running", lifecycle: "ready", pid: process.pid },
      system: resources,
      network: { status: "unknown" },
      dispatch: {
        queueDepth: 0,
        activeCount: 0,
        completedCount: 0,
        failedCount: 0,
        paused: false,
      },
      sandboxes: [],
    });
  } finally {
    await server.close();
    sample.mockRestore();
  }
});
