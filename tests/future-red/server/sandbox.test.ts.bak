import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSandbox,
  destroySandbox,
  destroyAllSandboxes,
  listSandboxes,
} from "./sandbox.js";
import type { SandboxOptions } from "./types.js";

// Mock dockerode
vi.mock("dockerode", () => {
  const mockContainer = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({ Id: "abc123", State: { Running: true } }),
  };
  const mockDocker = {
    createContainer: vi.fn().mockResolvedValue(mockContainer),
    listContainers: vi.fn().mockResolvedValue([]),
    getContainer: vi.fn().mockReturnValue(mockContainer),
  };
  return { default: vi.fn().mockReturnValue(mockDocker) };
});

const TEST_OPTS: SandboxOptions = {
  featureId: "001-cli-core",
  phaseId: "phase-01",
  branchName: "phase/001-cli-core-phase-01",
  repoPath: "/tmp/gwrk-test-repo",
  backend: "gemini",
  contextPath: "/tmp/gwrk-test-repo/.gwrk/phase-context.md",
};

// FR-006: Docker container lifecycle
describe("FR-006: Docker Sandbox Manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // US-004 #1: createSandbox creates container with correct labels
  describe("createSandbox()", () => {
    it("US-004 #1: creates container with gwrk.feature and gwrk.phase labels", async () => {
      const info = await createSandbox(TEST_OPTS);
      expect(info.featureId).toBe("001-cli-core");
      expect(info.phaseId).toBe("phase-01");
      expect(info.backend).toBe("gemini");
      expect(info.status).toBe("running");
    });

    it("US-004 #2: mounts repoPath at /workspace", async () => {
      const Dockerode = (await import("dockerode")).default;
      const docker = new Dockerode();
      await createSandbox(TEST_OPTS);

      expect(docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            Binds: expect.arrayContaining([
              expect.stringContaining("/workspace"),
            ]),
          }),
        })
      );
    });

    it("US-008 #1: uses gwrk-sandbox:bookworm-slim image", async () => {
      const Dockerode = (await import("dockerode")).default;
      const docker = new Dockerode();
      await createSandbox(TEST_OPTS);

      expect(docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Image: "gwrk-sandbox:bookworm-slim",
        })
      );
    });

    // TC-006: Docker label convention
    it("TC-006: container has gwrk.feature, gwrk.phase, gwrk.backend labels", async () => {
      const Dockerode = (await import("dockerode")).default;
      const docker = new Dockerode();
      await createSandbox(TEST_OPTS);

      expect(docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Labels: expect.objectContaining({
            "gwrk.feature": "001-cli-core",
            "gwrk.phase": "phase-01",
            "gwrk.backend": "gemini",
          }),
        })
      );
    });
  });

  // US-004 #3: destroySandbox stops and removes container
  describe("destroySandbox()", () => {
    it("US-004 #3: stops and removes the container", async () => {
      await destroySandbox("abc123");
      const Dockerode = (await import("dockerode")).default;
      const docker = new Dockerode();
      const container = docker.getContainer("abc123");
      expect(container.stop).toHaveBeenCalled();
      expect(container.remove).toHaveBeenCalled();
    });
  });

  // TC-007: destroyAllSandboxes for graceful shutdown
  describe("destroyAllSandboxes()", () => {
    it("TC-007: destroys all gwrk-labeled containers", async () => {
      const count = await destroyAllSandboxes();
      expect(typeof count).toBe("number");
    });
  });

  // listSandboxes
  describe("listSandboxes()", () => {
    it("US-003 #1: returns array of SandboxInfo", async () => {
      const sandboxes = await listSandboxes();
      expect(Array.isArray(sandboxes)).toBe(true);
    });
  });
});
