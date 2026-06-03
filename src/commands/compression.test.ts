import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compressionCommand } from "./compression.js";

vi.mock("../engine/compression.js", () => ({
  gatherDeliveryActuals: vi.fn(),
  computeCompression: vi.fn(),
  generateSummary: vi.fn(),
  computeLeadingIndicators: vi.fn(),
}));
vi.mock("../db/compression.js", () => ({
  recordCompression: vi.fn(),
}));
vi.mock("../utils/project-id.js", () => ({
  resolveProjectId: vi.fn().mockReturnValue("test-proj"),
}));
vi.mock("../engine/spec-parser.js", () => ({
  extractStories: vi.fn(),
}));
vi.mock("../engine/roles.js", () => ({
  resolveRoleMultipliers: vi.fn(),
}));
vi.mock("../engine/effort.js", () => ({
  computeEffort: vi.fn(),
}));

import {
  computeCompression,
  computeLeadingIndicators,
  gatherDeliveryActuals,
  generateSummary,
} from "../engine/compression.js";
import { computeEffort } from "../engine/effort.js";
import { extractStories } from "../engine/spec-parser.js";
import { recordCompression } from "../db/compression.js";

describe("FR-011 & FR-009 & FR-010: compressionCommand", () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-comp-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
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
      }),
    );

    const specsDir = path.join(tempDir, "specs", "001-mock");
    fs.mkdirSync(specsDir, { recursive: true });

    vi.mocked(extractStories).mockReturnValue([]);
    vi.mocked(computeEffort).mockReturnValue({
      featureId: "001-mock",
      generatedAt: "",
      totalSP: 5,
      overheadFactor: 1.25,
      roles: [],
      stories: [],
      totalRawHours: 20,
      totalWithOverhead: 25,
      totalDays: 3.1,
    });

    vi.mocked(gatherDeliveryActuals).mockReturnValue({
      specCreatedAt: "",
      firstImplCommit: "",
      lastImplCommit: "",
      dormancyDays: 10,
      activeCodingMinutes: 60,
      sessionCount: 1,
      deliveryWindowHours: 24,
    });

    vi.mocked(computeCompression).mockReturnValue({
      pointCompression: 25,
      totalCompression: 3.1,
      dormancyDays: 10,
    });

    vi.mocked(computeLeadingIndicators).mockReturnValue({
      convergence: { firstPassRate: 80, avgAttempts: 1.2 },
      density: { linesPerSP: 10, filesPerSP: 0.5, toolCallsPerSP: 2 },
      specQuality: { contractCount: 2, gateCount: 3 },
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // TR-012: --json flag valid output
  it("TR-012: --json outputs valid JSON with pointCompression", async () => {
    await compressionCommand.parseAsync(["node", "test", "001-mock", "--json"]);

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);

    expect(parsed.compression.pointCompression).toBe(25);
    expect(parsed.compression.totalCompression).toBe(3.1);
    expect(parsed.indicators.convergence.firstPassRate).toBe(80);
  });

  // FR-015: Indicators in text output
  it("FR-015: displays leading indicators in text output", async () => {
    await compressionCommand.parseAsync(["node", "test", "001-mock"]);

    const fullLog = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(fullLog).toContain("--- Leading Indicators ---");
    expect(fullLog).toContain("80% first-pass");
    expect(fullLog).toContain("10 lines/SP");
    expect(fullLog).toContain("2 contracts");
    expect(recordCompression).toHaveBeenCalled();
  });

  // US-005, FR-009: Cross-feature compression summary
  it("US-005: --all flag computes summary across features", async () => {
    const specsDir = path.join(tempDir, "specs");
    fs.mkdirSync(path.join(specsDir, "002-mock"));

    vi.mocked(generateSummary).mockReturnValue({
      projectName: "Test",
      generatedAt: "",
      features: [],
      totals: {
        totalSP: 10,
        totalEstimatedHours: 50,
        totalActualCodingHours: 2,
        avgPointCompression: 25,
        avgTotalCompression: 3,
      },
      best: { featureId: "001-mock", pointCompression: 25 },
      worst: { featureId: "002-mock", pointCompression: 20 },
      trend: "stable",
    });

    await compressionCommand.parseAsync(["node", "test", "--all"]);

    expect(generateSummary).toHaveBeenCalled();
    const fullLog = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(fullLog).toContain("=== COMPRESSION SUMMARY ===");
    expect(fullLog).toContain("Total SP Delivered");
  });

  it("TR-010: exits with code 1 when no impl commits (error bubbled from gatherDeliveryActuals)", async () => {
    vi.mocked(gatherDeliveryActuals).mockImplementation(() => {
      throw new Error("No implementation commits found");
    });
    process.exitCode = 0;

    await compressionCommand.parseAsync(["node", "test", "001-mock"]);
    
    expect(process.exitCode).toBe(1);
  });
});
