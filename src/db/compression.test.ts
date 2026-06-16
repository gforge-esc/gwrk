/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { CompressionReport } from "../engine/types.js";
import {
  getCompressionRecord,
  listCompressionRecords,
  recordCompression,
} from "./compression.js";
import { getTestDb } from "./index.js";

describe("FR-H06: Compression recording", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
  });

  it("US-H04: recordCompression correctly inserts record", async () => {
    const report: CompressionReport = {
      featureId: "011-harvest",
      phaseId: "phase-1",
      generatedAt: new Date().toISOString(),
      forecast: {
        totalSP: 10,
        roles: [],
        estimatedHours: 100,
        estimatedDays: 12.5,
      },
      actuals: {
        specCreatedAt: "2026-03-01T08:00:00Z",
        firstImplCommit: "2026-03-01T10:00:00Z",
        lastImplCommit: "2026-03-02T09:00:00Z",
        prMergedAt: "2026-03-02T10:00:00Z",
        dormancyDays: 5,
        activeCodingMinutes: 120,
        sessionCount: 2,
        deliveryWindowHours: 24,
      },
      compression: {
        pointCompression: 50,
        totalCompression: 12.5,
        dormancyDays: 5,
      },
    };

    const id = recordCompression(report, "test-project", db);
    expect(id).toBeDefined();
    expect(typeof id).toBe("number");

    const record = getCompressionRecord(
      "011-harvest",
      "phase-1",
      "test-project",
      db,
    );
    expect(record).toBeDefined();
    expect(record?.estimated_hours).toBe(100);
    expect(record?.actual_coding_hours).toBe(2); // 120 minutes / 60
  });

  it("should fail if report is missing mandatory fields", () => {
    // @ts-ignore
    const report: Partial<CompressionReport> = {
      featureId: "011-harvest",
    };

    expect(() => {
      // @ts-ignore
      recordCompression(report, "test-project", db);
    }).toThrow();
  });

  it("should list compression records for a feature", () => {
    const report: CompressionReport = {
      featureId: "list-feat",
      phaseId: "p1",
      generatedAt: new Date().toISOString(),
      forecast: { totalSP: 1, roles: [], estimatedHours: 10, estimatedDays: 1 },
      actuals: {
        specCreatedAt: "2026-03-01T08:00:00Z",
        firstImplCommit: "2026-03-01T10:00:00Z",
        lastImplCommit: "2026-03-02T09:00:00Z",
        prMergedAt: "2026-03-02T10:00:00Z",
        dormancyDays: 0,
        activeCodingMinutes: 60,
        sessionCount: 1,
        deliveryWindowHours: 24,
      },
      compression: {
        pointCompression: 10,
        totalCompression: 1,
        dormancyDays: 0,
      },
    };

    recordCompression(report, "test-project", db);

    const records = listCompressionRecords("list-feat", "test-project", db);
    expect(Array.isArray(records)).toBe(true);
    expect(records.length).toBe(1);
    expect(records[0].feature_id).toBe("list-feat");
  });
});
