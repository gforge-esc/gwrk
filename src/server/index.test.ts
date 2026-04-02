import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GwrkConfig } from "../utils/config.js";
import * as dockerUtils from "./docker.js";
import { startServer } from "./index.js";
import * as pidUtils from "./pid.js";

vi.mock("./docker.js", () => ({
  ensureDocker: vi.fn().mockResolvedValue({ installed: true, running: true }),
}));

vi.mock("./pid.js", () => ({
  writePid: vi.fn(),
  readPid: vi.fn(),
  removePid: vi.fn(),
  isPidRunning: vi.fn(),
}));

vi.mock("./slack.js", () => ({
  isSlackConnected: vi.fn().mockResolvedValue(true),
  getSlackApp: vi.fn().mockReturnValue({
    client: { auth: { test: vi.fn().mockResolvedValue({ ok: true }) } },
  }),
  startSlackApp: vi.fn().mockResolvedValue(undefined),
  stopSlackApp: vi.fn().mockResolvedValue(undefined),
}));

const mockSandbox = {
  checkDocker: vi.fn().mockResolvedValue(true),
  pauseAll: vi.fn().mockResolvedValue(undefined),
  unpauseAll: vi.fn().mockResolvedValue(undefined),
  listSandboxes: vi.fn().mockResolvedValue([]),
  pruneSandboxes: vi.fn().mockResolvedValue(undefined),
};

vi.mock("./sandbox.js", () => {
  return {
    SandboxManager: vi.fn().mockImplementation(() => mockSandbox),
  };
});

const mockConfig: GwrkConfig = {
  project: { name: "test" },
  agents: { define: "gemini", implement: "codex-cloud" },
  server: {
    githubWebhookSecret: "mock_secret",
    port: 0,
    host: "localhost",
    heartbeatIntervalMs: 1000,
    networkCheckIntervalMs: 1000,
  },
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
    const json = response.json();
    expect(json.status).toBe("ok");
    expect(json.components.server.status).toBe("ok");

    await server.close();
  });

  it("should fail to start if Docker is not available", async () => {
    vi.mocked(dockerUtils.ensureDocker).mockImplementationOnce(() => {
      throw new Error("process.exit(1)");
    });

    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    await expect(
      startServer(mockConfig, { handleSignals: false }),
    ).rejects.toThrow("process.exit(1)");
  });
});
