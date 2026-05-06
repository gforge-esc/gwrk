import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startServer, stopServer } from "./index.js";
import type { GwrkConfig } from "../utils/config.js";

// Mock config with required server fields — no defaults
const TEST_CONFIG: GwrkConfig = {
  project: { name: "test-project" },
  agents: { define: "gemini", implement: "claude" },
  server: { port: 18799, host: "127.0.0.1" },
  parallelism: {
    local: { maxClones: 2, maxCpu: 80, maxMem: 70, minDiskGb: 5 },
    cloud: { maxConcurrent: 5 },
  },
} as GwrkConfig;

// FR-001: gwrk server start — Fastify daemon bootstrap
describe("FR-001: Fastify Server Bootstrap", () => {
  let server: Awaited<ReturnType<typeof startServer>>;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
    }
  });

  // US-001 #1: Server starts and responds to /health
  it("US-001 #1: startServer binds to configured port and /health returns 200", async () => {
    server = await startServer(TEST_CONFIG);
    const response = await server.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
  });

  // US-001 #2: Server binds to localhost only (TC-004)
  it("TC-004: server binds to 127.0.0.1 only, not 0.0.0.0", async () => {
    server = await startServer(TEST_CONFIG);
    // Fastify addresses array should contain localhost only
    const addresses = server.addresses();
    for (const addr of addresses) {
      expect(addr.address).toBe("127.0.0.1");
    }
  });
});

// FR-002: REST API endpoints
describe("FR-002: REST API Endpoints", () => {
  let server: Awaited<ReturnType<typeof startServer>>;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
    }
  });

  // US-001 #3: /api/status endpoint exists
  it("US-003 #1: GET /api/status returns server status", async () => {
    server = await startServer(TEST_CONFIG);
    const response = await server.inject({ method: "GET", url: "/api/status" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.server).toBeDefined();
    expect(body.server.status).toBe("running");
  });
});

// FR-003: Graceful shutdown
describe("FR-003: Graceful Shutdown", () => {
  // US-002 #1: stopServer releases port
  it("US-002 #1: stopServer closes the server and releases port", async () => {
    const server = await startServer(TEST_CONFIG);
    await stopServer(server);
    // After stop, inject should throw or server should be closed
    expect(() => server.inject({ method: "GET", url: "/health" })).toThrow();
  });
});

// FR-001 Error States
describe("FR-001 Error States", () => {
  // Port already in use
  it("ERROR #1: throws when port is already in use", async () => {
    const server1 = await startServer(TEST_CONFIG);
    await expect(startServer(TEST_CONFIG)).rejects.toThrow(/Port.*already in use/);
    await stopServer(server1);
  });

  // Server already running (stale PID)
  it("ERROR #2: throws when server is already running", async () => {
    const server1 = await startServer(TEST_CONFIG);
    await expect(startServer(TEST_CONFIG)).rejects.toThrow(/already running/i);
    await stopServer(server1);
  });
});
