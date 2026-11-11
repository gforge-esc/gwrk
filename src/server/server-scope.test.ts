/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { expect, it, vi } from "vitest";
import { GwrkConfigSchema } from "../utils/config.js";
import { HarvestWatcher } from "./harvest-watcher.js";
import { PlanHeartbeat } from "./heartbeat.js";
import { startServer } from "./index.js";
import { LifecycleMonitor } from "./lifecycle.js";
import { SystemMonitor } from "./monitor.js";
import { NetworkMonitor } from "./network.js";
import { removePid, writePid } from "./pid.js";
import { SandboxManager } from "./sandbox.js";
import { startSlackApp } from "./slack.js";

vi.mock("./pid.js", () => ({ removePid: vi.fn(), writePid: vi.fn() }));
vi.mock("./slack.js", () => ({
  getSlackApp: vi.fn().mockReturnValue(null),
  startSlackApp: vi.fn().mockResolvedValue(undefined),
  stopSlackApp: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./telegram.js", () => ({
  startTelegramBot: vi.fn().mockResolvedValue(undefined),
  stopTelegramBot: vi.fn().mockResolvedValue(undefined),
}));

function portOf(server: FastifyInstance): number {
  const address = server.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP listener for the fixture");
  }
  return address.port;
}

it("owns PID callbacks and startup effects per project root", async () => {
  const roots = await Promise.all(
    ["first", "second"].map((name) => mkdtemp(join(tmpdir(), `gwrk-${name}-`))),
  );
  vi.spyOn(SystemMonitor.prototype, "startPolling").mockImplementation(
    () => {},
  );
  vi.spyOn(NetworkMonitor.prototype, "start").mockImplementation(() => {});
  vi.spyOn(LifecycleMonitor.prototype, "start").mockImplementation(() => {});
  vi.spyOn(PlanHeartbeat.prototype, "start").mockImplementation(() => {});
  vi.spyOn(HarvestWatcher.prototype, "start").mockImplementation(() => {});
  const stopHarvest = vi
    .spyOn(HarvestWatcher.prototype, "stop")
    .mockImplementation(() => {});
  vi.spyOn(SandboxManager.prototype, "pruneSandboxes").mockResolvedValue(0);
  const config = GwrkConfigSchema.parse({
    project: { name: "scope fixture" },
    server: { host: "127.0.0.1", port: 0 },
  });
  const options = roots.map((projectRoot) => ({
    handleSignals: false,
    projectRoot,
    pid: { writePid: vi.fn(), removePid: vi.fn() },
  }));
  const servers: FastifyInstance[] = [];
  try {
    try {
      for (const scope of options) {
        servers.push(await startServer(config, scope));
      }
      expect(portOf(servers[0])).not.toBe(portOf(servers[1]));
      expect(
        vi.mocked(startSlackApp).mock.calls.map(([scope]) => scope.projectRoot),
      ).toEqual(roots);
      for (const { pid } of options) {
        expect(pid.writePid).toHaveBeenCalledExactlyOnceWith(process.pid);
      }
      expect(writePid).not.toHaveBeenCalled();
    } finally {
      await Promise.all(servers.map((server) => server.close()));
    }
    for (const { pid } of options) {
      expect(pid.removePid).toHaveBeenCalledTimes(1);
    }
    expect(stopHarvest).toHaveBeenCalledTimes(2);
    expect(removePid).not.toHaveBeenCalled();
  } finally {
    await Promise.all(
      roots.map((root) => rm(root, { recursive: true, force: true })),
    );
    vi.restoreAllMocks();
  }
});
