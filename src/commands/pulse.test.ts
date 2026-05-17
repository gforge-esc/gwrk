import { Command } from "commander";
// src/commands/pulse.test.ts
// Unit tests for 006-pulse Phase 2 + Phase 3
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerPulseCommands,
  renderPulseTable,
  renderSnapshotTable,
} from "./pulse.js";

// Mock the engine module
vi.mock("../engine/pulse.js", () => ({
  scanRepository: vi.fn(),
  generatePulseReport: vi.fn(),
  scanSpecProgress: vi.fn(),
}));

// Mock config
vi.mock("../utils/config.js", () => ({
  loadConfig: vi.fn(),
}));

import { generatePulseReport, scanRepository } from "../engine/pulse.js";
import { loadConfig } from "../utils/config.js";

const mockScanRepository = vi.mocked(scanRepository);
const mockGeneratePulseReport = vi.mocked(generatePulseReport);
const mockLoadConfig = vi.mocked(loadConfig);

// ─── Phase 2 & 3 Tests ───────────────────────────────────────────

describe("FR-001: gwrk measure pulse command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.exitCode = 0;
  });

  it("TR-004: reads pulse.repos from config and invokes scanner per repo", async () => {
    const mockConfig = {
      project: { name: "test" },
      agents: { define: "gemini" as const, implement: "codex-cloud" as const },
      pulse: { repos: ["/tmp/repo-a", "/tmp/repo-b"] },
    };
    mockLoadConfig.mockReturnValue(mockConfig);

    const mockReport = {
      generatedAt: new Date().toISOString(),
      repositories: [],
      specProgress: { totalSpecs: 0, totalPlans: 0 },
    };
    mockGeneratePulseReport.mockReturnValue(mockReport);

    const program = new Command();
    program.exitOverride(); 
    program.enablePositionalOptions();
    const measure = program.command("measure");
    registerPulseCommands(measure);

    await program.parseAsync(["measure", "pulse"], { from: "user" });

    expect(mockLoadConfig).toHaveBeenCalled();
    expect(mockGeneratePulseReport).toHaveBeenCalledWith(mockConfig);
    expect(console.log).toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("TR-006: exits with error when no repos configured", async () => {
    const mockConfig = {
      project: { name: "test" },
      agents: { define: "gemini" as const, implement: "codex-cloud" as const },
      pulse: { repos: [] },
    };
    mockLoadConfig.mockReturnValue(mockConfig);
    mockGeneratePulseReport.mockImplementation(() => {
      throw new Error("No repositories tracked. Add repos to .gwrkrc.json pulse.repos");
    });

    const program = new Command();
    program.exitOverride();
    program.enablePositionalOptions();
    const measure = program.command("measure");
    registerPulseCommands(measure);

    await program.parseAsync(["measure", "pulse"], { from: "user" });
    expect(process.exitCode).toBe(1);
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining("No repositories tracked"));
  });
});

