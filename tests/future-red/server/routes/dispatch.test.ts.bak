import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startServer } from "../index.js";
import type { GwrkConfig } from "../../utils/config.js";

const TEST_CONFIG = {
  project: { name: "test-project" },
  agents: {
    define: "gemini",
    implement: "claude",
    fallbackOrder: ["gemini", "claude", "codex"],
  },
  server: { port: 18797, host: "127.0.0.1" },
  parallelism: {
    local: { maxClones: 2, maxCpu: 80, maxMem: 70, minDiskGb: 5 },
    cloud: { maxConcurrent: 5 },
  },
} as unknown as GwrkConfig;

// FR-005: POST /api/dispatch route
describe("FR-005: Dispatch API Routes", () => {
  let server: Awaited<ReturnType<typeof startServer>>;

  beforeEach(async () => {
    server = await startServer(TEST_CONFIG);
  });

  afterEach(async () => {
    await server.close();
  });

  // US-004 #1: POST /api/dispatch accepts dispatch request
  describe("POST /api/dispatch", () => {
    it("US-004 #1: returns 200 with dispatch record", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: {
          featureId: "001-cli-core",
          phaseId: "phase-01",
          backend: "gemini",
        },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBeDefined();
      expect(body.status).toMatch(/queued|running/);
    });

    // Error: invalid backend
    it("ERROR #1: returns 400 for unknown backend", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: {
          featureId: "001-cli-core",
          phaseId: "phase-01",
          backend: "nonexistent",
        },
      });
      expect(response.statusCode).toBe(400);
    });

    // Error: missing featureId
    it("ERROR #2: returns 400 for missing featureId", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: {
          phaseId: "phase-01",
          backend: "gemini",
        },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  // GET /api/dispatch/:feature/:phase
  describe("GET /api/dispatch/:feature/:phase", () => {
    it("US-004 #2: returns dispatch record by feature and phase", async () => {
      // First create a dispatch
      await server.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: {
          featureId: "001-cli-core",
          phaseId: "phase-01",
          backend: "gemini",
        },
      });

      const response = await server.inject({
        method: "GET",
        url: "/api/dispatch/001-cli-core/phase-01",
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.featureId).toBe("001-cli-core");
      expect(body.phaseId).toBe("phase-01");
    });

    it("US-004 #3: returns 404 for non-existent dispatch", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/dispatch/nonexistent/phase-01",
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // GET /api/dispatch/queue
  describe("GET /api/dispatch/queue", () => {
    it("US-005 #1: returns queue state with active, queued, throttled", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/dispatch/queue",
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.active)).toBe(true);
      expect(Array.isArray(body.queued)).toBe(true);
      expect(typeof body.throttled).toBe("boolean");
    });
  });
});
