/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import {
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";
import { openDatabase } from "../db/index.js";
import { computeProjectId } from "../domain/project-id.js";
import type { EnrolledProject } from "../domain/project-registry.js";
import type { WorkerExecutionPort } from "../ports/operations-port.js";
import type { GwrkConfig } from "../utils/config.js";
import * as dockerUtils from "./docker.js";
import { HarvestWatcher } from "./harvest-watcher.js";
import { startServer } from "./index.js";
import { SystemMonitor } from "./monitor.js";
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
  checkGit: vi.fn().mockResolvedValue(true),
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

  it("T035: runs startup recovery before draining dispatches and wires operationsStore to status and health", async () => {
    const tmpDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-server-index-")),
    );
    const repoDir = path.join(tmpDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const gitEnv = {
      ...repositoryGitEnv(repoDir),
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Gwrk Test",
      GIT_AUTHOR_EMAIL: "gwrk-test@example.invalid",
      GIT_COMMITTER_NAME: "Gwrk Test",
      GIT_COMMITTER_EMAIL: "gwrk-test@example.invalid",
      GIT_TERMINAL_PROMPT: "0",
    };
    execFileSync("git", ["init", "--template=", "--initial-branch=main"], {
      cwd: repoDir,
      env: gitEnv,
      stdio: "ignore",
    });
    execFileSync(
      "git",
      ["remote", "add", "origin", "git@github.com:org/boot-order.git"],
      { cwd: repoDir, env: gitEnv, stdio: "ignore" },
    );
    const db = openDatabase({ dbPath: path.join(tmpDir, "gwrk.db") });
    vi.spyOn(HarvestWatcher.prototype, "start").mockImplementation(() => {});
    vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(false);

    try {
      const registry = createSqliteProjectRegistryAdapter({ db });
      const ops = createSqliteOperationsStoreAdapter({ db });
      const projectId = computeProjectId({
        projectRoot: repoDir,
        remoteOriginUrl: "git@github.com:org/boot-order.git",
        gitCommonDir: path.join(repoDir, ".git"),
      });
      const project: EnrolledProject = registry.enrollProject({
        projectId,
        slug: "boot-order",
        name: "Boot Order",
        repoSlug: "org/boot-order",
        trunkBranch: "main",
        localRoot: repoDir,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local"] },
        slack: {
          workspaceId: "T_BOOT",
          channelId: "C_BOOT",
          sharedChannel: false,
        },
        legacyProjectIds: [],
        createdAt: "2026-11-23T00:00:00.000Z",
        updatedAt: "2026-11-23T00:00:00.000Z",
      });

      // Seed one expired running dispatch (needs recoverOnStartup) and one accepted dispatch (needs drain)
      const stale = ops.acceptDispatch({
        projectId: project.projectId,
        featureId: "049-order",
        phaseId: "phase-01",
        backend: "claude",
        trunkBranch: "main",
        recipient: null,
        newOperationId: "disp-stale-order",
        nowIso: "2026-11-23T09:00:00.000Z",
      });
      ops.claimDispatchLease({
        operationId: stale.operationId,
        leaseOwner: "old-daemon",
        nowIso: "2026-11-23T09:00:01.000Z",
        leaseExpiresAt: "2026-11-23T09:05:00.000Z",
      });
      ops.acceptDispatch({
        projectId: project.projectId,
        featureId: "049-order",
        phaseId: "phase-02",
        backend: "claude",
        trunkBranch: "main",
        recipient: null,
        newOperationId: "disp-queued-order",
        nowIso: "2026-11-23T09:01:00.000Z",
      });

      const events: string[] = [];
      const worker: WorkerExecutionPort = {
        inspectRecoveredWork: async (input) => {
          events.push(`inspect:${input.operationId}`);
          return {
            workerState: "stopped",
            pullRequestLookup: "complete",
            openPullRequest: {
              operationId: input.operationId,
              prNumber: 12,
              prUrl: "https://github.com/org/boot-order/pull/12",
            },
            mergedPullRequest: null,
            completedManifestRunId: null,
            sandboxDir: null,
          };
        },
        launchPhaseShip: async (input) => {
          events.push(`launch:${input.phaseId}`);
          return { exitCode: 0, stderr: "" };
        },
        cleanupStaleSandbox: async () => {},
      };

      const server = await startServer(mockConfig, {
        handleSignals: false,
        projectRoot: tmpDir,
        ledger: { db, projectId: project.projectId },
        registry,
        operationsStore: ops,
        worker,
        clock: {
          nowIso: () => "2026-11-23T10:00:00.000Z",
          nowMs: () => Date.parse("2026-11-23T10:00:00.000Z"),
        },
        heartbeatIntervalMs: null,
      });

      try {
        await vi.waitFor(() => {
          expect(events).toContain("launch:phase-02");
        });
        expect(events[0]).toBe("inspect:disp-stale-order");
        expect(events.indexOf("inspect:disp-stale-order")).toBeLessThan(
          events.indexOf("launch:phase-02"),
        );

        const statusRes = await server.inject({
          method: "GET",
          url: `/api/status?projectId=${project.projectId}`,
        });
        expect(statusRes.statusCode).toBe(200);
        expect(statusRes.json().operations).toBeDefined();
        expect(statusRes.json().operations.projectId).toBe(project.projectId);

        const healthRes = await server.inject({
          method: "GET",
          url: "/api/health",
        });
        expect(healthRes.statusCode).toBe(200);
        expect(healthRes.json().outbox).toBeDefined();
        expect(healthRes.json().harvest).toBeDefined();
      } finally {
        await server.close();
      }
    } finally {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // TODO: ensureDocker is called inside Fastify's plugin chain, which swallows
  // the rejection. This test needs to be redesigned once Docker checks are moved
  // to a pre-flight guard before server.listen().
  it.todo("should fail to start if Docker is not available");
});
