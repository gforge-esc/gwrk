import fastify, { type FastifyInstance } from "fastify";
import { type Mocked, beforeEach, describe, expect, it, vi } from "vitest";
import type { LifecycleMonitor } from "../lifecycle.js";
import type { NetworkMonitor } from "../network.js";
import type { SandboxManager } from "../sandbox.js";
import { healthRoutes } from "./health.js";

vi.mock("../slack.js", () => ({
  isSlackConnected: vi.fn().mockResolvedValue(true),
}));

describe("healthRoutes", () => {
  let server: FastifyInstance;
  let lifecycle: Mocked<LifecycleMonitor>;
  let network: Mocked<NetworkMonitor>;
  let sandbox: Mocked<SandboxManager>;

  beforeEach(async () => {
    server = fastify();
    lifecycle = {
      getStatus: vi.fn().mockReturnValue("ready"),
    } as unknown as Mocked<LifecycleMonitor>;
    network = {
      isOnline: vi.fn().mockReturnValue(true),
    } as unknown as Mocked<NetworkMonitor>;
    sandbox = {
      checkDocker: vi.fn().mockResolvedValue(true),
    } as unknown as Mocked<SandboxManager>;
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
