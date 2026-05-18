import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { shipCommand } from "./ship.js";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("../utils/setup-state.js", () => ({
  loadSetupState: vi.fn(),
}));

describe("ship pre-flight setup check (Phase 10) (RED)", () => {
  let tempDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-setup-test-"));
    program = new Command();
    program.addCommand(shipCommand);
    
    // Setup mock feature
    const featureDir = path.join(tempDir, "specs", "test-feature");
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Spec");
    fs.writeFileSync(path.join(featureDir, "plan.md"), "# Plan");

    // Create a mock .gwrkrc.json
    fs.writeFileSync(path.join(tempDir, ".gwrkrc.json"), JSON.stringify({
      project: { name: "test-project" },
      agents: { define: "gemini", implement: "claude" }
    }));

    fs.mkdirSync(path.join(featureDir, ".gwrk"), { recursive: true });
    fs.writeFileSync(path.join(featureDir, ".gwrk", "tasks.json"), JSON.stringify({
      featureId: "test-feature",
      phases: [{ id: "phase-01", title: "Phase 1", tasks: [{ id: "T001", title: "Task 1", status: "open" }] }]
    }));

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it("FR-022: SHOULD reject ship execution if setup.json is missing (RED)", async () => {
    const { loadSetupState } = await import("../utils/setup-state.js");
    (loadSetupState as any).mockReturnValue(null);

    await program.parseAsync(["node", "test", "ship", "test-feature", "1"]);
    
    // In RED state, ship proceeds because check is not implemented
    expect(process.exitCode).toBe(1);
  });

  it("FR-022: SHOULD reject ship execution if setup.json is incomplete (RED)", async () => {
    const { loadSetupState } = await import("../utils/setup-state.js");
    (loadSetupState as any).mockReturnValue({
      completedAt: new Date().toISOString(),
      steps: { tcc: true, ssh: false, gh: true, verification: false } // Incomplete
    });

    await program.parseAsync(["node", "test", "ship", "test-feature", "1"]);
    
    expect(process.exitCode).toBe(1);
  });
});
