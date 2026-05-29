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
    // SC-010: Negative Path
    // Use the actual fs for non-mocked paths
    const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const existsSpy = vi.spyOn(fs, "existsSync").mockImplementation((p: any) => {
      const pathStr = String(p);
      if (pathStr.includes("builtins/rules")) {
        return false;
      }
      if (pathStr.includes(".gwrk")) {
        return false;
      }
      return realFs.existsSync(p);
    });

    await initCommand.parseAsync([], { from: "user" });

    // In withSignal, CommandError sets process.exitCode
    expect(process.exitCode).toBe(1);

    existsSpy.mockRestore();
  });
});
