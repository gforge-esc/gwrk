import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GwrkConfig } from "../../utils/config.js";
import { startServer } from "../index.js";
import { removePid } from "../pid.js";

const mockConfig: GwrkConfig = {
  project: { name: "test" },
  agents: { define: "gemini", implement: "codex-cloud" },
  server: { port: 18892, host: "localhost" },
  parallelism: {
    local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
    cloud: { maxConcurrent: 10 },
  },
};

describe("status routes", () => {
  beforeEach(() => {
    removePid();
  });

  afterEach(() => {
    removePid();
  });

  it("should return system status on /api/status", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });
    const response = await server.inject({
      method: "GET",
      url: "/api/status",
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.server.status).toBe("running");
    expect(json.system.cpuPercent).toBeDefined();
    expect(json.system.memPercent).toBeDefined();
    expect(json.system.diskFreeGb).toBeDefined();

    await server.close();
  });
});
