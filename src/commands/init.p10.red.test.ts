import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initCommand } from "./init.js";

/**
 * Phase 10 RED Tests: .agents/ Decoupling
 * TR-P10-001: Rules seeding during init
 */
describe("initCommand (Phase 10 RED)", () => {
  let tempDir: string;
  let homeDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-init-p10-test-"));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-home-p10-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(os, "homedir").mockReturnValue(homeDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("FR-L25-005: should seed .gwrk/rules/ from builtins during init (TR-P10-001)", async () => {
    // SC-008: gwrk init populates rules
    await initCommand.parseAsync([], { from: "user" });

    const rulesDir = path.join(tempDir, ".gwrk", "rules");
    expect(fs.existsSync(path.join(rulesDir, "operating-model.md")), "operating-model.md should be seeded").toBe(true);
    expect(fs.existsSync(path.join(rulesDir, "workspace.md")), "workspace.md should be seeded").toBe(true);
  });

  it("SC-010: should ensure legacy .agents/ paths are inert (ADR-007)", async () => {
    await initCommand.parseAsync([], { from: "user" });
    // TC-011: Zero-dependency workflows should not create .agents/
    expect(fs.existsSync(path.join(tempDir, ".agents"))).toBe(false);
  });

  it("should fail to initialize if required builtin rules are missing (Negative Path)", async () => {
    // This assumes we implement a check for builtin rules existence
    // For now, this is a placeholder for a failing negative path
    // We can simulate missing builtins if we knew where they are read from in init.ts
    // For RED test, we just want it to fail or show a specific behavior.
    
    // If we mock fs.readFileSync for the builtin path to throw
    vi.spyOn(fs, "readFileSync").mockImplementation((p: any) => {
      if (typeof p === 'string' && p.includes("builtins/rules")) {
        throw new Error("Builtin rules missing");
      }
      return vi.importActual("node:fs").then((m: any) => m.readFileSync(p));
    });

    await expect(initCommand.parseAsync([], { from: "user" })).rejects.toThrow("Builtin rules missing");
  });
});
