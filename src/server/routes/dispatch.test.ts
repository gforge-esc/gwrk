/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gwrkPaths from "../../adapters/config/paths.js";
import * as instanceLocks from "../../adapters/server/instance-lock.js";
import type { GwrkConfig } from "../../utils/config.js";
import { HarvestWatcher } from "../harvest-watcher.js";
import { startServer } from "../index.js";
import { SystemMonitor } from "../monitor.js";

// Mock dependencies
vi.mock("dockerode");
vi.mock("../slack-notify.js");
vi.mock("../../utils/slack-client.js", () => ({
  loadSlackConfig: vi.fn().mockReturnValue(null),
}));
vi.mock("../docker.js", () => ({
  ensureDocker: vi.fn().mockResolvedValue({ installed: true, running: true }),
}));

const mockConfig: GwrkConfig = {
  project: { name: "test" },
  agents: { define: "gemini", implement: "codex-cloud" },
  server: {
    githubWebhookSecret: "mock_secret",
    port: 0,
    host: "127.0.0.1",
    heartbeatIntervalMs: 1000,
    networkCheckIntervalMs: 1000,
  },
  parallelism: {
    local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
    cloud: { maxConcurrent: 10 },
  },
};

describe("dispatch routes", () => {
  let tempDir: string;
  let oldCwd: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "gwrk-dispatch-route-test-"),
    );
    vi.stubEnv("GWRK_HOME", path.join(tempDir, "state"));
    vi.stubEnv("GWRK_DIR", undefined);
    vi.stubEnv("GWRK_DB_PATH", undefined);
    vi.stubEnv("GWRK_RUNTIME_DIR", undefined);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", undefined);
    vi.spyOn(HarvestWatcher.prototype, "runCheck").mockResolvedValue(undefined);
    vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(true);
    oldCwd = process.cwd();
    process.chdir(tempDir);

    // Create necessary dirs for context compilation
    fs.mkdirSync(".gwrk/rules", { recursive: true });
    fs.mkdirSync("specs/feat-1/.gwrk", { recursive: true });
    fs.writeFileSync("specs/feat-1/spec.md", "spec");
    fs.writeFileSync("specs/feat-1/plan.md", "plan");
    fs.writeFileSync("specs/feat-1/.gwrk/tasks.json", '{"tasks":[]}');

    // Initialize git repo in tempDir
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync("git checkout -b feature/feat-1-wip", {
      cwd: tempDir,
      stdio: "ignore",
    });
    fs.writeFileSync("README.md", "test");
    execSync("git add .", { cwd: tempDir, stdio: "ignore" });
    execSync(
      'git -c user.name="Dispatch fixture" -c user.email=dispatch@example.invalid commit --no-edit --no-gpg-sign --author="Dispatch fixture <dispatch@example.invalid>" -m init',
      { cwd: tempDir, stdio: "ignore" },
    );
  });

  afterEach(() => {
    process.chdir(oldCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("should enqueue a dispatch via POST /api/dispatch", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });

    const response = await server.inject({
      method: "POST",
      url: "/api/dispatch",
      payload: {
        featureId: "feat-1",
        phaseId: "phase-1",
      },
    });

    expect(response.statusCode).toBe(201);
    const json = response.json();
    expect(json.featureId).toBe("feat-1");
    expect(json.phaseId).toBe("phase-1");
    expect(json.status).toBeDefined();

    await server.close();
  });

  it("should return the queue status via GET /api/dispatch/queue", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });

    const response = await server.inject({
      method: "GET",
      url: "/api/dispatch/queue",
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.active).toBeDefined();
    expect(json.queued).toBeDefined();

    await server.close();
  });

  it.each([
    {
      scenario: "hosted dispatch with a conflicting override",
      hosted: true,
      request: { backend: "unapproved-fixture", taskIds: ["T1", "T2"] },
      taskIds: ["T1", "T2"],
      backend: "fixture",
    },
    {
      scenario: "hosted dispatch with no override",
      hosted: true,
      request: { taskId: "T1" },
      taskIds: ["T1"],
      backend: "fixture",
    },
    {
      scenario: "non-hosted dispatch with an explicit backend",
      hosted: false,
      request: { backend: "explicit-fixture", taskId: "T1" },
      taskIds: ["T1"],
      backend: "explicit-fixture",
    },
  ])(
    "queues the selected backend for $scenario",
    async ({ hosted, request, taskIds, backend }) => {
      vi.stubEnv("GWRK_APPROVED_AGENT", "fixture");
      if (hosted) {
        vi.stubEnv("GWRK_RUNTIME_DIR", path.join(tempDir, "runtime"));
        vi.spyOn(gwrkPaths, "usesHostedRuntime").mockReturnValue(true);
        const lock = {
          pid: process.pid,
          lockPath: "fixture",
          release: vi.fn(),
        };
        vi.spyOn(instanceLocks, "acquireInstanceLock").mockReturnValue(lock);
        vi.spyOn(instanceLocks, "acquireLedgerLock").mockReturnValue(lock);
      }
      const server = await startServer(mockConfig, { handleSignals: false });
      try {
        const response = await server.inject({
          method: "POST",
          url: "/api/dispatch",
          payload: { featureId: "feat-1", phaseId: "phase-1", ...request },
        });
        expect(response.statusCode).toBe(201);
        const record = response.json();
        expect(record.backend).toBe(backend);
        expect(record.tasks).toMatchObject(
          taskIds.map((id) => ({ id, backend })),
        );

        const queue = await server.inject("/api/dispatch/queue");
        expect(queue.statusCode).toBe(200);
        expect(queue.json()).toMatchObject({ active: [], queued: [record] });
      } finally {
        await server.close();
      }
    },
  );

  it("should return a specific dispatch via GET /api/dispatch/:feature/:phase", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });

    // First enqueue it
    await server.inject({
      method: "POST",
      url: "/api/dispatch",
      payload: {
        featureId: "feat-1",
        phaseId: "phase-1",
      },
    });

    const response = await server.inject({
      method: "GET",
      url: "/api/dispatch/feat-1/phase-1",
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.featureId).toBe("feat-1");
    expect(json.phaseId).toBe("phase-1");

    await server.close();
  });
});
