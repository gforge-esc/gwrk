import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tasksCommand } from "./tasks.js";
import { writeManifest } from "../utils/manifest.js";
import { CommandError } from "../utils/signal.js";

describe("gwrk tasks verify (Phase 9)", () => {
  let tempDir: string;
  let featureDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tasks-verify-test-"));
    featureDir = path.join(tempDir, "specs", "test-feature");
    fs.mkdirSync(path.join(featureDir, ".gwrk"), { recursive: true });
    
    // Create valid tasks.json in correct location
    const state = {
      featureId: "test-feature",
      createdAt: new Date().toISOString(),
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          tasks: [
            { id: "T001", title: "Task 1", description: "Desc 1", status: "completed", gateScript: "gates/T001-gate.sh" },
            { id: "T002", title: "Task 2", description: "Desc 2", status: "open", gateScript: "gates/T002-gate.sh" }
          ]
        }
      ]
    };
    fs.writeFileSync(path.join(featureDir, ".gwrk", "tasks.json"), JSON.stringify(state));

    program = new Command();
    program.addCommand(tasksCommand);

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Reset exitCode
    process.exitCode = 0;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it("FR-020: SHOULD pass when all completed tasks have manifests", async () => {
    // Create manifest for T001
    const manifest = {
      runId: "run1",
      feature: "test-feature",
      phase: "phase-01",
      command: "ship",
      agent: "gemini",
      model: "model",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationS: 10,
      exitCode: 0,
      attempt: 1,
      gitCommit: "abc",
      gitBranch: "main",
      filesChanged: 0,
      linesAdded: 0,
      linesDeleted: 0,
      digest: ["T001: PASS"] 
    };
    writeManifest(featureDir, manifest);

    await program.parseAsync(["node", "test", "tasks", "verify", "test-feature"]);
    expect(process.exitCode).toBe(0);
  });

  it("FR-020: SHOULD fail when a completed task is missing its manifest (RED)", async () => {
    // T001 is completed in tasks.json, but we provide NO manifest
    await program.parseAsync(["node", "test", "tasks", "verify", "test-feature"]);
    
    // In RED state, this fails because verify always returns success (exitCode 0)
    expect(process.exitCode).toBe(1);
  });

  it("FR-020: SHOULD fail when an orphan manifest exists for an open task (RED)", async () => {
    // Create manifest for T002 (which is 'open')
    const manifest = {
      runId: "run2",
      feature: "test-feature",
      phase: "phase-01",
      command: "ship",
      agent: "gemini",
      model: "model",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationS: 10,
      exitCode: 0,
      attempt: 1,
      gitCommit: "abc",
      gitBranch: "main",
      filesChanged: 0,
      linesAdded: 0,
      linesDeleted: 0,
      digest: ["T002: PASS"]
    };
    writeManifest(featureDir, manifest);

    await program.parseAsync(["node", "test", "tasks", "verify", "test-feature"]);
    
    // In RED state, this fails because verify always returns success (exitCode 0)
    expect(process.exitCode).toBe(1);
  });

  it("FR-020: SHOULD fail when tasks.json schema is invalid (RED)", async () => {
    // Overwrite tasks.json with invalid schema (missing phases)
    const invalidState = {
      featureId: "test-feature",
      createdAt: new Date().toISOString()
      // phases missing
    };
    fs.writeFileSync(path.join(featureDir, ".gwrk", "tasks.json"), JSON.stringify(invalidState));

    // loadTaskState should exit(1) on Zod error
    await program.parseAsync(["node", "test", "tasks", "verify", "test-feature"]);
    expect(process.exitCode).toBe(1);
  });
});
