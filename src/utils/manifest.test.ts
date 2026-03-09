import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ExecutionManifest,
  generateRunId,
  loadManifests,
  writeManifest,
} from "./manifest.js";

describe("Execution Manifest Utility", () => {
  const tempDir = path.join(process.cwd(), "temp-test-manifest");

  beforeEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const mockManifest: ExecutionManifest = {
    runId: "2026-03-08T14:02:33Z_ship_p01",
    feature: "test-feature",
    phase: "phase-01",
    command: "ship",
    agent: "gemini",
    model: "gemini-2.0-flash",
    startedAt: "2026-03-08T14:02:33.000Z",
    finishedAt: "2026-03-08T14:18:02.000Z",
    durationS: 929,
    exitCode: 0,
    attempt: 1,
    gateResult: "PASS",
    reviewVerdict: "GO",
    filesChanged: 4,
    linesAdded: 127,
    linesDeleted: 33,
    gitCommit: "abc1234",
    gitBranch: "feat/test-feature-wip",
  };

  it("should generate a runId with shorthand phase", () => {
    const runId = generateRunId(
      "2026-03-08T14:02:33Z",
      "ship",
      "phase-01"
    );
    expect(runId).toBe("2026-03-08T14:02:33Z_ship_p01");
  });

  it("should write an execution manifest to .gwrk/runs/", () => {
    const filePath = writeManifest(tempDir, mockManifest);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath).toContain(".gwrk/runs/");
    expect(filePath).toContain("ship_phase-01_gemini.json");

    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.runId).toBe(mockManifest.runId);
    expect(content.feature).toBe(mockManifest.feature);
  });

  it("should load multiple manifests", () => {
    writeManifest(tempDir, mockManifest);
    const secondManifest = {
      ...mockManifest,
      runId: "2026-03-08T15:00:00Z_ship_p01",
      startedAt: "2026-03-08T15:00:00.000Z",
    };
    writeManifest(tempDir, secondManifest);

    const manifests = loadManifests(tempDir);
    expect(manifests).toHaveLength(2);
    expect(manifests.map((m) => m.runId)).toContain(mockManifest.runId);
    expect(manifests.map((m) => m.runId)).toContain(secondManifest.runId);
  });

  it("should throw on invalid manifest", () => {
    const invalidManifest = { ...mockManifest, exitCode: "zero" } as any;
    expect(() => writeManifest(tempDir, invalidManifest)).toThrow(
      "Invalid execution manifest"
    );
  });

  it("should handle missing runs directory in loadManifests", () => {
    const manifests = loadManifests(tempDir);
    expect(manifests).toEqual([]);
  });
});
