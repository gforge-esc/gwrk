import { exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GwrkConfig } from "../utils/config.js";
import { startServer } from "./index.js";
import { removePid } from "./pid.js";

const execAsync = promisify(exec);

const mockConfig: GwrkConfig = {
  project: { name: "test-integration" },
  agents: { define: "gemini", implement: "codex-cloud" },
  server: { port: 18899, host: "localhost" },
  parallelism: {
    local: { maxCpu: 100, maxMem: 100, minDiskGb: 0, maxClones: 10 },
    cloud: { maxConcurrent: 10 },
  },
};

describe("Server E2E Integration", () => {
  let tempDir: string;
  let oldCwd: string;

  beforeEach(async () => {
    removePid();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-integration-test-"));
    oldCwd = process.cwd();
    process.chdir(tempDir);

    // Initialize mock workspace
    fs.mkdirSync(".agent/rules", { recursive: true });
    fs.mkdirSync("specs/feat-1/.gwrk", { recursive: true });
    fs.writeFileSync("specs/feat-1/spec.md", "# Spec 1");
    fs.writeFileSync("specs/feat-1/plan.md", "# Plan 1");
    fs.writeFileSync(
      "specs/feat-1/.gwrk/tasks.json",
      JSON.stringify({
        featureId: "feat-1",
        phases: [{ id: "phase-1", tasks: [] }],
      }),
    );

    await execAsync("git init && git checkout -b feature/feat-1-wip", {
      cwd: tempDir,
    });
    fs.writeFileSync("README.md", "initial");
    await execAsync("git add . && git commit -m 'initial'", { cwd: tempDir });
  });

  afterEach(() => {
    process.chdir(oldCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    removePid();
  });

  it("should start daemon and accept a dispatch request", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });

    // 1. POST /api/dispatch
    const postResponse = await server.inject({
      method: "POST",
      url: "/api/dispatch",
      payload: {
        featureId: "feat-1",
        phaseId: "phase-1",
      },
    });

    expect(postResponse.statusCode).toBe(200);
    const record = postResponse.json();
    expect(record.featureId).toBe("feat-1");
    expect(record.status).toBe("running"); // Should be running immediately since not throttled

    // 2. GET /api/dispatch/queue
    const queueResponse = await server.inject({
      method: "GET",
      url: "/api/dispatch/queue",
    });
    expect(queueResponse.statusCode).toBe(200);
    const queue = queueResponse.json();
    expect(queue.active.length).toBe(1);

    // 3. GET /api/dispatch/feat-1/phase-1
    const getResponse = await server.inject({
      method: "GET",
      url: "/api/dispatch/feat-1/phase-1",
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().id).toBe(record.id);

    await server.close();
  });
});
