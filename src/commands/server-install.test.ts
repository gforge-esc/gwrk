import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as pidUtils from "../server/pid.js";
import * as configUtils from "../utils/config.js";
import { serverCommand } from "./server.js";

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: vi.fn(),
    execSync: vi.fn(),
  };
});

describe("server install/uninstall/logs", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-server-install-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      process.exitCode = code as number;
      return undefined as never;
    });

    vi.spyOn(configUtils, "loadConfig").mockReturnValue({
      project: { name: "test" },
      server: { port: 18790, host: "localhost" },
    } as any);

    // Mock platform to darwin for install tests
    Object.defineProperty(process, "platform", {
      value: "darwin",
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("install", () => {
    it("should write plist and load it", async () => {
      vi.spyOn(pidUtils, "resolvePid").mockReturnValue(undefined);
      const writeFileSyncSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
      const mkdirSyncSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => "");
      const execSyncSpy = vi.mocked(execSync).mockReturnValue(Buffer.from(""));

      await serverCommand.parseAsync(["install"], { from: "user" });

      expect(writeFileSyncSpy).toHaveBeenCalledWith(expect.stringContaining(".plist"), expect.stringContaining("com.gwrk.server"), "utf8");
      expect(execSyncSpy).toHaveBeenCalledWith(expect.stringContaining("launchctl load"));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("LaunchAgent loaded"));
    });

    it("should fail on non-darwin platforms", async () => {
      Object.defineProperty(process, "platform", {
        value: "linux",
      });
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      process.exitCode = 0;
      await serverCommand.parseAsync(["install"], { from: "user" });

      expect(process.exitCode).toBe(1);
      const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(stderr).toContain("only supported on macOS");
    });
  });

  describe("uninstall", () => {
    it("should unload and remove plist", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      const unlinkSyncSpy = vi.spyOn(fs, "unlinkSync").mockImplementation(() => {});
      const execSyncSpy = vi.mocked(execSync).mockReturnValue(Buffer.from(""));

      await serverCommand.parseAsync(["uninstall"], { from: "user" });

      expect(execSyncSpy).toHaveBeenCalledWith(expect.stringContaining("launchctl unload"), expect.anything());
      expect(unlinkSyncSpy).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("LaunchAgent unloaded and removed"));
    });
  });

  describe("logs", () => {
    it("should spawn tail if log file exists", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      const spawnSpy = vi.mocked(spawn).mockReturnValue({
        on: (event: string, cb: any) => {
          if (event === "exit") cb(0);
        },
      } as any);

      await serverCommand.parseAsync(["logs"], { from: "user" });

      expect(spawnSpy).toHaveBeenCalledWith("tail", expect.arrayContaining(["-n", "50"]), expect.anything());
    });
  });
});
