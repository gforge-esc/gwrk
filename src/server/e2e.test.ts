/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type ServerFixture,
  createServerFixture,
} from "../../tests/helpers/server-fixture.js";

vi.mock("./slack.js", () => ({
  isSlackConnected: vi.fn().mockResolvedValue(false),
}));
vi.mock("../db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/index.js")>()),
  getDb: () => {
    throw new Error("Unexpected access to the default SQLite connection");
  },
}));

describe("Build Server E2E", () => {
  let server: FastifyInstance;
  let fixture: ServerFixture;

  beforeAll(async () => {
    fixture = await createServerFixture("routes", {
      routes: ["dispatch", "status", "health"],
      pauseDispatch: true,
    });
    server = fixture.app;
  });

  afterAll(async () => {
    await fixture?.close();
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
      expect(statusResponse.statusCode).toBe(200);
      expect(body.dispatch.queueDepth).toBe(2);
      expect(
        fixture.journal().map(({ phaseId, status }) => [phaseId, status]),
      ).toEqual([
        ["phase-01", "queued"],
        ["phase-02", "queued"],
      ]);
      expect(fixture.db.prepare("SELECT id FROM runs").all()).toEqual([]);
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
