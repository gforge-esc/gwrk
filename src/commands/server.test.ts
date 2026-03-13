import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as server from "../server/index.js";
import * as pidUtils from "../server/pid.js";
import * as configUtils from "../utils/config.js";
import { serverCommand } from "./server.js";

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

describe("serverCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-server-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    vi.spyOn(configUtils, "loadConfig").mockReturnValue({
      project: { name: "test" },
      agents: { define: "gemini", implement: "codex-cloud" },
      server: { port: 0, host: "localhost" },
      parallelism: {
        local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
        cloud: { maxConcurrent: 10 },
      },
    });

    vi.spyOn(server, "startServer").mockResolvedValue(
      {} as unknown as Awaited<ReturnType<typeof server.startServer>>,
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("start", () => {
    it("should start the server in foreground if -f is provided", async () => {
      await serverCommand.parseAsync(["start", "-f"], { from: "user" });
      expect(server.startServer).toHaveBeenCalled();
    });

    it("should fail if server is already running", async () => {
      vi.spyOn(pidUtils, "readPid").mockReturnValue(12345);
      vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(true);

      await expect(
        serverCommand.parseAsync(["start"], { from: "user" }),
      ).rejects.toThrow("process.exit(1)");
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Server already running"),
      );
    });

    it("should daemonize if -f is NOT provided", async () => {
      vi.spyOn(pidUtils, "readPid")
        .mockReturnValueOnce(undefined)
        .mockReturnValue(12345);
      vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(true);
      const spawnSpy = vi.mocked(spawn).mockReturnValue({
        unref: vi.fn(),
      } as unknown as import("node:child_process").ChildProcess);

      await serverCommand.parseAsync(["start"], { from: "user" });

      expect(spawnSpy).toHaveBeenCalledWith(
        process.execPath,
        expect.arrayContaining(["server", "_run"]),
        expect.objectContaining({ detached: true }),
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("gwrk server started"),
      );
    });
  });

  describe("stop", () => {
    it("should stop a running server", async () => {
      vi.spyOn(pidUtils, "readPid").mockReturnValue(12345);
      vi.spyOn(pidUtils, "isPidRunning")
        .mockReturnValueOnce(true)
        .mockReturnValue(false);
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

      await serverCommand.parseAsync(["stop"], { from: "user" });

      expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Server stopped"),
      );
    });

    it("should fail if no server is running", async () => {
      vi.spyOn(pidUtils, "readPid").mockReturnValue(undefined);

      await expect(
        serverCommand.parseAsync(["stop"], { from: "user" }),
      ).rejects.toThrow("process.exit(1)");
      expect(console.error).toHaveBeenCalledWith("No server running");
    });
  });
});
