import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GwrkConfig } from "../../utils/config.js";
import { startServer } from "../index.js";
import { removePid } from "../pid.js";

// Mock dockerode to avoid real docker calls
vi.mock("dockerode");

const mockConfig: GwrkConfig = {
  project: { name: "test" },
  agents: { define: "gemini", implement: "codex-cloud" },
  server: { port: 18793, host: "localhost" },
  parallelism: {
    local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
    cloud: { maxConcurrent: 10 },
  },
};

describe("dispatch routes", () => {
  let tempDir: string;
  let oldCwd: string;

  beforeEach(() => {
    removePid();
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "gwrk-dispatch-route-test-"),
    );
    oldCwd = process.cwd();
    process.chdir(tempDir);

    // Create necessary dirs for context compilation
    fs.mkdirSync(".agent/rules", { recursive: true });
    fs.mkdirSync("specs/feat-1/.gwrk", { recursive: true });
    fs.writeFileSync("specs/feat-1/spec.md", "spec");
    fs.writeFileSync("specs/feat-1/plan.md", "plan");
    fs.writeFileSync("specs/feat-1/.gwrk/tasks.json", '{"tasks":[]}');

    // Initialize git repo in tempDir
    import("node:child_process").then((cp) => {
      cp.execSync("git init", { cwd: tempDir, stdio: "ignore" });
      cp.execSync("git checkout -b feature/feat-1-wip", {
        cwd: tempDir,
        stdio: "ignore",
      });
      fs.writeFileSync("README.md", "test");
      cp.execSync("git add .", { cwd: tempDir, stdio: "ignore" });
      cp.execSync('git commit -m "init"', { cwd: tempDir, stdio: "ignore" });
    });
  });

  afterEach(() => {
    process.chdir(oldCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    removePid();
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

    expect(response.statusCode).toBe(200);
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

  it("should return 404 if dispatch record not found", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });

    const response = await server.inject({
      method: "GET",
      url: "/api/dispatch/nonexistent/phase",
    });

    expect(response.statusCode).toBe(404);
    const json = response.json();
    expect(json.error).toBe("Dispatch record not found");

    await server.close();
  });
});
