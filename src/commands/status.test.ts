/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithOutputScope } from "../adapters/cli/output-scope.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import { createSqliteProjectRegistryAdapter } from "../adapters/sqlite/index.js";
import { computeProjectId } from "../domain/project-id.js";
import type { EnrolledProject } from "../domain/project-registry.js";
import * as pidUtils from "../server/pid.js";
import type { HealthResponse, SystemStatus } from "../server/types.js";
import { createStatusCommand } from "./status.js";

function runGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...repositoryGitEnv(cwd),
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Gwrk Test",
      GIT_AUTHOR_EMAIL: "gwrk-test@example.invalid",
      GIT_COMMITTER_NAME: "Gwrk Test",
      GIT_COMMITTER_EMAIL: "gwrk-test@example.invalid",
      GIT_TERMINAL_PROMPT: "0",
    },
  }).trim();
}

function initGitRepo(dir: string, remoteUrl?: string): string {
  const realDir = fs.realpathSync(dir);
  runGit(realDir, "init", "--template=", "--initial-branch=main");
  runGit(realDir, "commit", "--no-gpg-sign", "--allow-empty", "-m", "init");
  if (remoteUrl) {
    runGit(realDir, "remote", "add", "origin", remoteUrl);
  }
  return realDir;
}

async function runStatus(
  args: string[],
  rootFormat?: "json",
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let stdout = "";
  let stderr = "";
  const scope = {
    agentMode: false,
    exitCode: 0,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: (chunk: string) => {
      stderr += chunk;
    },
  };
  await runWithOutputScope(scope, async () => {
    const program = new Command("gwrk").option("--format <type>");
    program.addCommand(createStatusCommand());
    const argv = rootFormat
      ? ["--format", rootFormat, "status", ...args]
      : ["status", ...args];
    await program.parseAsync(argv, { from: "user" });
  });
  return { stdout, stderr, exitCode: scope.exitCode };
}

