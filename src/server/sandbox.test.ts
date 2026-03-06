import { describe, it, expect, vi, beforeEach } from "vitest";
import { SandboxManager } from "./sandbox.js";
import Docker from "dockerode";

vi.mock("dockerode");

describe("SandboxManager", () => {
  let sandboxManager: SandboxManager;
  let mockDocker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    sandboxManager = new SandboxManager();
    mockDocker = (Docker as any).mock.instances[0];
  });

  it("should check if docker is available", async () => {
    mockDocker.ping.mockResolvedValueOnce("OK");
    const result = await sandboxManager.checkDocker();
    expect(result).toBe(true);
    expect(mockDocker.ping).toHaveBeenCalled();
  });

  it("should return false if docker is not available", async () => {
    mockDocker.ping.mockRejectedValueOnce(new Error("Connection refused"));
    const result = await sandboxManager.checkDocker();
    expect(result).toBe(false);
  });

  it("should create and start a sandbox", async () => {
    const mockContainer = {
      id: "test-id",
      start: vi.fn().mockResolvedValueOnce({}),
    };
    mockDocker.createContainer.mockResolvedValueOnce(mockContainer);

    const containerId = await sandboxManager.createSandbox({
      featureId: "001-cli-core",
      phaseId: "phase-01",
      projectRoot: "/test/root",
    });

    expect(containerId).toBe("test-id");
    expect(mockDocker.createContainer).toHaveBeenCalledWith(expect.objectContaining({
      Image: "gwrk-sandbox:bookworm-slim",
      Labels: {
        "gwrk.feature": "001-cli-core",
        "gwrk.phase": "phase-01",
      },
      HostConfig: {
        Binds: ["/test/root:/workspace"],
      },
    }));
    expect(mockContainer.start).toHaveBeenCalled();
  });

  it("should destroy a sandbox", async () => {
    const mockContainer = {
      stop: vi.fn().mockResolvedValueOnce({}),
      remove: vi.fn().mockResolvedValueOnce({}),
    };
    mockDocker.getContainer.mockReturnValue(mockContainer);

    await sandboxManager.destroySandbox("test-id");

    expect(mockDocker.getContainer).toHaveBeenCalledWith("test-id");
    expect(mockContainer.stop).toHaveBeenCalled();
    expect(mockContainer.remove).toHaveBeenCalled();
  });
});
