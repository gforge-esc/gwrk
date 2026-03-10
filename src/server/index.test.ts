import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GwrkConfig } from "../utils/config.js";
import { startServer } from "./index.js";
import { readPid, removePid } from "./pid.js";

const mockConfig: GwrkConfig = {
  project: { name: "test" },
  agents: { define: "gemini", implement: "codex-cloud" },
  server: { port: 18891, host: "localhost" },
  parallelism: {
    local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
    cloud: { maxConcurrent: 10 },
  },
};

describe("server bootstrap", () => {
  beforeEach(() => {
    removePid();
  });

  afterEach(() => {
    removePid();
  });

  it("should start the server and write PID", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });
    expect(server).toBeDefined();

    const pid = readPid();
    expect(pid).toBe(process.pid);

    await server.close();
  });

  it("should respond to /health", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });

    await server.close();
  });
});