describe("TR-022: gwrk status liveness, reachability, readiness and Slack delivery", () => {
  let tempDir: string;
  let gwrkHome: string;
  let oldCwd: string;

  beforeEach(() => {
    oldCwd = process.cwd();
    tempDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-status-test-")),
    );
    gwrkHome = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-status-home-")),
    );
    vi.stubEnv("GWRK_HOME", gwrkHome);
    vi.stubEnv("GWRK_DIR", "");
    vi.stubEnv("GWRK_DB_PATH", "");
    vi.stubEnv("GWRK_RUNTIME_DIR", "");
    vi.stubEnv("GWRK_SERVER_URL", "");
    initGitRepo(tempDir, "git@github.com:org/status-demo.git");
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(oldCwd);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(gwrkHome, { recursive: true, force: true });
  });

  it("exits non-zero with serverReachable: false when a configured server is unreachable under --json and --format json", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: "status-demo" },
        server: { host: "127.0.0.1", port: 19991 },
      }),
    );
    vi.spyOn(pidUtils, "readPid").mockReturnValue(undefined);
    vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:19991")),
    );

    for (const [args, rootFormat] of [
      [["--json"], undefined],
      [[], "json"],
    ] as const) {
      const result = await runStatus([...args], rootFormat);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/\[exit:1 \| /);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.daemonLiveness).toBe("stopped");
      expect(parsed.serverConfigured).toBe(true);
      expect(parsed.serverReachable).toBe(false);
      expect(parsed.serverError).toContain("ECONNREFUSED");
      expect(parsed.telegram).toEqual({
        enabled: false,
        reason: "disabled_in_pilot",
      });
    }
  });

  it("exits non-zero when a running local daemon fails health or status checks", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "status-demo" } }),
    );
    vi.spyOn(pidUtils, "readPid").mockReturnValue(process.pid);
    vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "unavailable" }),
      }),
    );

    const result = await runStatus(["--json"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/\[exit:1 \| /);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.daemonLiveness).toBe("alive");
    expect(parsed.serverReachable).toBe(false);
    expect(parsed.serverError).toContain("503");
  });

  it("surfaces distinct daemonLiveness, projectReadiness, slackDelivery and durable operations when reachable", async () => {
    const projectId = computeProjectId({
      projectRoot: tempDir,
      remoteOriginUrl: "git@github.com:org/status-demo.git",
      gitCommonDir: path.join(tempDir, ".git"),
    });
    const registry = createSqliteProjectRegistryAdapter();
    try {
      const enrolled: EnrolledProject = {
        projectId,
        slug: "status-demo",
        name: "status-demo",
        repoSlug: "org/status-demo",
        trunkBranch: "main",
        localRoot: tempDir,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local"] },
        slack: {
          workspaceId: "T_DEMO",
          channelId: "C_DEMO",
          opsChannelId: "C_OPS",
          sharedChannel: false,
        },
        legacyProjectIds: [],
        createdAt: "2026-11-23T00:00:00.000Z",
        updatedAt: "2026-11-23T00:00:00.000Z",
      };
      registry.enrollProject(enrolled);
    } finally {
      registry.close();
    }

    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: "status-demo" },
        server: { host: "127.0.0.1", port: 18790 },
      }),
    );
    vi.spyOn(pidUtils, "readPid").mockReturnValue(process.pid);
    vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(true);

    const healthPayload: HealthResponse = {
      status: "degraded",
      daemonLiveness: "alive",
      projectReadiness: {
        status: "ready",
        readyCount: 1,
        totalCount: 1,
        projects: [
          {
            projectId,
            slug: "status-demo",
            repoSlug: "org/status-demo",
            trunkBranch: "main",
            checkoutPath: tempDir,
            checkoutReady: true,
            runnerAllowed: true,
            slackBound: true,
            status: "ready",
          },
        ],
      },
      slackDelivery: {
        mode: "degraded",
        workspaceId: "T_DEMO",
        connected: false,
        lastError: "socket disconnected",
      },
      telegram: {
        enabled: false,
        reason: "disabled_in_pilot",
      },
      components: {
        server: { status: "ok" },
        git: { status: "ok" },
        network: { status: "ok" },
        slack: { status: "degraded", message: "socket disconnected" },
      },
    };
    const statusPayload: SystemStatus = {
      projectId,
      server: {
        status: "running",
        lifecycle: "ready",
        pid: process.pid,
        uptime: 42,
        port: 18790,
      },
      system: { cpuPercent: 12, memPercent: 34, diskFreeGb: 100 },
      network: { status: "online" },
      dispatch: {
        queueDepth: 1,
        activeCount: 0,
        completedCount: 2,
        failedCount: 0,
        paused: false,
      },
      sandboxes: [],
    };

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/health")) {
        return {
          ok: true,
          status: 200,
          json: async () => healthPayload,
        };
      }
      if (url.includes("/api/status")) {
        return {
          ok: true,
          status: 200,
          json: async () => statusPayload,
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runStatus(["--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(/\[exit:0 \| /);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.daemonLiveness).toBe("alive");
    expect(parsed.serverReachable).toBe(true);
    expect(parsed.projectReadiness).toMatchObject({
      status: "ready",
      readyCount: 1,
      totalCount: 1,
    });
    expect(parsed.slackDelivery).toEqual({
      mode: "degraded",
      workspaceId: "T_DEMO",
      connected: false,
      lastError: "socket disconnected",
    });
    expect(parsed.telegram).toEqual({
      enabled: false,
      reason: "disabled_in_pilot",
    });
    expect(parsed.dispatch).toMatchObject({ queueDepth: 1, completedCount: 2 });
    expect(parsed.durableOperations).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/status?projectId=${encodeURIComponent(projectId)}`),
      expect.anything(),
    );
  });

  it("exits 0 with stopped daemon and local readiness when no server is running or configured", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "status-demo" } }),
    );
    vi.spyOn(pidUtils, "readPid").mockReturnValue(undefined);
    vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runStatus(["--json"]);

    expect(result.exitCode).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.daemonLiveness).toBe("stopped");
    expect(parsed.serverConfigured).toBe(false);
    expect(parsed.serverReachable).toBe(false);
    expect(parsed.projectReadiness.status).toBe("unconfigured");
  });

  it("exits non-zero in text mode when a configured server is unreachable", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: "status-demo" },
        server: { host: "127.0.0.1", port: 19992 },
      }),
    );
    vi.spyOn(pidUtils, "readPid").mockReturnValue(undefined);
    vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")),
    );

    const result = await runStatus([]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("gwrk server is unreachable");
    expect(result.stdout).toContain("Project Readiness");
    expect(result.stdout).toContain("Telegram:");
    expect(result.stderr).toMatch(/\[exit:1 \| /);
  });
});
