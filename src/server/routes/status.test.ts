import { describe, expect, it, vi } from "vitest";
import type { GwrkConfig } from "../../utils/config.js";
import { startServer } from "../index.js";
import { removePid } from "../pid.js";

// Mock dependencies
vi.mock("../docker.js", () => ({
  ensureDocker: vi.fn().mockResolvedValue({ installed: true, running: true }),
}));
vi.mock("../slack.js", () => ({
  startSlackApp: vi.fn().mockResolvedValue(undefined),
  stopSlackApp: vi.fn().mockResolvedValue(undefined),
}));

const mockConfig: GwrkConfig = {
  project: { name: "test" },
  agents: { define: "gemini", implement: "gemini" },
  server: {
    port: 18892,
    host: "localhost",
    heartbeatIntervalMs: 1000,
    networkCheckIntervalMs: 1000,
  },
  parallelism: {
    local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
    cloud: { maxConcurrent: 10 },
  },
};

describe("status routes", () => {
  it("should respond to /api/status with SystemStatus JSON", async () => {
    removePid();
    const server = await startServer(mockConfig, { handleSignals: false });

    const response = await server.inject({
      method: "GET",
      url: "/api/status",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.server.status).toBe("running");
    expect(body.server.lifecycle).toBe("ready");
    expect(body.server.pid).toBe(process.pid);
    expect(body.server.port).toBe(18892);
    expect(body.system.cpuPercent).toBeDefined();
    expect(body.system.memPercent).toBeDefined();
    expect(body.system.diskFreeGb).toBeDefined();
    expect(body.network.status).toBeDefined();
    expect(body.dispatch.queueDepth).toBe(0);
    expect(body.dispatch.activeCount).toBe(0);
    expect(body.dispatch.paused).toBe(false);
    expect(body.sandboxes).toBeInstanceOf(Array);

    await server.close();
    removePid();
  });
});
