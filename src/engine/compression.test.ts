import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "../db/index.js";
import {
  computeCompression,
  computeLeadingIndicators,
  gatherDeliveryActuals,
  generateSummary,
  computeForecastFromLOC,
} from "./compression.js";
import type {
  CompressionRatios,
  CompressionReport,
  CompressionSummary,
  DeliveryActuals,
  EffortForecast,
} from "./types.js";

vi.mock("node:fs");
vi.mock("node:child_process");
vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
}));

/**
 * RED tests for src/engine/compression.ts
 * Contract: contracts/compression-engine.md → computeCompression(), generateSummary()
 * FR-007: Compute Point Compression ratio
 * FR-008: Compute Total Compression ratio
 * FR-009: Cross-feature compression summary with trends
 */

describe("FR-016 & FR-017: computeForecastFromLOC — LOC-derived fallback", () => {
  it("TR-001: computes SP from implementation numstat and spec/plan/research LOC (TS profile)", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(((p: string) => {
      if (p.endsWith("spec.md")) return "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n"; // 5 lines
      if (p.endsWith("plan.md")) return "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n"; // 5 lines
      return "";
    }) as any);

    vi.mocked(execFileSync).mockReturnValue("100\t20\tsrc/file.ts\n50\t10\tsrc/other.ts\n" as any); // 150 added lines

    // TS rate = 50 LOC/SP, DE rate = 25 LOC/SP
    // implSP = 150 / 50 = 3 SP
    // deSP = 10 / 25 = 0.4 SP
    // totalSP = ceil(3 + 0.4) = 4 SP
    const forecast = computeForecastFromLOC("/mock/feat-a", "TS");

    expect(forecast.totalSP).toBe(4);
    expect(forecast.roles[0].role).toBe("TS");
    expect(forecast.estimatedHours).toBe(4 * 4 * 1.25); // 4 SP * 4h/SP * 1.25 overhead = 20h
    expect(forecast.estimatedDays).toBe(3); // ceil(20/8) = 3

    vi.resetAllMocks();
  });

  it("TR-001: computes SP from implementation numstat and spec/plan/research LOC (Rust profile)", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n" as any); // 5 lines * 3 files = 15 lines

    vi.mocked(execFileSync).mockReturnValue("100\t0\tsrc/main.rs\n" as any); // 100 added lines

    // Rust rate = 35 LOC/SP, DE rate = 25 LOC/SP
    // implSP = 100 / 35 = 2.85... SP
    // deSP = 15 / 25 = 0.6 SP
    // totalSP = ceil(2.85 + 0.6) = ceil(3.45) = 4 SP
    const forecast = computeForecastFromLOC("/mock/feat-a", "Rust", 6); // RE multiplier is 6

    expect(forecast.totalSP).toBe(4);
    expect(forecast.roles[0].role).toBe("Rust");
    expect(forecast.estimatedHours).toBe(4 * 6 * 1.25); // 4 SP * 6h/SP * 1.25 overhead = 30h
    expect(forecast.estimatedDays).toBe(4); // ceil(30/8) = 4

    vi.resetAllMocks();
  });
});

describe("FR-005 & FR-006 & FR-010: gatherDeliveryActuals — Git commit clustering", () => {
  it("TR-005 & TR-006: extracts timestamps and clusters commits (15 mins active across 2 sessions)", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      birthtime: new Date("2026-01-01T00:00:00Z"),
      mtime: new Date("2026-01-01T00:00:00Z"),
    } as any);

    vi.mocked(execFileSync).mockImplementation(((cmd: string) => {
      if (cmd === "git") {
        return "2026-01-02T10:00:00Z\n2026-01-02T10:05:00Z\n2026-01-02T10:10:00Z\n2026-01-02T12:00:00Z\n2026-01-02T12:05:00Z\n";
      }
      throw new Error("gh command failed");
    }) as any);

    const actuals = gatherDeliveryActuals("/mock/feat-a", 30);

    expect(actuals.sessionCount).toBe(2);
    // Session 1: 10:00 -> 10:10 (10 mins)
    // Session 2: 12:00 -> 12:05 (5 mins)
    // Total: 15 mins
    expect(actuals.activeCodingMinutes).toBe(15);
    expect(actuals.dormancyDays).toBe(1); // 2026-01-01 to 2026-01-02

    // Check clusters
    expect(actuals.clusters).toBeDefined();
    expect(actuals.clusters).toHaveLength(2);
    expect(actuals.clusters?.[0].durationMinutes).toBe(10);
    expect(actuals.clusters?.[0].commitCount).toBe(3);
    expect(actuals.clusters?.[1].durationMinutes).toBe(5);
    expect(actuals.clusters?.[1].commitCount).toBe(2);

    vi.resetAllMocks();
  });

  it("TR-010: throws when feature has no implementation commits", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      birthtime: new Date(),
      mtime: new Date(),
    } as any);
    vi.mocked(execFileSync).mockReturnValue("" as any); // empty git log

    expect(() => gatherDeliveryActuals("/mock/empty-feat")).toThrow(
      /No implementation commits found/,
    );

    vi.resetAllMocks();
  });

  it("TR-010: throws feature directory not found", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(() => gatherDeliveryActuals("/mock/not-real")).toThrow(
      /Feature directory not found/,
    );

    vi.resetAllMocks();
  });
});

