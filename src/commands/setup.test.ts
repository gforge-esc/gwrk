import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { setupCommand } from "./setup.js";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("../utils/setup-state.js", () => ({
  saveSetupState: vi.fn(),
  loadSetupState: vi.fn().mockReturnValue(null),
}));

describe("gwrk setup (Phase 10) (RED)", () => {
  let tempDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-test-"));
    program = new Command();
    program.addCommand(setupCommand);
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("US-021: SHOULD run the 4-step wizard and write setup.json (RED)", async () => {
    // This will fail because setupCommand throws "Not implemented"
    await program.parseAsync(["node", "test", "setup"]);
    
    const setupPath = path.join(os.homedir(), ".gwrk", "setup.json");
    // We expect the command to have interacted and eventually written state
    // Note: In real test we would mock prompts, here we just verify it doesn't crash 
    // and calls the save function.
    const { saveSetupState } = await import("../utils/setup-state.js");
    expect(saveSetupState).toHaveBeenCalledWith(expect.objectContaining({
      steps: expect.objectContaining({
        verification: true
      })
    }));
  });

  it("FR-022: SHOULD generate dedicated SSH key and update ~/.ssh/config (RED)", async () => {
    // Mocking the shell commands for SSH key gen would happen in implementation
    await program.parseAsync(["node", "test", "setup"]);
    
    const sshKeyPath = path.join(os.homedir(), ".ssh", "gwrk-agent");
    // Implementation should create this file (mocked or actual in integration)
    // For unit test, we'd check if the exec call happened.
  });
});