describe("FR-002/FR-006: gwrk measure pulse scan command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.exitCode = 0;
  });

  it("TR-005: validates path and calls scanRepository", async () => {
    const mockSnapshot = {
      repoPath: "/tmp/test-repo",
      repoName: "test-repo",
      defaultBranch: "main",
      scannedAt: "2026-01-01T00:00:00Z",
      mainLoc: 500,
      draftLoc: 100,
      weeklyBuckets: [],
    };
    mockScanRepository.mockReturnValue(mockSnapshot);

    const fs = require("node:fs");
    vi.spyOn(fs, "existsSync").mockImplementation((p: string) => true);

    const program = new Command();
    program.exitOverride();
    program.enablePositionalOptions();
    const measure = program.command("measure");
    registerPulseCommands(measure);

    await program.parseAsync(["measure", "pulse", "scan", "/tmp/test-repo"], { from: "user" });

    expect(mockScanRepository).toHaveBeenCalledWith(expect.stringContaining("test-repo"), undefined);
    expect(console.log).toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("TR-006: exits with error when path does not exist", async () => {
    const fs = require("node:fs");
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const program = new Command();
    program.exitOverride();
    program.enablePositionalOptions();
    const measure = program.command("measure");
    registerPulseCommands(measure);

    await program.parseAsync(["measure", "pulse", "scan", "/non/existent/path"], { from: "user" });
    expect(process.exitCode).toBe(1);
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining("Path not found"));
  });

  it("TR-006: exits with error when path is not a git repo", async () => {
    const fs = require("node:fs");
    vi.spyOn(fs, "existsSync").mockImplementation((p: string) => {
      if (p.endsWith(".git")) return false;
      return true;
    });

    const program = new Command();
    program.exitOverride();
    program.enablePositionalOptions();
    const measure = program.command("measure");
    registerPulseCommands(measure);

    await program.parseAsync(["measure", "pulse", "scan", "/not/a/git/repo"], { from: "user" });
    expect(process.exitCode).toBe(1);
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining("Not a git repository"));
  });

  it("TR-005: outputs JSON when --json flag is passed", async () => {
    const mockSnapshot = {
      repoPath: "/tmp/test-repo",
      repoName: "test-repo",
      defaultBranch: "main",
      scannedAt: "2026-01-01T00:00:00Z",
      mainLoc: 500,
      draftLoc: 100,
      weeklyBuckets: [],
    };
    mockScanRepository.mockReturnValue(mockSnapshot);
    const fs = require("node:fs");
    vi.spyOn(fs, "existsSync").mockReturnValue(true);

    const program = new Command();
    program.exitOverride();
    program.enablePositionalOptions();
    const measure = program.command("measure");
    registerPulseCommands(measure);

    await program.parseAsync(["measure", "pulse", "scan", "/tmp/test-repo", "--json"], { from: "user" });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"repoName": "test-repo"')
    );
    expect(process.exitCode).toBe(0);
  });
});

describe("Formatting: Tables (Phase 3)", () => {
  it("renders multi-repo PulseReport as formatted terminal table", () => {
    const mockReport = {
      generatedAt: "2026-01-01T00:00:00Z",
      repositories: [
        {
          repoPath: "/tmp/repo-a",
          repoName: "repo-a",
          defaultBranch: "main",
          scannedAt: "2026-01-01T00:00:00Z",
          mainLoc: 1000,
          draftLoc: 200,
          weeklyBuckets: [],
        },
        {
          repoPath: "/tmp/repo-b",
          repoName: "repo-b",
          defaultBranch: "main",
          scannedAt: "2026-01-01T00:00:00Z",
          mainLoc: 500,
          draftLoc: 50,
          weeklyBuckets: [],
        },
      ],
      specProgress: { totalSpecs: 3, totalPlans: 2 },
    };

    const output = renderPulseTable(mockReport);

    expect(output).toContain("repo-a");
    expect(output).toContain("repo-b");
    expect(output).toContain("1000");
    expect(output).toContain("500");
    expect(output).toContain("3 specs");
    expect(output).toContain("2 plans");
  });

  it("renders single PulseSnapshot as formatted terminal table", () => {
    const mockSnapshot = {
      repoPath: "/tmp/test-repo",
      repoName: "test-repo",
      defaultBranch: "main",
      scannedAt: "2026-01-01T00:00:00Z",
      mainLoc: 800,
      draftLoc: 150,
      weeklyBuckets: [
        {
          weekStart: "2026-01-06T00:00:00Z",
          totalMain: 800,
          totalDrafts: 150,
          added: 100,
          deleted: 10,
        },
      ],
    };

    const output = renderSnapshotTable(mockSnapshot);

    expect(output).toContain("test-repo");
    expect(output).toContain("800");
    expect(output).toContain("main");
    expect(output).toContain("2026-01-06");
    expect(output).toContain("+100");
    expect(output).toContain("-10");
  });
});

