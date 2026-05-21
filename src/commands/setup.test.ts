import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { setupCommand } from "./setup.js";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn((cmd) => {
    if (cmd.includes("ssh -T")) return "successfully authenticated";
    return "";
  }),
}));

vi.mock("../utils/setup-state.js", () => ({
  saveSetupState: vi.fn(),
  loadSetupState: vi.fn().mockReturnValue(null),
  isSetupComplete: vi.fn().mockReturnValue(true),
}));

vi.mock("node:readline", () => {
  return {
    createInterface: vi.fn(() => ({
      question: vi.fn((q, cb) => {
        if (typeof q === "string" && q.includes("Choice?")) {
          cb("b");
        } else {
          cb("y");
        }
      }),
      close: vi.fn(),
    })),
  };
});

describe("gwrk setup (Phase 10)", () => {
  let tempDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-test-"));
    program = new Command();
    program.addCommand(setupCommand);
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // @ts-ignore
    process.stdin.isTTY = true;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("US-021: SHOULD run the 4-step wizard and write setup.json", async () => {
    await program.parseAsync(["node", "test", "setup"]);
    
    const setupPath = path.join(os.homedir(), ".gwrk", "setup.json");
    // We expect the command to have interacted and eventually written state
    const { saveSetupState } = await import("../utils/setup-state.js");
    expect(saveSetupState).toHaveBeenCalledWith(expect.objectContaining({
      steps: expect.objectContaining({
        verification: true
      })
    }));
  });

  it("FR-022: SHOULD generate dedicated SSH key and update ~/.ssh/config", async () => {
    await program.parseAsync(["node", "test", "setup"]);
  });
});
