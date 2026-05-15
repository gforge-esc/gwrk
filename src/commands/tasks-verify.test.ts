import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Module does not exist yet (RED) — Phase 9: tasks verify implementation pending
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
    fs.mkdirSync(featureDir, { recursive: true });
    
    // Create valid tasks.json
    const state = {
      featureId: "test-feature",
      createdAt: new Date().toISOString(),
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          tasks: [
            { id: "T001", title: "Task 1", status: "completed", gateScript: "gates/T001-gate.sh" },
            { id: "T002", title: "Task 2", status: "open", gateScript: "gates/T002-gate.sh" }
          ]
        }
      ]
    };
    fs.mkdirSync(path.join(featureDir, ".gwrk"), { recursive: true });
    fs.writeFileSync(path.join(featureDir, "tasks.json"), JSON.stringify(state));

    program = new Command();
    program.addCommand(tasksCommand);

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
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
      digest: ["T001: PASS"] // Mocking task ID in digest or manifest
    };
    // Note: writeManifest is mocked or uses real implementation if available
    writeManifest(featureDir, manifest);

    await program.parseAsync(["node", "test", "tasks", "verify", "test-feature"]);
    expect(process.exitCode).toBe(0);
  });

  it("FR-020: SHOULD fail when a completed task is missing its manifest", async () => {
    // T001 is completed in tasks.json, but we provide NO manifest
    process.exitCode = 0;
    await program.parseAsync(["node", "test", "tasks", "verify", "test-feature"]);
    expect(process.exitCode).toBe(1);
  });

  it("FR-020: SHOULD fail when an orphan manifest exists for an open task", async () => {
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

    process.exitCode = 0;
    await program.parseAsync(["node", "test", "tasks", "verify", "test-feature"]);
    expect(process.exitCode).toBe(1);
  });
});