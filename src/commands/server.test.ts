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
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
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
      process.exitCode = code as number;
      return undefined as never;
    });

    vi.spyOn(configUtils, "loadConfig").mockReturnValue({
      project: { name: "test" },
      agents: { define: "gemini", implement: "codex-cloud" },
      server: { port: 18790, host: "localhost" },
      parallelism: {
        local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
        cloud: { maxConcurrent: 10 },
      },
    } as any);

    vi.spyOn(pidUtils, "resolvePid").mockReturnValue(undefined);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("start", () => {
    it("should start the server in foreground if -f is provided", async () => {
      const spy = vi.spyOn(server, "startServer").mockResolvedValue({} as any);
      await serverCommand.parseAsync(["start", "-f"], { from: "user" });
      expect(spy).toHaveBeenCalled();
    });

    it("should fail if server is already running", async () => {
      vi.spyOn(pidUtils, "resolvePid").mockReturnValue(12345);
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      process.exitCode = 0;
      await serverCommand.parseAsync(["start"], { from: "user" });
      expect(process.exitCode).toBe(1);

      const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(stderr).toContain("Server already running");
    });

    it("should daemonize if -f is NOT provided", async () => {
      vi.spyOn(server, "startServer").mockResolvedValue({} as any);
      vi.spyOn(pidUtils, "resolvePid")
        .mockReturnValueOnce(undefined) // check before start
        .mockReturnValueOnce(undefined) // first attempt in loop
        .mockReturnValue(12345); // second attempt in loop

      const spawnSpy = vi.mocked(spawn).mockReturnValue({
        unref: vi.fn(),
      } as any);

      await serverCommand.parseAsync(["start"], { from: "user" });

      expect(spawnSpy).toHaveBeenCalledWith(
        process.execPath,
        expect.arrayContaining(["server", "_run"]),
        expect.objectContaining({ detached: true }),
      );
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("gwrk server started"));
    });
  });

  describe("stop", () => {
    it("should stop a running server", async () => {
      vi.spyOn(pidUtils, "resolvePid").mockReturnValue(12345);
      vi.spyOn(pidUtils, "isPidRunning").mockReturnValueOnce(true).mockReturnValue(false);
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

      await serverCommand.parseAsync(["stop"], { from: "user" });

      expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Server stopped"));
    });

    it("should fail if no server is running", async () => {
      vi.spyOn(pidUtils, "resolvePid").mockReturnValue(undefined);
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      process.exitCode = 0;
      await serverCommand.parseAsync(["stop"], { from: "user" });

      expect(process.exitCode).toBe(1);
      const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(stderr).toContain("No server running");
    });
  });

  describe("status", () => {
    it("should report server is not running", async () => {
      vi.spyOn(pidUtils, "resolvePid").mockReturnValue(undefined);
      await serverCommand.parseAsync(["status"], { from: "user" });
      expect(console.log).toHaveBeenCalledWith("Server: not running");
      expect(process.exitCode).toBe(1);
    });

    it("should report server is running and check health", async () => {
      vi.spyOn(pidUtils, "resolvePid").mockReturnValue(12345);
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        json: async () => ({
          status: "ok",
          components: { server: { status: "ok" } },
        }),
      } as any);

      await serverCommand.parseAsync(["status"], { from: "user" });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Server: running (pid: 12345)"));
      expect(fetchSpy).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith("Health: ok");
    });
  });
});