describe("FR-007: computeCompression — Point Compression", () => {
  // TR-007: 287.5h / 0.75h = 383× point compression
  it("TR-007: computes 287.5h estimated / 0.75h actual = 383× point compression", () => {
    const forecast: EffortForecast = {
      totalSP: 39,
      roles: [
        { role: "RE", sp: 24 },
        { role: "TS", sp: 10 },
        { role: "PE", sp: 5 },
      ],
      estimatedHours: 287.5,
      estimatedDays: 36,
    };

    const actuals: DeliveryActuals = {
      specCreatedAt: "2025-10-01T00:00:00Z",
      firstImplCommit: "2026-03-31T15:42:00Z",
      lastImplCommit: "2026-03-31T16:27:00Z",
      dormancyDays: 179,
      activeCodingMinutes: 45, // 0.75 hours
      sessionCount: 1,
      deliveryWindowHours: 17.6,
    };

    const ratios = computeCompression(forecast, actuals);

    // 287.5 / (45/60) = 287.5 / 0.75 = 383.33...
    expect(ratios.pointCompression).toBeCloseTo(383.33, 0);
  });

  it("handles zero active coding time (reports Infinity)", () => {
    const forecast: EffortForecast = {
      totalSP: 5,
      roles: [],
      estimatedHours: 25,
      estimatedDays: 3.125,
    };

    const actuals: DeliveryActuals = {
      specCreatedAt: "2026-01-01T00:00:00Z",
      firstImplCommit: "2026-01-02T10:00:00Z",
      lastImplCommit: "2026-01-02T10:00:00Z",
      dormancyDays: 1,
      activeCodingMinutes: 0,
      sessionCount: 0,
      deliveryWindowHours: 0,
    };

    const ratios = computeCompression(forecast, actuals);
    expect(ratios.pointCompression).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("FR-008: computeCompression — Total Compression", () => {
  // TR-008: 36 days / 0.73 days = 49× total compression
  it("TR-008: computes 36 days estimated / 0.73 days actual = ~49× total compression", () => {
    const forecast: EffortForecast = {
      totalSP: 39,
      roles: [],
      estimatedHours: 287.5,
      estimatedDays: 36,
    };

    const actuals: DeliveryActuals = {
      specCreatedAt: "2025-10-01T00:00:00Z",
      firstImplCommit: "2026-03-31T15:42:00Z",
      lastImplCommit: "2026-03-31T16:27:00Z",
      dormancyDays: 179,
      activeCodingMinutes: 45,
      sessionCount: 1,
      deliveryWindowHours: 17.6, // 0.733 days
    };

    const ratios = computeCompression(forecast, actuals);

    // 36 / (17.6/24) = 36 / 0.733 ≈ 49.1
    expect(ratios.totalCompression).toBeCloseTo(49.1, 0);
  });

  it("dormancy is tracked but excluded from compression calculation", () => {
    const forecast: EffortForecast = {
      totalSP: 10,
      roles: [],
      estimatedHours: 50,
      estimatedDays: 6.25,
    };

    const actuals: DeliveryActuals = {
      specCreatedAt: "2025-06-01T00:00:00Z",
      firstImplCommit: "2026-03-31T15:00:00Z",
      lastImplCommit: "2026-03-31T16:00:00Z",
      dormancyDays: 303,
      activeCodingMinutes: 60,
      sessionCount: 1,
      deliveryWindowHours: 1,
    };

    const ratios = computeCompression(forecast, actuals);

    // Dormancy of 303 days should NOT reduce compression
    expect(ratios.dormancyDays).toBe(303);
    expect(ratios.pointCompression).toBe(50); // 50h / 1h
    expect(ratios.totalCompression).toBeCloseTo(150, 0); // 6.25d / (1/24)d
  });
});

describe("FR-009: generateSummary — cross-feature summary", () => {
  // TR-009: summary across 3 features with best/worst/trend
  it("TR-009: generates summary with totals, averages, best, worst, trend", () => {
    const reports: CompressionReport[] = [
      {
        featureId: "feat-a",
        generatedAt: "2026-01-01T00:00:00Z",
        forecast: {
          totalSP: 10,
          roles: [],
          estimatedHours: 50,
          estimatedDays: 6.25,
        },
        actuals: {
          specCreatedAt: "2025-12-01T00:00:00Z",
          firstImplCommit: "2026-01-01T10:00:00Z",
          lastImplCommit: "2026-01-01T11:00:00Z",
          dormancyDays: 31,
          activeCodingMinutes: 60,
          sessionCount: 1,
          deliveryWindowHours: 1,
        },
        compression: {
          pointCompression: 50,
          totalCompression: 150,
          dormancyDays: 31,
        },
      },
      {
        featureId: "feat-b",
        generatedAt: "2026-02-01T00:00:00Z",
        forecast: {
          totalSP: 20,
          roles: [],
          estimatedHours: 100,
          estimatedDays: 12.5,
        },
        actuals: {
          specCreatedAt: "2026-01-01T00:00:00Z",
          firstImplCommit: "2026-02-01T10:00:00Z",
          lastImplCommit: "2026-02-01T12:00:00Z",
          dormancyDays: 31,
          activeCodingMinutes: 120,
          sessionCount: 2,
          deliveryWindowHours: 2,
        },
        compression: {
          pointCompression: 50,
          totalCompression: 150,
          dormancyDays: 31,
        },
      },
      {
        featureId: "feat-c",
        generatedAt: "2026-03-01T00:00:00Z",
        forecast: {
          totalSP: 5,
          roles: [],
          estimatedHours: 25,
          estimatedDays: 3.125,
        },
        actuals: {
          specCreatedAt: "2026-02-01T00:00:00Z",
          firstImplCommit: "2026-03-01T10:00:00Z",
          lastImplCommit: "2026-03-01T10:30:00Z",
          dormancyDays: 28,
          activeCodingMinutes: 30,
          sessionCount: 1,
          deliveryWindowHours: 0.5,
        },
        compression: {
          pointCompression: 50,
          totalCompression: 150,
          dormancyDays: 28,
        },
      },
    ];

    const summary = generateSummary(reports);

    expect(summary.features).toHaveLength(3);
    expect(summary.totals.totalSP).toBe(35);
    expect(summary.totals.avgPointCompression).toBeGreaterThan(0);
    expect(summary.best.featureId).toBeTruthy();
    expect(summary.worst.featureId).toBeTruthy();
    expect(["improving", "declining", "stable"]).toContain(summary.trend);
  });

  it("handles single feature without crashing", () => {
    const reports: CompressionReport[] = [
      {
        featureId: "solo",
        generatedAt: "2026-01-01T00:00:00Z",
        forecast: {
          totalSP: 5,
          roles: [],
          estimatedHours: 25,
          estimatedDays: 3.125,
        },
        actuals: {
          specCreatedAt: "2025-12-01T00:00:00Z",
          firstImplCommit: "2026-01-01T10:00:00Z",
          lastImplCommit: "2026-01-01T10:30:00Z",
          dormancyDays: 31,
          activeCodingMinutes: 30,
          sessionCount: 1,
          deliveryWindowHours: 0.5,
        },
        compression: {
          pointCompression: 50,
          totalCompression: 150,
          dormancyDays: 31,
        },
      },
    ];

    const summary = generateSummary(reports);
    expect(summary.features).toHaveLength(1);
    expect(summary.best.featureId).toBe("solo");
    expect(summary.worst.featureId).toBe("solo");
  });

  it("handles empty reports array", () => {
    const summary = generateSummary([]);
    expect(summary.features).toHaveLength(0);
    expect(summary.totals.totalSP).toBe(0);
  });
});

describe("FR-014: computeLeadingIndicators", () => {
  it("TR-015: computes convergence, density, and spec quality correctly", () => {
    const mockDb = {
      prepare: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([
        { task_id: "T001", attempts: 1, first_attempt: 1, is_completed: 1 },
        { task_id: "T002", attempts: 2, first_attempt: 1, is_completed: 1 },
      ]),
      get: vi.fn().mockReturnValue({ total_lines: 100, total_files: 5 }),
    };

    vi.mocked(getDb).mockReturnValue(mockDb as any);

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockImplementation(((p: string) => {
      if (p.endsWith("contracts")) return ["c1.md", "c2.md"];
      if (p.endsWith("gates")) return ["T001-gate.sh"];
      if (p.endsWith(".runs")) return ["feat-a.log"];
      return [];
    }) as any);
    vi.mocked(fs.readFileSync).mockReturnValue("[10:00:00]  $ git commit\n[10:05:00]  > pnpm build");

    const forecast: EffortForecast = {
      totalSP: 10,
      roles: [],
      estimatedHours: 50,
      estimatedDays: 6.25,
    };

    const indicators = computeLeadingIndicators("feat-a", forecast, "proj-1");

    expect(indicators.convergence.firstPassRate).toBe(50); // 1/2
    expect(indicators.convergence.avgAttempts).toBe(1.5); // (1+2)/2
    expect(indicators.density.linesPerSP).toBe(10); // 100 / 10
    expect(indicators.density.filesPerSP).toBe(0.5); // 5 / 10
    expect(indicators.density.toolCallsPerSP).toBe(0.2); // 2 / 10
    expect(indicators.specQuality.contractCount).toBe(2);
    expect(indicators.specQuality.gateCount).toBe(1);
  });
});
