import fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { healthRoutes } from "./health.js";

vi.mock("../slack.js", () => ({
  isSlackConnected: vi.fn().mockResolvedValue(true),
}));

describe("healthRoutes", () => {
  let server: any;
  let lifecycle: any;
  let network: any;
  let sandbox: any;

  beforeEach(async () => {
    server = fastify();
    lifecycle = {
      getStatus: vi.fn().mockReturnValue("ready"),
    };
    network = {
      isOnline: vi.fn().mockReturnValue(true),
    };
    sandbox = {
      checkDocker: vi.fn().mockResolvedValue(true),
    };
    await healthRoutes(server, lifecycle, network, sandbox);
  });

  it("should return 200 and ok status when all components are ok", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.status).toBe("ok");
    expect(payload.components.server.status).toBe("ok");
    expect(payload.components.docker.status).toBe("ok");
    expect(payload.components.network.status).toBe("ok");
  });

  it("should return degraded status when Docker is unavailable", async () => {
    sandbox.checkDocker.mockResolvedValue(false);

    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.status).toBe("degraded");
    expect(payload.components.docker.status).toBe("unavailable");
  });

  it("should return degraded status when network is offline", async () => {
    network.isOnline.mockReturnValue(false);

    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.status).toBe("degraded");
    expect(payload.components.network.status).toBe("unavailable");
  });
});
