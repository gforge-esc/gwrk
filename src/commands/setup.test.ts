import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
// Module does not exist yet (RED) — Phase 10: setup implementation pending
import { setupCommand } from "./setup.js";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("../utils/exec.js", () => ({
  run: vi.fn().mockResolvedValue({ exitCode: 0 }),
}));

describe("gwrk setup (Phase 10)", () => {
  let tempDir: string;
  let homeDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-test-"));
    homeDir = path.join(tempDir, "home");
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(path.join(homeDir, ".ssh"), { recursive: true });

    // Mock process.env.HOME
    vi.stubEnv("HOME", homeDir);

    program = new Command();
    program.addCommand(setupCommand);

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("US-021: SHOULD run the 4-step wizard and write setup.json", async () => {
    // This test is RED because setup.ts is not implemented
    await program.parseAsync(["node", "test", "setup"]);

    const setupJsonPath = path.join(homeDir, ".gwrk", "setup.json");
    expect(fs.existsSync(setupJsonPath)).toBe(true);

    const setupData = JSON.parse(fs.readFileSync(setupJsonPath, "utf-8"));
    expect(setupData.steps.tcc).toBe(true);
    expect(setupData.steps.ssh).toBe(true);
    expect(setupData.steps.gh).toBe(true);
    expect(setupData.steps.verification).toBe(true);
  });

  it("US-021: SHOULD generate a dedicated SSH key for the agent by default", async () => {
    await program.parseAsync(["node", "test", "setup"]);

    const keyPath = path.join(homeDir, ".ssh", "gwrk-agent");
    expect(fs.existsSync(keyPath)).toBe(true);
    
    const sshConfigPath = path.join(homeDir, ".ssh", "config");
    expect(fs.existsSync(sshConfigPath)).toBe(true);
    const configContent = fs.readFileSync(sshConfigPath, "utf-8");
    expect(configContent).toContain("IdentityFile ~/.ssh/gwrk-agent");
  });
});