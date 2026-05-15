import fastify, { type FastifyInstance } from "fastify";
import { type Mocked, beforeEach, describe, expect, it, vi } from "vitest";
import type { LifecycleMonitor } from "../lifecycle.js";
import type { NetworkMonitor } from "../network.js";
import { healthRoutes } from "./health.js";

vi.mock("../slack.js", () => ({
  isSlackConnected: vi.fn().mockResolvedValue(true),
}));

describe("healthRoutes (FR-002)", () => {
  let server: FastifyInstance;
  let lifecycle: Mocked<LifecycleMonitor>;
  let network: Mocked<NetworkMonitor>;

  beforeEach(async () => {
    server = fastify();
    lifecycle = {
      getStatus: vi.fn().mockReturnValue("ready"),
    } as unknown as Mocked<LifecycleMonitor>;
    network = {
      isOnline: vi.fn().mockReturnValue(true),
    } as unknown as Mocked<NetworkMonitor>;
    
    // RED: sandbox argument is removed in Phase 1
    // @ts-ignore - purposefully passing wrong args to check RED state
    await healthRoutes(server, lifecycle, network);
  });

  it("should return 200 and ok status when all components are ok (RED - No sandbox check)", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.status).toBe("ok");
    expect(payload.components.server.status).toBe("ok");
    expect(payload.components.network.status).toBe("ok");
    
    // RED: Git component check should be direct or via orchestrator, not sandbox
    expect(payload.components.git).toBeDefined();
    
    // Ensure sandbox is NOT present in components
    expect(payload.components.sandbox).toBeUndefined();
  });
});
