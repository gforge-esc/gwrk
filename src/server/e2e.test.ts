/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
/**
 * E2E tests for the gwrk build server (002-build-server).
 *
 * These tests start a real Fastify server instance and test all
 * API endpoints end-to-end, including dispatch lifecycle and error handling.
 *
 * NOTE: These tests run the server in-process (not as a daemon) and
 * do NOT require Docker to be running for the core API tests.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DispatchQueue } from "../server/dispatch.js";
import { LifecycleMonitor } from "../server/lifecycle.js";
import { SystemMonitor } from "../server/monitor.js";
import { NetworkMonitor } from "../server/network.js";
import { dispatchRoutes } from "../server/routes/dispatch.js";
import { healthRoutes } from "../server/routes/health.js";
import { statusRoutes } from "../server/routes/status.js";
import { SandboxManager } from "../server/sandbox.js";
import { loadConfig } from "../utils/config.js";

describe("Build Server E2E", () => {
  let server: FastifyInstance;
  let queue: DispatchQueue;
  let monitor: SystemMonitor;
  let sandbox: SandboxManager;
  let lifecycle: LifecycleMonitor;
  let network: NetworkMonitor;
  const projectRoot = process.cwd();

  beforeAll(async () => {
    const config = loadConfig(projectRoot);

    server = Fastify({ logger: false });
    monitor = new SystemMonitor(config);
    sandbox = new SandboxManager();
    lifecycle = new LifecycleMonitor(config);
    network = new NetworkMonitor(config);

    queue = new DispatchQueue(config, monitor, sandbox, projectRoot);

    // Register all routes — match exact signatures from index.ts
    await dispatchRoutes(server, queue);
    await statusRoutes(server, monitor, queue, sandbox, lifecycle, network);
    await healthRoutes(server, lifecycle, network, sandbox);

    await server.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await server.close();
  });

  // ─── Health Endpoint ───────────────────────────────────────────

  describe("GET /health", () => {
    it("should return health status with components", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBeDefined();
      expect(body.components).toBeDefined();
      expect(body.components.server).toBeDefined();
      expect(body.components.server.status).toMatch(/^(ok|degraded)$/);
      expect(body.components.git).toBeDefined();
      expect(body.components.network).toBeDefined();
    });
  });

  // ─── Status Endpoint ──────────────────────────────────────────

  describe("GET /api/status", () => {
    it("should return system metrics and dispatch state", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/status",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // Server section
      expect(body.server).toBeDefined();
      expect(body.server.status).toBe("running");
      expect(typeof body.server.pid).toBe("number");

      // System section
      expect(body.system).toBeDefined();
      expect(typeof body.system.cpuPercent).toBe("number");
      expect(typeof body.system.memPercent).toBe("number");
      expect(typeof body.system.diskFreeGb).toBe("number");

      // Dispatch section
      expect(body.dispatch).toBeDefined();
      expect(typeof body.dispatch.queueDepth).toBe("number");
      expect(typeof body.dispatch.activeCount).toBe("number");
      expect(typeof body.dispatch.completedCount).toBe("number");
      expect(typeof body.dispatch.failedCount).toBe("number");
    });
  });

  // ─── Dispatch Lifecycle ────────────────────────────────────────

  describe("Dispatch lifecycle", () => {
    let dispatchId: string;

    it("POST /api/dispatch should enqueue a valid request", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { "content-type": "application/json" },
        payload: {
          featureId: "e2e-test",
          phaseId: "phase-01",
          backend: "gemini",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBeDefined();
      expect(body.featureId).toBe("e2e-test");
      expect(body.phaseId).toBe("phase-01");
      expect(body.backend).toBe("gemini");
      expect(body.status).toBe("queued");
      expect(body.branchName).toBe("feat/e2e-test-phase-01");
      expect(body.attempts).toEqual([]);
      expect(body.createdAt).toBeDefined();
      dispatchId = body.id;
    });

    it("GET /api/dispatch/queue should show the queued dispatch", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/dispatch/queue",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.queued).toBeDefined();
      expect(Array.isArray(body.queued)).toBe(true);
      expect(body.active).toBeDefined();
      expect(Array.isArray(body.active)).toBe(true);
      expect(typeof body.throttled).toBe("boolean");

      // Our dispatch should be in the queue
      const found = body.queued.find(
        (d: { featureId: string; phaseId: string }) =>
          d.featureId === "e2e-test" && d.phaseId === "phase-01",
      );
      expect(found).toBeDefined();
      expect(found.id).toBe(dispatchId);
    });

    it("GET /api/dispatch/:feature/:phase should find the dispatch", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/dispatch/e2e-test/phase-01",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(dispatchId);
      expect(body.featureId).toBe("e2e-test");
      expect(body.phaseId).toBe("phase-01");
    });

    it("POST /api/dispatch should enqueue a second request", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { "content-type": "application/json" },
        payload: {
          featureId: "e2e-test",
          phaseId: "phase-02",
          backend: "claude",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.phaseId).toBe("phase-02");
      expect(body.backend).toBe("claude");
      expect(body.status).toBe("queued");
    });

    it("queue depth should reflect both dispatches", async () => {
      const statusResponse = await server.inject({
        method: "GET",
        url: "/api/status",
      });

      const body = statusResponse.json();
      // Note: status 500 or other is possible if /api/status itself has issues
      // but the queue depth via dispatch route is the key test
      expect(body.dispatch.queueDepth).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Error Handling ────────────────────────────────────────────

  describe("Error handling", () => {
    it("POST /api/dispatch with missing phaseId should return error", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { "content-type": "application/json" },
        payload: { featureId: "test-only" },
      });

      const body = response.json();
      expect(body.error).toBeDefined();
      expect(body.error).toContain("Missing");
    });

    it("POST /api/dispatch with empty body should return error", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { "content-type": "application/json" },
        payload: {},
      });

      const body = response.json();
      expect(body.error).toBeDefined();
    });

    it("GET /api/dispatch for nonexistent feature should return error", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/dispatch/nonexistent/no-phase",
      });

      const body = response.json();
      expect(body.error).toBe("Not found");
    });

    it("GET unknown route should return 404", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/unknown",
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
