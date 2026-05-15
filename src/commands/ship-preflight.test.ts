import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
// Module does not exist yet (RED) — Phase 10: ship pre-flight setup check pending
import { shipCommand } from "./ship.js";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("gwrk ship: Pre-flight Setup Check (Phase 10)", () => {
  let tempDir: string;
  let homeDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-preflight-test-"));
    homeDir = path.join(tempDir, "home");
    fs.mkdirSync(homeDir, { recursive: true });
    vi.stubEnv("HOME", homeDir);

    const featureDir = path.join(tempDir, "specs", "test-feature");
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Spec");
    fs.writeFileSync(path.join(featureDir, "tasks.json"), JSON.stringify({ phases: [] }));

    program = new Command();
    program.addCommand(shipCommand);

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("US-021: SHOULD reject ship if setup.json is missing", async () => {
    process.exitCode = 0;
    try {
      await program.parseAsync(["node", "test", "ship", "test-feature", "1"]);
    } catch {
      // Expected
    }
    expect(process.exitCode).toBe(1);
    // Should print guidance
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Run gwrk setup first"));
  });

  it("US-021: SHOULD reject ship if setup.json is incomplete", async () => {
    const setupJsonPath = path.join(homeDir, ".gwrk", "setup.json");
    fs.mkdirSync(path.dirname(setupJsonPath), { recursive: true });
    fs.writeFileSync(setupJsonPath, JSON.stringify({ steps: { tcc: false } }));

    process.exitCode = 0;
    try {
      await program.parseAsync(["node", "test", "ship", "test-feature", "1"]);
    } catch {
      // Expected
    }
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Run gwrk setup first"));
  });

  it("US-021: SHOULD proceed with ship if setup.json is complete", async () => {
    const setupJsonPath = path.join(homeDir, ".gwrk", "setup.json");
    fs.mkdirSync(path.dirname(setupJsonPath), { recursive: true });
    fs.writeFileSync(setupJsonPath, JSON.stringify({
      steps: { tcc: true, ssh: true, gh: true, verification: true }
    }));

    // Mock other ship requirements to not fail here
    vi.mock("../utils/config.js", () => ({
      loadConfig: () => ({ agents: { implement: "gemini" } })
    }));

    // This might still fail later due to other mocks, but it should PASS the pre-flight check
    // We can check if it passed the specific "Run gwrk setup first" check.
    try {
      await program.parseAsync(["node", "test", "ship", "test-feature", "1"]);
    } catch {
      // Expected failure later in ship
    }
    
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("Run gwrk setup first"));
  });
});
