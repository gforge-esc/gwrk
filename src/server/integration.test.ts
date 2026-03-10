import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startServer } from "./index.js";
import type { GwrkConfig } from "../utils/config.js";
import { removePid } from "./pid.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listRuns } from "../db/runs.js";
import { getDb } from "../db/index.js";

// Mock sandbox to avoid real Docker calls in integration test for now,
// or use real docker if we want true integration.
// Given the constraints and environment, mocking sandbox is safer for CI/CD.
vi.mock("./sandbox.js", () => {
  return {
    SandboxManager: vi.fn().mockImplementation(() => ({
      checkDocker: vi.fn().mockResolvedValue(true),
      createSandbox: vi.fn().mockResolvedValue("test-container-id"),
      destroySandbox: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

// Mock git manager to avoid real git operations
vi.mock("./git-manager.js", () => {
  return {
    GitManager: vi.fn().mockImplementation(() => ({
      createPhaseBranch: vi.fn().mockReturnValue(undefined),
    })),
  };
});

// Mock monitor to avoid throttling
vi.mock("./monitor.js", () => {
  return {
    SystemMonitor: vi.fn().mockImplementation(() => ({
      isThrottled: vi.fn().mockReturnValue(false),
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      sample: vi.fn().mockReturnValue({ cpuPercent: 0, memPercent: 0, diskFreeGb: 100 }),
    })),
  };
});

describe("Server Integration", () => {
  let tempDir: string;
  let oldCwd: string;
  let server: any;
  const port = 18795;

  const mockConfig: GwrkConfig = {
    project: { name: "integration-test" },
    agents: { 
      define: "gemini", 
      implement: "codex-cloud",
      fallbackOrder: ["codex-cloud", "claude"]
    },
    server: { port, host: "localhost" },
    parallelism: {
      local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
      cloud: { maxConcurrent: 10 },
    },
  };

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-int-test-"));
    oldCwd = process.cwd();
    process.chdir(tempDir);

    // Setup minimal project structure
    fs.mkdirSync(".agent/rules", { recursive: true });
    fs.mkdirSync("specs/feat-1/.gwrk", { recursive: true });
    fs.writeFileSync("specs/feat-1/spec.md", "spec");
    fs.writeFileSync("specs/feat-1/plan.md", "plan");
    fs.writeFileSync("specs/feat-1/.gwrk/tasks.json", '{"tasks":[]}');

    // Initialize DB in temp dir
    process.env.GWRK_DB_PATH = path.join(tempDir, "gwrk.db");

    server = await startServer(mockConfig, { handleSignals: false });
  });

  afterAll(async () => {
    if (server) await server.close();
    process.chdir(oldCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    removePid();
  });

  it("should handle a full dispatch lifecycle", async () => {
    // 1. POST dispatch
    const response = await server.inject({
      method: "POST",
      url: "/api/dispatch",
      payload: {
        featureId: "feat-1",
        phaseId: "phase-1",
      },
    });

    expect(response.statusCode).toBe(200);
    const record = response.json();
    expect(record.featureId).toBe("feat-1");
    expect(["queued", "running", "completed"]).toContain(record.status);

    // 2. Wait for it to be processed (it runs in background)
    // We mocked sandbox, git and monitor, so it should be fast.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 3. Check status
    const statusResponse = await server.inject({
      method: "GET",
      url: `/api/dispatch/feat-1/phase-1`,
    });
    expect(statusResponse.statusCode).toBe(200);
    const updatedRecord = statusResponse.json();
    expect(updatedRecord.status).toBe("completed");

    // 4. Check SQLite ledger
    const runs = listRuns("feat-1");
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].feature_id).toBe("feat-1");
    expect(runs[0].phase_id).toBe("phase-1");
    expect(runs[0].exit_code).toBe(0);
  }, 10000);
});
