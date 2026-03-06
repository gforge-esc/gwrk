import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effortCommand } from "./effort.js";

// Mock the engine modules
vi.mock("../engine/spec-parser.js", () => ({
  extractStories: vi.fn(),
}));
vi.mock("../engine/roles.js", () => ({
  resolveRoleMultipliers: vi.fn(),
}));
vi.mock("../engine/effort.js", () => ({
  computeEffort: vi.fn(),
}));
vi.mock("../engine/report-writer.js", () => ({
  writeEffortReport: vi.fn().mockImplementation(() => "/fake/path/effort-report.md"),
}));

import { extractStories } from "../engine/spec-parser.js";
import { resolveRoleMultipliers } from "../engine/roles.js";
import { computeEffort } from "../engine/effort.js";
import { writeEffortReport } from "../engine/report-writer.js";

describe("FR-011: effortCommand — CLI and JSON output", () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-effort-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((err) => { process.stderr.write(err + "\n"); });
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: "test-project" },
        agents: { define: "gemini", implement: "codex" },
        server: {
          port: 18790,
          host: "localhost",
        },
        parallelism: {
          local: {
            maxCpu: 80,
            maxMem: 80,
            minDiskGb: 10,
            maxClones: 2,
          },
          cloud: {
            maxConcurrent: 10,
          },
        },
      })
    );

    // Setup default mock returns
    vi.mocked(resolveRoleMultipliers).mockReturnValue([]);
    vi.mocked(extractStories).mockReturnValue([{ storyId: "US-001", title: "T", sp: 5, roles: [], rawHours: 0, withOverhead: 0 }]);
    vi.mocked(computeEffort).mockReturnValue({
      featureId: "001-cli-core",
      generatedAt: "2026-01-01T00:00:00Z",
      totalSP: 5,
      overheadFactor: 1.25,
      roles: [],
      stories: [],
      totalRawHours: 20,
      totalWithOverhead: 25,
      totalDays: 3.1,
    });
    vi.mocked(writeEffortReport).mockReturnValue("/fake/path/effort-report.md");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // TR-011: JSON output
  it("TR-011: --json flag outputs valid JSON with EffortReport schema", async () => {
    await effortCommand.parseAsync(["node", "test", "001-cli-core", "--json"]);

    expect(computeEffort).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls[0]![0] as string;
    
    // Output must be valid JSON
    const parsed = JSON.parse(output);
    expect(parsed.totalSP).toBe(5);
    expect(parsed.totalWithOverhead).toBe(25);
  });

  it("prints human readable success message when --json is omitted", async () => {
    await effortCommand.parseAsync(["node", "test", "001-cli-core"]);

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls[0]![0] as string;
    expect(output).toMatch(/Effort report generated at:/);
  });
});
