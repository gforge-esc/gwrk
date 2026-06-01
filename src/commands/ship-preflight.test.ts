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

vi.mock("../utils/setup-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/setup-state.js")>();
  return {
    ...actual,
    loadSetupState: mockLoadSetupState,
    isSetupComplete: mockIsSetupComplete,
  };
});

import { shipCommand } from "./ship.js";

describe("gwrk ship: Pre-flight Setup Check (Phase 10)", () => {
  let tempDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-preflight-test-"));

    const featureDir = path.join(tempDir, "specs", "test-feature");
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Spec");
    fs.writeFileSync(path.join(featureDir, "tasks.json"), JSON.stringify({ phases: [] }));

    program = new Command();
    program.addCommand(shipCommand);

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Run gwrk setup first"));
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
  });

  it("US-021: SHOULD proceed with ship if setup.json is complete", async () => {
    mockLoadSetupState.mockReturnValue({ steps: { tcc: true, ssh: true, gh: true, verification: true } });
    mockIsSetupComplete.mockReturnValue(true);

    try {
      await program.parseAsync(["node", "test", "ship", "test-feature", "1"]);
    } catch {
      // Expected failure later in ship (missing phase, etc.)
    }
    
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("Run gwrk setup first"));
  });
});