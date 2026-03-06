import { describe, it, expect } from "vitest";
import { clusterCommits } from "./commit-cluster.js";
import type { CommitCluster } from "./types.js";

/**
 * RED tests for src/engine/commit-cluster.ts
 * Contract: contracts/compression-engine.md → clusterCommits()
 * FR-006: Detect active coding time via commit clustering (30-min gap)
 */

describe("FR-006: clusterCommits — gap-based commit clustering", () => {
  // TR-006: timestamps [0,5,10,120,125] → 2 sessions, 15 min active
  it("TR-006: clusters [0,5,10,120,125] min into 2 sessions with 15 min active", () => {
    const baseTime = new Date("2026-03-31T15:00:00Z").getTime();
    const timestamps = [0, 5, 10, 120, 125].map((m) =>
      new Date(baseTime + m * 60_000).toISOString()
    );

    const clusters = clusterCommits(timestamps, 30);

    expect(clusters).toHaveLength(2);

    // First session: 0→10 min = 10 min duration
    expect(clusters[0].commitCount).toBe(3);
    expect(clusters[0].durationMinutes).toBe(10);

    // Second session: 120→125 min = 5 min duration
    expect(clusters[1].commitCount).toBe(2);
    expect(clusters[1].durationMinutes).toBe(5);

    // Total active = 15 min, NOT 125 min
    const totalActive = clusters.reduce(
      (sum: number, c: CommitCluster) => sum + c.durationMinutes,
      0
    );
    expect(totalActive).toBe(15);
  });

  it("single commit produces 1 cluster with duration 0", () => {
    const timestamps = ["2026-03-31T15:00:00Z"];
    const clusters = clusterCommits(timestamps, 30);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].durationMinutes).toBe(0);
    expect(clusters[0].commitCount).toBe(1);
  });

  it("empty array produces empty result", () => {
    const clusters = clusterCommits([], 30);
    expect(clusters).toEqual([]);
  });

  it("all commits within gap produces 1 cluster", () => {
    const baseTime = new Date("2026-03-31T15:00:00Z").getTime();
    const timestamps = [0, 5, 10, 15, 20].map((m) =>
      new Date(baseTime + m * 60_000).toISOString()
    );

    const clusters = clusterCommits(timestamps, 30);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].commitCount).toBe(5);
    expect(clusters[0].durationMinutes).toBe(20);
  });

  it("respects custom gap threshold of 60 minutes", () => {
    const baseTime = new Date("2026-03-31T15:00:00Z").getTime();
    // With 30-min gap: 3 sessions. With 60-min gap: 2 sessions
    const timestamps = [0, 5, 40, 45, 120, 125].map((m) =>
      new Date(baseTime + m * 60_000).toISOString()
    );

    const clusters30 = clusterCommits(timestamps, 30);
    const clusters60 = clusterCommits(timestamps, 60);

    expect(clusters30.length).toBeGreaterThan(clusters60.length);
  });

  it("each cluster has valid startedAt and endedAt ISO dates", () => {
    const baseTime = new Date("2026-03-31T15:00:00Z").getTime();
    const timestamps = [0, 5, 10].map((m) =>
      new Date(baseTime + m * 60_000).toISOString()
    );

    const clusters = clusterCommits(timestamps, 30);
    expect(clusters[0].startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(clusters[0].endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
