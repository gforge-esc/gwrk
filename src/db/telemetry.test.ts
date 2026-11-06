/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeCompression,
  computeTelemetryMetrics,
  generateSummary,
} from "../engine/compression.js";
import type {
  CompressionReport,
  DeliveryActuals,
  EffortForecast,
} from "../engine/types.js";
import { getTestDb } from "./index.js";
import {
  finishRun,
  getFeatureRunTelemetry,
  listRuns,
  recordRun,
  startRun,
} from "./runs.js";

describe("038-telemetry-cost-ledger", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("applies migration 012_run_telemetry.sql with telemetry columns on runs", () => {
    const columns = db
      .prepare("PRAGMA table_info('runs')")
      .all()
      .map((col) => (col as { name: string }).name);

    expect(columns).toContain("device_id");
    expect(columns).toContain("hostname");
    expect(columns).toContain("tokens_in");
    expect(columns).toContain("tokens_out");
    expect(columns).toContain("cost_usd");
  });

  it("persists device identity, token counts, and USD cost via startRun and finishRun", () => {
    const runId = startRun(
      {
        feature_id: "038-telemetry-cost-ledger",
        phase_id: "phase-01",
        project_id: "gwrk",
        command: "ship",
        agent_backend: "claude",
        model: "claude-sonnet-4-20250514",
        device_id: "dev-spoke-01",
        hostname: "work-macbook.local",
      },
      db,
    );

    finishRun(
      runId,
      {
        exit_code: 0,
        duration_s: 120,
        status: "shipped",
        tokens_in: 14500,
        tokens_out: 3500,
        cost_usd: 0.096,
      },
      db,
    );

    const runs = listRuns("038-telemetry-cost-ledger", "gwrk", db);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.device_id).toBe("dev-spoke-01");
    expect(runs[0]?.hostname).toBe("work-macbook.local");
    expect(runs[0]?.tokens_in).toBe(14500);
    expect(runs[0]?.tokens_out).toBe(3500);
    expect(runs[0]?.cost_usd).toBeCloseTo(0.096, 5);
  });

  it("hydrates telemetry fields on recordRun backfill and aggregates via getFeatureRunTelemetry", () => {
    recordRun(
      {
        feature_id: "038-telemetry-cost-ledger",
        phase_id: "phase-01",
        project_id: "gwrk",
        command: "ship",
        agent_backend: "agy",
        model: "gemini-2.5-pro",
        status: "merged",
        exit_code: 0,
        duration_s: 95,
        device_id: "spoke-laptop-a",
        hostname: "spoke-a.local",
        tokens_in: 10000,
        tokens_out: 2000,
        cost_usd: 0.05,
      },
      db,
    );

    recordRun(
      {
        feature_id: "038-telemetry-cost-ledger",
        phase_id: "phase-01",
        project_id: "gwrk",
        command: "ship",
        agent_backend: "claude",
        model: "claude-sonnet-4-20250514",
        status: "merged",
        exit_code: 0,
        duration_s: 85,
        device_id: "hub-macbook",
        hostname: "hub.local",
        tokens_in: 20000,
        tokens_out: 4000,
        cost_usd: 0.1,
      },
      db,
    );

    const agg = getFeatureRunTelemetry(
      "038-telemetry-cost-ledger",
      "gwrk",
      "phase-01",
      db,
    );
    expect(agg.tokensIn).toBe(30000);
    expect(agg.tokensOut).toBe(6000);
    expect(agg.totalTokens).toBe(36000);
    expect(agg.costUsd).toBeCloseTo(0.15, 5);
    expect(agg.devices).toEqual(["hub-macbook", "spoke-laptop-a"]);
  });

  it("computes per-SP token and cost metrics in CompressionReport and CompressionSummary", () => {
    const forecast: EffortForecast = {
      totalSP: 3,
      roles: [{ role: "PE", sp: 3 }],
      estimatedHours: 5.625,
      estimatedDays: 0.703125,
    };
    const actuals: DeliveryActuals = {
      specCreatedAt: "2026-11-05T18:00:00.000Z",
      firstImplCommit: "2026-11-05T18:10:00.000Z",
      lastImplCommit: "2026-11-05T18:40:00.000Z",
      prMergedAt: "2026-11-05T18:45:00.000Z",
      dormancyDays: 0,
      activeCodingMinutes: 30,
      sessionCount: 1,
      deliveryWindowHours: 0.58,
    };

    const telemetry = computeTelemetryMetrics(forecast, {
      tokensIn: 30000,
      tokensOut: 6000,
      totalTokens: 36000,
      costUsd: 0.15,
      devices: ["spoke-laptop-a"],
    });

    expect(telemetry.tokensPerSp).toBe(12000);
    expect(telemetry.costPerSp).toBeCloseTo(0.05, 5);

    const report: CompressionReport = {
      featureId: "038-telemetry-cost-ledger",
      phaseId: "phase-01",
      generatedAt: "2026-11-05T19:00:00.000Z",
      forecast,
      actuals,
      compression: computeCompression(forecast, actuals),
      telemetry,
    };

    const summary = generateSummary([report]);
    expect(summary.totals.totalTokensIn).toBe(30000);
    expect(summary.totals.totalTokensOut).toBe(6000);
    expect(summary.totals.totalCostUsd).toBeCloseTo(0.15, 5);
    expect(summary.totals.avgTokensPerSP).toBe(12000);
    expect(summary.totals.avgCostPerSP).toBeCloseTo(0.05, 5);
  });
});
