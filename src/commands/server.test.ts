/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import { createSqliteProjectRegistryAdapter } from "../adapters/sqlite/index.js";
import { runCli } from "../cli.js";
import { computeProjectId } from "../domain/project-id.js";
import * as server from "../server/index.js";
import * as pidUtils from "../server/pid.js";
import * as configUtils from "../utils/config.js";
import * as deviceUtils from "../utils/device.js";
import { serverCommand } from "./server.js";

vi.mock("../server/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/index.js")>();
  return {
    ...actual,
    startServer: vi.fn(),
  };
});

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

    vi.spyOn(pidUtils, "readPid").mockReturnValue(undefined);
    vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(false);

    // `server start` refuses outright on a remote-role device, and `isRemote`
    // reads ~/.gwrk/device.json. Unmocked, every assertion below depends on
    // whose machine runs the suite: green in CI, red on any device registered
    // with `gwrk init` as remote. Pin the role so the suite tests the command.
    vi.spyOn(deviceUtils, "isRemote").mockReturnValue(false);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("start", () => {
    it("should start the server in foreground if -f is provided", async () => {
      await serverCommand.parseAsync(["start", "-f"], { from: "user" });
      expect(vi.mocked(server.startServer)).toHaveBeenCalled();
    });

    it("should fail if server is already running", async () => {
      vi.spyOn(pidUtils, "readPid").mockReturnValue(12345);
      vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(true);
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      process.exitCode = 0;
      await serverCommand.parseAsync(["start"], { from: "user" });
      expect(process.exitCode).toBe(1);
      
      const stderr = stderrSpy.mock.calls.map(c => String(c[0])).join("");
      expect(stderr).toContain("Server already running");
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

    it("refuses to start on a remote-role device", async () => {
      // Coverage the pinned role would otherwise drop. Asserted explicitly so
      // it holds on a server-role box and in CI, not only where the ambient
      // device happens to be remote.
      vi.spyOn(deviceUtils, "isRemote").mockReturnValue(true);
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      process.exitCode = 0;
      await serverCommand.parseAsync(["start", "-f"], { from: "user" });

      expect(process.exitCode).toBe(1);
      expect(vi.mocked(server.startServer)).not.toHaveBeenCalled();
      const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(stderr).toContain("registered as a remote device");
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
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      process.exitCode = 0;
      await serverCommand.parseAsync(["stop"], { from: "user" });
      
      expect(process.exitCode).toBe(1);
      const stderr = stderrSpy.mock.calls.map(c => String(c[0])).join("");
      expect(stderr).toContain("No server running");
    });
  });

  describe("UAT regression (T045): root CLI registry-backed server commands without .gwrkrc.json", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it.each([
      { command: ["start", "-f"] },
      { command: ["_run"] },
    ])("allows gwrk server $command and status via root CLI when projects are enrolled and .gwrkrc.json is absent", async ({ command }) => {
      const gwrkHome = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-srv-home-"));
      try {
        vi.stubEnv("GWRK_HOME", gwrkHome);
        vi.stubEnv("GWRK_DIR", "");
        vi.stubEnv("GWRK_DB_PATH", "");
        vi.stubEnv("GWRK_RUNTIME_DIR", "");
        vi.mocked(configUtils.loadConfig).mockRestore();
        vi.mocked(server.startServer).mockClear();

        const alphaCheckout = fs.realpathSync(
          fs.mkdtempSync(path.join(gwrkHome, "alpha-checkout-")),
        );
        const gitEnv = {
          ...repositoryGitEnv(alphaCheckout),
          GIT_CONFIG_GLOBAL: os.devNull,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
        };
        execFileSync(
          "git",
          ["init", "--template=", "--initial-branch=main"],
          { cwd: alphaCheckout, env: gitEnv, stdio: "ignore" },
        );
        execFileSync(
          "git",
          ["remote", "add", "origin", "git@github.com:org/alpha.git"],
          { cwd: alphaCheckout, env: gitEnv, stdio: "ignore" },
        );
        const projectId = computeProjectId({
          projectRoot: alphaCheckout,
          remoteOriginUrl: "git@github.com:org/alpha.git",
          gitCommonDir: path.join(alphaCheckout, ".git"),
        });
        const registry = createSqliteProjectRegistryAdapter();
        try {
          registry.enrollProject({
            projectId,
            slug: "alpha",
            name: "Alpha Enrolled",
            repoSlug: "org/alpha",
            trunkBranch: "main",
            localRoot: alphaCheckout,
            mirrorPath: null,
            runnerPolicy: { allowedKinds: ["local"] },
            slack: null,
            legacyProjectIds: [],
            createdAt: "2026-11-23T00:00:00.000Z",
            updatedAt: "2026-11-23T00:00:00.000Z",
          });
        } finally {
          registry.close();
        }

        let startStderr = "";
        const startExit = await runCli(["server", ...command], {
          stderr: (chunk) => {
            startStderr += chunk;
          },
        });
        expect(startExit, startStderr).toBe(0);
        expect(vi.mocked(server.startServer)).toHaveBeenCalledWith(
          expect.objectContaining({
            project: expect.objectContaining({ name: "Alpha Enrolled" }),
          }),
          expect.objectContaining({
            handleSignals: true,
            projectRoot: tempDir,
            useProjectRegistry: true,
          }),
        );

        let statusStdout = "";
        let statusStderr = "";
        const statusExit = await runCli(["server", "status"], {
          stdout: (chunk) => {
            statusStdout += chunk;
          },
          stderr: (chunk) => {
            statusStderr += chunk;
          },
        });
        expect(statusExit).toBe(1);
        expect(statusStdout).toContain("Server: not running");
        expect(statusStderr).toMatch(/\[exit:1 \| /);
      } finally {
        fs.rmSync(gwrkHome, { recursive: true, force: true });
      }
    });
  });
});
