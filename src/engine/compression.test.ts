/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "../db/index.js";
import {
  computeCompression,
  computeForecastFromLOC,
  gatherDeliveryActuals,
  generateSummary,
} from "./compression.js";
import { computeLeadingIndicators } from "./indicators.js";
import type {
  CompressionReport,
  DeliveryActuals,
  EffortForecast,
} from "./types.js";

vi.mock("node:fs");
vi.mock("node:child_process");
vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
}));

describe("FR-016 & FR-017: computeForecastFromLOC — LOC-derived fallback", () => {
  it("TR-001: computes SP from implementation numstat and spec/plan/research LOC (TS profile)", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(((p: string) => {
      if (p.endsWith("spec.md")) return "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n";
      if (p.endsWith("plan.md")) return "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n";
      return "";
    }) as any);

    vi.mocked(execFileSync).mockReturnValue(
      "100\t20\tsrc/file.ts\n50\t10\tsrc/other.ts\n" as any,
    );

    const forecast = computeForecastFromLOC("/mock/feat-a", "TS");

    expect(forecast.totalSP).toBe(4);
    expect(forecast.roles[0].role).toBe("TS");
    expect(forecast.estimatedHours).toBe(4 * 4 * 1.25);
    expect(forecast.estimatedDays).toBe(3);

    vi.resetAllMocks();
  });

  it("TR-001: computes SP from implementation numstat and spec/plan/research LOC (Rust profile)", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n" as any,
    );

    vi.mocked(execFileSync).mockReturnValue("100\t0\tsrc/main.rs\n" as any);

    const forecast = computeForecastFromLOC("/mock/feat-a", "Rust", 6);

    expect(forecast.totalSP).toBe(4);
    expect(forecast.roles[0].role).toBe("Rust");
    expect(forecast.estimatedHours).toBe(4 * 6 * 1.25);
    expect(forecast.estimatedDays).toBe(4);

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
    expect(actuals.activeCodingMinutes).toBe(15);
    expect(actuals.dormancyDays).toBe(1);
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
    vi.mocked(execFileSync).mockReturnValue("" as any);

    expect(() => gatherDeliveryActuals("/mock/empty-feat")).toThrow(
      /No implementation commits found/,
    );

    vi.resetAllMocks();
  });
});

describe("FR-007 & FR-008: computeCompression", () => {
  it("TR-007 & TR-008: computes Point and Total Compression ratios accurately", () => {
    const forecast: EffortForecast = {
      totalSP: 10,
      roles: [{ role: "PE", sp: 10 }],
      estimatedHours: 50,
      estimatedDays: 6.25,
    };

    const actuals: DeliveryActuals = {
      specCreatedAt: "2026-01-01T00:00:00Z",
      firstImplCommit: "2026-01-02T10:00:00Z",
      lastImplCommit: "2026-01-02T12:00:00Z",
      prMergedAt: "2026-01-02T12:00:00Z",
      dormancyDays: 1,
      activeCodingMinutes: 60,
      sessionCount: 1,
      deliveryWindowHours: 24,
    };

    const ratios = computeCompression(forecast, actuals);
    expect(ratios.pointCompression).toBe(50);
    expect(ratios.totalCompression).toBe(6.25);
    expect(ratios.dormancyDays).toBe(1);
  });
});

describe("FR-009: generateSummary", () => {
  it("TR-009: aggregates multiple features and identifies best/worst/trend", () => {
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
          prMergedAt: "2026-01-01T11:00:00Z",
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
          prMergedAt: "2026-02-01T12:00:00Z",
          dormancyDays: 31,
          activeCodingMinutes: 60,
          sessionCount: 2,
          deliveryWindowHours: 2,
        },
        compression: {
          pointCompression: 100,
          totalCompression: 150,
          dormancyDays: 31,
        },
      },
    ];

    const summary = generateSummary(reports);

    expect(summary.features).toHaveLength(2);
    expect(summary.totals.totalSP).toBe(30);
    expect(summary.totals.avgPointCompression).toBe(75);
    expect(summary.best.featureId).toBe("feat-b");
    expect(summary.worst.featureId).toBe("feat-a");
    expect(summary.trend).toBe("improving");
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
    vi.mocked(fs.readFileSync).mockReturnValue(
      "[10:00:00]  $ git commit\n[10:05:00]  > pnpm build",
    );

    const forecast: EffortForecast = {
      totalSP: 10,
      roles: [],
      estimatedHours: 50,
      estimatedDays: 6.25,
    };

    const indicators = computeLeadingIndicators("feat-a", forecast, "proj-1");

    expect(indicators.convergence.firstPassRate).toBe(50);
    expect(indicators.convergence.avgAttempts).toBe(1.5);
    expect(indicators.density.linesPerSP).toBe(10);
    expect(indicators.density.filesPerSP).toBe(0.5);
    expect(indicators.density.toolCallsPerSP).toBe(0.2);
    expect(indicators.specQuality.contractCount).toBe(2);
    expect(indicators.specQuality.gateCount).toBe(1);
  });
});
