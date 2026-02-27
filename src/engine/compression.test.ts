import { describe, it, expect } from "vitest";
import { computeCompression, generateSummary } from "./compression.js";
import type {
  CompressionRatios,
  CompressionReport,
  CompressionSummary,
  DeliveryActuals,
  EffortForecast,
} from "./types.js";

/**
 * RED tests for src/engine/compression.ts
 * Contract: contracts/compression-engine.md → computeCompression(), generateSummary()
 * FR-007: Compute Point Compression ratio
 * FR-008: Compute Total Compression ratio
 * FR-009: Cross-feature compression summary with trends
 */

describe("FR-007: computeCompression — Point Compression", () => {
  // TR-007: 287.5h / 0.75h = 383× point compression
  it("TR-007: computes 287.5h estimated / 0.75h actual = 383× point compression", () => {
    const forecast: EffortForecast = {
      totalSP: 39,
      roles: [{ role: "RE", sp: 24 }, { role: "TS", sp: 10 }, { role: "PE", sp: 5 }],
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
    expect(ratios.pointCompression).toBe(Infinity);
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
        forecast: { totalSP: 10, roles: [], estimatedHours: 50, estimatedDays: 6.25 },
        actuals: {
          specCreatedAt: "2025-12-01T00:00:00Z",
          firstImplCommit: "2026-01-01T10:00:00Z",
          lastImplCommit: "2026-01-01T11:00:00Z",
          dormancyDays: 31,
          activeCodingMinutes: 60,
          sessionCount: 1,
          deliveryWindowHours: 1,
        },
        compression: { pointCompression: 50, totalCompression: 150, dormancyDays: 31 },
      },
      {
        featureId: "feat-b",
        generatedAt: "2026-02-01T00:00:00Z",
        forecast: { totalSP: 20, roles: [], estimatedHours: 100, estimatedDays: 12.5 },
        actuals: {
          specCreatedAt: "2026-01-01T00:00:00Z",
          firstImplCommit: "2026-02-01T10:00:00Z",
          lastImplCommit: "2026-02-01T12:00:00Z",
          dormancyDays: 31,
          activeCodingMinutes: 120,
          sessionCount: 2,
          deliveryWindowHours: 2,
        },
        compression: { pointCompression: 50, totalCompression: 150, dormancyDays: 31 },
      },
      {
        featureId: "feat-c",
        generatedAt: "2026-03-01T00:00:00Z",
        forecast: { totalSP: 5, roles: [], estimatedHours: 25, estimatedDays: 3.125 },
        actuals: {
          specCreatedAt: "2026-02-01T00:00:00Z",
          firstImplCommit: "2026-03-01T10:00:00Z",
          lastImplCommit: "2026-03-01T10:30:00Z",
          dormancyDays: 28,
          activeCodingMinutes: 30,
          sessionCount: 1,
          deliveryWindowHours: 0.5,
        },
        compression: { pointCompression: 50, totalCompression: 150, dormancyDays: 28 },
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
        forecast: { totalSP: 5, roles: [], estimatedHours: 25, estimatedDays: 3.125 },
        actuals: {
          specCreatedAt: "2025-12-01T00:00:00Z",
          firstImplCommit: "2026-01-01T10:00:00Z",
          lastImplCommit: "2026-01-01T10:30:00Z",
          dormancyDays: 31,
          activeCodingMinutes: 30,
          sessionCount: 1,
          deliveryWindowHours: 0.5,
        },
        compression: { pointCompression: 50, totalCompression: 150, dormancyDays: 31 },
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
