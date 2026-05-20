import fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { healthRoutes } from "./health.js";

describe("healthRoutes (FR-002)", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = fastify();
    await healthRoutes(server);
  });

  it("should return 200 and ok status in Phase 1", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.status).toBe("ok");
    expect(payload.components.server.status).toBe("ok");
    expect(payload.components.git.status).toBe("ok");
    expect(payload.components.network.status).toBe("ok");
    expect(payload.components.slack.status).toBe("unavailable");
  });
});
