import { describe, expect, it, vi } from "vitest";
import { finalizeLogs, harvestFeature } from "./harvest.js";
import { getDb } from "../db/index.js";

describe("FR-H02: Log Management & Finalization", () => {
  it("US-H02: finalizeLogs moves logs and updates index.json", async () => {
    // This is a red test: finalizeLogs doesn't exist yet
    await expect(finalizeLogs("011-harvest", "p1")).resolves.not.toThrow();
  });
});

describe("FR-H04: Compression Engine - Point Compression", () => {
  it("US-H04: harvestFeature calculates Point and Total compression correctly", async () => {
    const payload = {
      featureId: "011-harvest",
      phaseId: "p1",
      prNumber: 42,
      mergeCommitSha: "abc1234567890",
      mergedAt: new Date().toISOString()
    };
    
    // harvestFeature doesn't exist yet
    const result = await harvestFeature(payload);
    expect(result.pointCompression).toBeGreaterThan(0);
    expect(result.totalCompression).toBeGreaterThan(0);
  });
});
