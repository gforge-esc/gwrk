import { describe, expect, it } from "vitest";
import { getDb } from "./index.js";
import { recordCompression } from "./compression.js";
import type { CompressionRecord } from "./compression.js";

describe("FR-H06: Compression recording", () => {
  it("US-H04: recordCompression correctly inserts record", async () => {
    const db = getDb();
    
    const record: CompressionRecord = {
      featureId: "011-harvest",
      phaseId: "phase-1",
      estimatedHours: 100,
      actualCodingHours: 2,
      estimatedDays: 12.5,
      actualDeliveryDays: 1,
      pointCompression: 50,
      totalCompression: 12.5,
      dormancyDays: 5,
      firstImplCommit: "2026-03-01T10:00:00Z",
      mergeTimestamp: "2026-03-02T10:00:00Z",
      sessionCount: 2
    };

    // @ts-ignore - module doesn't exist yet
    const id = recordCompression(record, db);
    expect(id).toBeDefined();
  });
});
