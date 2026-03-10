import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GwrkConfig } from "../utils/config.js";
import { startServer } from "./index.js";
import * as pidUtils from "./pid.js";

vi.mock("./pid.js", () => ({
  writePid: vi.fn(),
  readPid: vi.fn(),
  removePid: vi.fn(),
  isPidRunning: vi.fn(),
}));

const mockSandbox = {
  checkDocker: vi.fn().mockResolvedValue(true),
};

vi.mock("./sandbox.js", () => {
  return {
    SandboxManager: vi.fn().mockImplementation(() => mockSandbox),
  };
});

const mockConfig: GwrkConfig = {
  project: { name: "test" },
  agents: { define: "gemini", implement: "codex-cloud" },
  server: { port: 18895, host: "localhost" },
  parallelism: {
    local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
    cloud: { maxConcurrent: 10 },
  },
};

describe("server bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSandbox.checkDocker.mockResolvedValue(true);
  });

  it("should start the server and write PID", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });
    expect(server).toBeDefined();

    expect(pidUtils.writePid).toHaveBeenCalledWith(process.pid);

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

  it("should fail to start if Docker is not available", async () => {
    mockSandbox.checkDocker.mockResolvedValueOnce(false);

    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    await expect(
      startServer(mockConfig, { handleSignals: false }),
    ).rejects.toThrow("process.exit(1)");
  });
});
