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
  getSlackApp: vi.fn().mockReturnValue(undefined),
}));

const mockConfig: GwrkConfig = {
  project: { name: "test" },
  agents: { define: "gemini", implement: "gemini" },
  server: {
    githubWebhookSecret: "mock_secret",
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

describe("status routes (FR-004, US-002)", () => {
  it("should respond to /api/status with SystemStatus JSON — RED (No sandboxes)", async () => {
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
    
    // FR-004: Should NOT contain sandboxes after Phase 1 pruning
    expect(body.sandboxes).toBeUndefined();

    // Verify system metrics
    expect(body.system.cpuPercent).toBeDefined();
    expect(body.system.memPercent).toBeDefined();
    expect(body.system.diskFreeGb).toBeDefined();
    
    // Verify network
    expect(body.network.status).toBeDefined();

    await server.close();
    removePid();
  });
});
