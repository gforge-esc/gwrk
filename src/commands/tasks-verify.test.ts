import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tasksCommand } from "./tasks.js";
import { writeManifest } from "../utils/manifest.js";
import { CommandError } from "../utils/signal.js";

describe("gwrk tasks verify", () => {
  const tempDir = path.join(process.cwd(), "temp-test-verify");

  beforeEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    // Mock tasks.json
    const featureDir = path.join(tempDir, "specs", "test-feature");
    const gwrkDir = path.join(featureDir, ".gwrk");
    fs.mkdirSync(path.join(gwrkDir, "runs"), { recursive: true });

    fs.writeFileSync(
      path.join(gwrkDir, "tasks.json"),
      JSON.stringify({
        featureId: "test-feature",
        createdAt: new Date().toISOString(),
        phases: [
          {
            id: "phase-01",
            title: "Phase 1",
            tasks: [
              { id: "T001", title: "Task 1", status: "completed" },
              { id: "T002", title: "Task 2", status: "open" }
            ],
          },
        ],
      })
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // FR-020, US-020
  it("should pass when all completed tasks have manifests and no orphans exist", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      // Create manifest for T001
      const featureDir = path.join(tempDir, "specs", "test-feature");
      writeManifest(featureDir, {
        runId: "mock-run-1",
        feature: "test-feature",
        phase: "phase-01",
        command: "tasks done",
        agent: "user",
        model: "none",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationS: 1,
        exitCode: 0,
        attempt: 1,
        filesChanged: 0,
        linesAdded: 0,
        linesDeleted: 0,
        gitCommit: "abc",
        gitBranch: "main",
        digest: ["Completed task T001"]
      });

      vi.spyOn(console, "log").mockImplementation(() => {});
      process.exitCode = 0;

      await tasksCommand.parseAsync(["verify", "test-feature"], { from: "user" });

      expect(process.exitCode).toBe(0);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should fail when a completed task is missing its manifest (regression)", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      
      // No manifest created for completed task T001
      
      await expect(tasksCommand.parseAsync(["verify", "test-feature"], { from: "user" }))
        .rejects.toThrow(CommandError);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should fail when an orphan manifest exists for an open task", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const featureDir = path.join(tempDir, "specs", "test-feature");
      
      // Manifest for T001 (Valid)
      writeManifest(featureDir, {
        runId: "mock-run-1",
        feature: "test-feature",
        phase: "phase-01",
        command: "tasks done",
        agent: "user",
        model: "none",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationS: 1,
        exitCode: 0,
        attempt: 1,
        filesChanged: 0,
        linesAdded: 0,
        linesDeleted: 0,
        gitCommit: "abc",
        gitBranch: "main",
        digest: ["Completed task T001"]
      });

      // Manifest for T002 (Orphan - T002 is still open)
      writeManifest(featureDir, {
        runId: "mock-run-2",
        feature: "test-feature",
        phase: "phase-01",
        command: "tasks done",
        agent: "user",
        model: "none",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationS: 1,
        exitCode: 0,
        attempt: 1,
        filesChanged: 0,
        linesAdded: 0,
        linesDeleted: 0,
        gitCommit: "def",
        gitBranch: "main",
        digest: ["Completed task T002"]
      });

      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      
      await expect(tasksCommand.parseAsync(["verify", "test-feature"], { from: "user" }))
        .rejects.toThrow(CommandError);
    } finally {
      process.chdir(originalCwd);
    }
  });
});