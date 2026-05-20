import type { FastifyInstance } from "fastify";
import type { HealthResponse } from "../types.js";

export async function healthRoutes(server: FastifyInstance) {
  server.get("/health", async (): Promise<HealthResponse> => {
    // Phase 1: Minimal health check.
    // Future phases will inject real monitors for slack, network, etc.
    return {
      status: "ok",
      components: {
        server: { status: "ok" },
        git: { status: "ok" }, // Placeholder for Phase 1
        network: { status: "ok" }, // Placeholder for Phase 1
        slack: { status: "unavailable", message: "Not implemented in Phase 1" },
      },
    };
  });
}
