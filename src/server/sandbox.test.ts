import Docker from "dockerode";
import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import { SandboxManager } from "./sandbox.js";

vi.mock("dockerode", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      ping: vi.fn(),
      createContainer: vi.fn(),
      getContainer: vi.fn(),
      listContainers: vi.fn(),
    })),
  };
});

describe("SandboxManager", () => {
  let sandboxManager: SandboxManager;
  let mockDocker: {
    ping: Mock;
    createContainer: Mock;
    getContainer: Mock;
    listContainers: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sandboxManager = new SandboxManager();
    // @ts-ignore
    mockDocker = Docker.mock.results[0].value;
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
      backend: "gemini",
      projectRoot: "/test/root",
    });

    expect(containerId).toBe("test-id");
    expect(mockDocker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: "gwrk-sandbox:bookworm-slim",
        Labels: expect.objectContaining({
          "gwrk.feature": "001-cli-core",
          "gwrk.phase": "phase-01",
          "gwrk.backend": "gemini",
          "gwrk.startedAt": expect.any(String),
        }),
        HostConfig: {
          Binds: ["/test/root:/workspace"],
        },
      }),
    );
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

  it("should list sandboxes", async () => {
    const mockContainers = [
      {
        Id: "id-1",
        State: "running",
        Labels: {
          "gwrk.feature": "f1",
          "gwrk.phase": "p1",
          "gwrk.backend": "b1",
          "gwrk.startedAt": "2026-03-09T00:00:00Z",
        },
      },
    ];
    mockDocker.listContainers.mockResolvedValueOnce(mockContainers);

    const sandboxes = await sandboxManager.listSandboxes();

    expect(sandboxes).toHaveLength(1);
    expect(sandboxes[0]).toEqual({
      containerId: "id-1",
      featureId: "f1",
      phaseId: "p1",
      backend: "b1",
      status: "running",
      startedAt: "2026-03-09T00:00:00Z",
    });
    expect(mockDocker.listContainers).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: {
          label: ["gwrk.feature"],
        },
      }),
    );
  });
});
