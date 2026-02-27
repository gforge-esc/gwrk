import { describe, it, expect, vi, beforeEach } from "vitest";
import { startServer } from "../index.js";
import type { GwrkConfig } from "../../utils/config.js";

const TEST_CONFIG = {
  project: { name: "test-project" },
  agents: { define: "gemini", implement: "claude" },
  server: { port: 18798, host: "127.0.0.1" },
  parallelism: {
    local: { maxClones: 2, maxCpu: 80, maxMem: 70, minDiskGb: 5 },
    cloud: { maxConcurrent: 5 },
  },
} as GwrkConfig;

// FR-004: GET /api/status route
describe("FR-004: /api/status Route", () => {
  let server: Awaited<ReturnType<typeof startServer>>;

  beforeEach(async () => {
    server = await startServer(TEST_CONFIG);
  });

  afterEach(async () => {
    await server.close();
  });

  // US-003 #1: /api/status returns full SystemStatus shape
  it("US-003 #1: GET /api/status returns 200 with server status", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/status",
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.server.status).toBe("running");
  });

  // US-003 #2: SystemStatus includes system resource metrics
  it("US-003 #2: response includes system.cpuPercent, memPercent, diskFreeGb", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/status",
    });
    const body = JSON.parse(response.body);
    expect(typeof body.system.cpuPercent).toBe("number");
    expect(typeof body.system.memPercent).toBe("number");
    expect(typeof body.system.diskFreeGb).toBe("number");
  });

  // US-003 #3: SystemStatus includes dispatch queue info
  it("US-003 #3: response includes dispatch.queueDepth and activeCount", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/status",
    });
    const body = JSON.parse(response.body);
    expect(typeof body.dispatch.queueDepth).toBe("number");
    expect(typeof body.dispatch.activeCount).toBe("number");
  });

  // US-003 #4: SystemStatus includes sandboxes array
  it("US-003 #4: response includes sandboxes array", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/status",
    });
    const body = JSON.parse(response.body);
    expect(Array.isArray(body.sandboxes)).toBe(true);
  });
});
