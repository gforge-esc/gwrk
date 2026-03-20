import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

const CLI_PATH = path.resolve(process.cwd(), "dist/cli.js");

describe("005-parallel-dispatch E2E", () => {
  const testFeatureDir = path.resolve(process.cwd(), "specs/999-test-parallel");
  const runsDir = path.resolve(process.cwd(), ".runs/sandboxes");

  beforeEach(() => {
    // Setup dummy feature with tasks
    if (!fs.existsSync(testFeatureDir)) {
      fs.mkdirSync(testFeatureDir, { recursive: true });
    }
    const tasks = {
      tasks: [
        { id: "T1", status: "ready", backend: "gemini", prompt: "task 1" },
        { id: "T2", status: "ready", backend: "gemini", prompt: "task 2" },
        { id: "T3", status: "ready", backend: "gemini", prompt: "task 3" },
      ]
    };
    fs.writeFileSync(
      path.join(testFeatureDir, "tasks.json"),
      JSON.stringify(tasks, null, 2)
    );
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(testFeatureDir)) {
      fs.rmSync(testFeatureDir, { recursive: true });
    }
  });

  it("US-001: should dispatch multiple tasks concurrently and create sandboxes", () => {
    // This requires the server to be running or the 'ship' command to handle local dispatch
    // For red test, we expect the command to exist but maybe fail or not produce sandboxes yet
    
    try {
      // Mocking the concurrency for the test run if possible via env
      execSync(`node ${CLI_PATH} ship 999-test-parallel --concurrency 3`, {
        env: { ...process.env, GWRK_CONCURRENCY: "3" },
        stdio: "pipe"
      });
    } catch (e) {
      // Expected to fail or exit with error since not implemented
    }

    // Verify sandbox directories were created (Acceptance Scenario 1)
    if (fs.existsSync(runsDir)) {
      const sandboxes = fs.readdirSync(runsDir).filter(d => d.startsWith("999-test-parallel"));
      // In RED state, this will likely be 0
      expect(sandboxes.length).toBeGreaterThanOrEqual(3);
    } else {
      throw new Error(".runs/sandboxes not found");
    }
  });

  it("US-004: should respect max concurrency limits", () => {
    // Similar to above but with --concurrency 1
    try {
      execSync(`node ${CLI_PATH} ship 999-test-parallel --concurrency 1`, {
        stdio: "pipe"
      });
    } catch (e) {}

    // Verify at most 1 sandbox exists if we could catch it mid-run
    // But since it's a sync command in this test, we might just check logs
    // For now, keep it simple as a RED assertion
    expect(true).toBe(false); // Force RED for now as we can't easily probe mid-run without more infra
  });
});
