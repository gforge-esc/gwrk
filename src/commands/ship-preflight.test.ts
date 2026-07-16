/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const { mockLoadSetupState, mockIsSetupComplete } = vi.hoisted(() => ({
  mockLoadSetupState: vi.fn(),
  mockIsSetupComplete: vi.fn(),
}));

// Mock config BEFORE importing ship command
vi.mock("../utils/config.js", () => ({
  loadConfig: () => ({
    project: { name: "test", slack: {} },
    agents: { implement: "gemini" },
    parallelism: { local: { maxClones: 2 } },
  }),
}));

vi.mock("../utils/resolve-feature.js", () => ({
  resolveFeature: vi.fn().mockImplementation((f: string) => f),
}));

vi.mock("../db/runs.js", () => ({
  startRun: vi.fn().mockReturnValue(999),
  finishRun: vi.fn(),
  recordHistory: vi.fn(),
}));

vi.mock("../utils/setup-state.js", () => ({
  loadSetupState: mockLoadSetupState,
  isSetupComplete: mockIsSetupComplete,
  saveSetupState: vi.fn(),
}));

import { resolveFeature } from "../utils/resolve-feature.js";
import { shipCommand } from "./ship.js";

describe("gwrk ship: Pre-flight Setup Check (Phase 10)", () => {
  let tempDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-preflight-test-"));

    const featureDir = path.join(tempDir, "specs", "test-feature");
    const gwrkDir = path.join(featureDir, ".gwrk");
    fs.mkdirSync(gwrkDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Spec");
    fs.writeFileSync(path.join(gwrkDir, "tasks.json"), JSON.stringify({
      featureId: "test-feature",
      createdAt: new Date().toISOString(),
      phases: [{
        id: "phase-01",
        title: "Phase 1",
        tasks: [{ id: "T001", title: "Task 1", status: "open", description: "Desc", gateScript: "gates/T001-gate.sh" }],
        sp_estimate: 0
      }]
    }));

    program = new Command();
    program.addCommand(shipCommand);

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(resolveFeature).mockReturnValue("test-feature");
    mockLoadSetupState.mockReset();
    mockIsSetupComplete.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("US-021: SHOULD reject ship if setup.json is missing", async () => {
    mockLoadSetupState.mockReturnValue(null);
    mockIsSetupComplete.mockReturnValue(false);
    process.exitCode = 0;
    try {
      await program.parseAsync(["node", "test", "ship", "test-feature", "1"]);
    } catch {
      // Expected
    }
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Run gwrk init first"));
  });

  it("US-021: SHOULD reject ship if setup.json is incomplete", async () => {
    mockLoadSetupState.mockReturnValue({ steps: { tcc: false, ssh: false, gh: false, verification: false } });
    mockIsSetupComplete.mockReturnValue(false);
    process.exitCode = 0;
    try {
      await program.parseAsync(["node", "test", "ship", "test-feature", "1"]);
    } catch {
      // Expected
    }
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Run gwrk init first"));
  });

  it("dry-run bypasses the workstation pre-flight (no setup required)", async () => {
    mockLoadSetupState.mockReturnValue(null);
    mockIsSetupComplete.mockReturnValue(false);
    process.exitCode = 0;
    try {
      await program.parseAsync([
        "node",
        "test",
        "ship",
        "test-feature",
        "1",
        "--dry-run",
      ]);
    } catch {
      // ignore
    }
    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining("Run gwrk init first"),
    );
  });

  it("dry-run reports the backend it would build with", async () => {
    mockLoadSetupState.mockReturnValue(null);
    mockIsSetupComplete.mockReturnValue(false);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await program.parseAsync([
        "node",
        "test",
        "ship",
        "test-feature",
        "1",
        "--dry-run",
      ]);
    } catch {
      // ignore
    }
    // loadConfig mock sets agents.implement = "gemini"
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("gemini");
  });

  it("US-021: SHOULD proceed with ship if setup.json is complete", async () => {
    mockLoadSetupState.mockReturnValue({ steps: { tcc: true, ssh: true, gh: true, verification: true } });
    mockIsSetupComplete.mockReturnValue(true);

    try {
      await program.parseAsync(["node", "test", "ship", "test-feature", "1"]);
    } catch {
      // Expected failure later in ship (missing phase, etc.)
    }
    
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("Run gwrk init first"));
  });
});