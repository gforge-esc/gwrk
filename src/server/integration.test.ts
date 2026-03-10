import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Docker from "dockerode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GwrkConfig } from "../utils/config.js";
import { startServer } from "./index.js";
import { removePid } from "./pid.js";

// Mock the DB to avoid real SQLite in integration test for now
vi.mock("../db/runs.js", () => ({
  startRun: vi.fn().mockReturnValue(1),
  finishRun: vi.fn(),
  getDb: vi.fn(),
}));

const mockConfig: GwrkConfig = {
  project: { name: "test-integration" },
  agents: {
    define: "gemini",
    implement: "codex-cloud",
    fallbackOrder: ["claude"],
  },
  server: { port: 18795, host: "localhost" },
  parallelism: {
    local: { maxCpu: 100, maxMem: 100, minDiskGb: 0, maxClones: 2 },
    cloud: { maxConcurrent: 10 },
  },
};

describe("Server Integration", () => {
  let tempDir: string;
  let oldCwd: string;
  let docker: Docker;

  beforeEach(async () => {
    removePid();
    docker = new Docker();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-integration-test-"));
    oldCwd = process.cwd();
    process.chdir(tempDir);

    // Create necessary dirs for context compilation
    fs.mkdirSync(".agent/rules", { recursive: true });
    fs.mkdirSync("specs/feat-int/.gwrk", { recursive: true });
    fs.writeFileSync("specs/feat-int/spec.md", "spec");
    fs.writeFileSync("specs/feat-int/plan.md", "plan");
    fs.writeFileSync("specs/feat-int/.gwrk/tasks.json", '{"phases":[]}');

    // Initialize git repo
    const { execSync } = await import("node:child_process");
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: tempDir });
    execSync('git config user.name "Test User"', { cwd: tempDir });
    execSync("git checkout -b feature/feat-int-wip", {
      cwd: tempDir,
      stdio: "ignore",
    });
    fs.writeFileSync("README.md", "test");
    execSync("git add .", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "init"', { cwd: tempDir, stdio: "ignore" });
  });

  afterEach(() => {
    process.chdir(oldCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    removePid();
  });

  it("should handle full dispatch lifecycle", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });

    try {
      // 1. Dispatch
      const dispatchResponse = await server.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: {
          featureId: "feat-int",
          phaseId: "phase-1",
        },
      });

      expect(dispatchResponse.statusCode).toBe(200);
      const record = dispatchResponse.json();
      expect(["queued", "running"]).toContain(record.status);

      // 2. Wait for it to start and have a containerId
      let activeRecord: any;
      for (let i = 0; i < 50; i++) {
        const statusResponse = await server.inject({
          method: "GET",
          url: "/api/dispatch/queue",
        });
        const status = statusResponse.json();
        if (status.active.length > 0 && status.active[0].containerId) {
          activeRecord = status.active[0];
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      if (!activeRecord) {
        throw new Error("Timed out waiting for active record with containerId");
      }

      // 3. Verify Docker container exists and is running
      const container = docker.getContainer(activeRecord.containerId);
      const info = await container.inspect();
      expect(info.State.Running).toBe(true);
      expect(info.Config.Labels["gwrk.feature"]).toBe("feat-int");

      // 4. Wait for completion (simulated 2s)
      for (let i = 0; i < 50; i++) {
        const res = await server.inject({
          method: "GET",
          url: "/api/dispatch/feat-int/phase-1",
        });
        if (res.json().status === "completed") break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // 5. Verify container destroyed
      for (let i = 0; i < 50; i++) {
        const containersAfter = await docker.listContainers({
          filters: { label: ["gwrk.feature=feat-int"] },
        });
        if (containersAfter.length === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } finally {
      await server.close();
    }
  }, 40000);
});
