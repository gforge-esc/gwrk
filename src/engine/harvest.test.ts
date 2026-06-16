/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  finalizeLogs,
  harvestFeature,
  notifyDoneDone,
  cleanupBranch,
} from "./harvest.js";
import * as gitUtils from "../utils/git.js";
import * as runsDb from "../db/runs.js";
import * as compressionDb from "../db/compression.js";
import * as slackNotify from "../server/slack-notify.js";
import * as parserUtils from "../utils/parser.js";
import * as compressionEngine from "./compression.js";
import * as configUtils from "../utils/config.js";

vi.mock("../utils/git.js", async () => {
  const actual = await vi.importActual("../utils/git.js");
  return {
    ...(actual as any),
    commitFiles: vi.fn(),
    deleteRemoteBranch: vi.fn(),
  };
});

vi.mock("../db/runs.js", () => ({
  listRuns: vi.fn(() => []),
  finishRun: vi.fn(),
  recordRun: vi.fn(() => 999),
}));

vi.mock("../db/compression.js", () => ({
  recordCompression: vi.fn(),
  getCompressionRecord: vi.fn(() => undefined),
}));

vi.mock("../server/slack-notify.js", () => ({
  notifySlack: vi.fn(),
}));

vi.mock("../utils/parser.js", () => ({
  parsePlan: vi.fn(),
}));

vi.mock("./compression.js", () => ({
  computeCompression: vi.fn(),
  gatherDeliveryActuals: vi.fn(),
}));

vi.mock("../utils/config.js", () => ({
  loadConfig: vi.fn(),
}));

describe("FR-H02: Log Management & Finalization", () => {
  let tempDir: string;
  const featureId = "test-feature";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-harvest-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("US-H02: finalizeLogs indexes logs and updates index.json", async () => {
    const runsDir = path.join(tempDir, "specs", featureId, ".gwrk", "runs");
    fs.mkdirSync(runsDir, { recursive: true });

    const logFile = "20260321T120000Z-run123-p1-gemini.log";
    const logPath = path.join(runsDir, logFile);
    fs.writeFileSync(logPath, "sample log content");

    await finalizeLogs(featureId, tempDir);

    const indexPath = path.join(runsDir, "index.json");
    expect(fs.existsSync(indexPath)).toBe(true);

    const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    expect(index.featureId).toBe(featureId);
    expect(index.logs.length).toBe(1);
    expect(index.logs[0].runId).toBe("run123");
    expect(index.logs[0].phase).toBe("p1");
    expect(index.logs[0].agent).toBe("gemini");
    expect(index.logs[0].file).toBe(logFile);

    expect(gitUtils.commitFiles).toHaveBeenCalledWith(
      tempDir,
      [
        path.join("specs", featureId, ".gwrk", "runs", logFile),
        path.join("specs", featureId, ".gwrk", "runs", "index.json"),
      ],
      expect.stringContaining(featureId),
      { skipHooks: true },
    );
  });

  it("should handle missing runs directory gracefully", async () => {
    await expect(finalizeLogs("non-existent", tempDir)).resolves.not.toThrow();
    expect(gitUtils.commitFiles).not.toHaveBeenCalled();
  });
});

describe("FR-H10: Idempotency & FR-H09: Phase Completion", () => {
  const featureId = "test-feature";
  const phaseId = "phase-1";

  it("FR-H10: harvestFeature skips if already harvested (TC-H02, SC-H04)", async () => {
    const record = {
      featureId,
      phaseId,
      prNumber: 1,
      status: "merged" as const,
    };

    vi.mocked(compressionDb.getCompressionRecord).mockReturnValueOnce({ feature_id: featureId } as any);

    const report = await harvestFeature("/tmp", record as any);
    expect(report).toBeUndefined();
    expect(runsDb.finishRun).not.toHaveBeenCalled();
  });

  it("FR-H09: harvestFeature MUST verify all N sub-task PRs are merged before finalizing phase", async () => {
    const record = {
      featureId,
      phaseId,
      prNumber: 42,
      status: "merged" as const,
    };

    // Mock 2 runs for the phase: one being merged now, one still pending
    vi.mocked(runsDb.listRuns).mockReturnValue([
      { id: 100, phase_id: phaseId, pr_number: 42, status: "pending" },
      { id: 101, phase_id: phaseId, pr_number: 43, status: "pending" }, // STILL PENDING
    ]);

    const report = await harvestFeature("/tmp", record as any);

    // SHOULD finalize the specific run record
    expect(runsDb.finishRun).toHaveBeenCalledWith(100, expect.objectContaining({ status: "merged" }));
    
    // BUT SHOULD NOT finalize phase (skip compression and slack) because run 101 is pending
    expect(report).toBeUndefined();
    expect(slackNotify.notifySlack).not.toHaveBeenCalled();
  });
});

describe("FR-H04, FR-H05: Compression Engine", () => {
  let tempDir: string;
  const featureId = "test-feature";
  const phaseId = "phase-1";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-harvest-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("US-H04: harvestFeature calculates Point and Total compression correctly (TR-H06, TR-H07)", async () => {
    const record = {
      featureId,
      phaseId,
      prNumber: 1,
      status: "merged" as const,
    };

    // Create plan.md so fs.existsSync passes
    const featureDir = path.join(tempDir, "specs", featureId);
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, "plan.md"), "# Plan");

    vi.mocked(configUtils.loadConfig).mockReturnValue({} as any);
    vi.mocked(runsDb.listRuns).mockReturnValue([{ id: 100, phase_id: phaseId, status: "pending" }]);
    vi.mocked(parserUtils.parsePlan).mockReturnValue({
      phases: [{ id: phaseId, sp: 5 }]
    } as any);
    vi.mocked(compressionEngine.gatherDeliveryActuals).mockReturnValue({} as any);
    vi.mocked(compressionEngine.computeCompression).mockReturnValue({
      pointCompression: 2.5,
      totalCompression: 2.0,
      dormancyDays: 0.1,
    } as any);

    const report = await harvestFeature(tempDir, record as any);
    expect(report?.compression.pointCompression).toBe(2.5);
    expect(compressionDb.recordCompression).toHaveBeenCalled();
  });
});

describe("FR-H07, FR-H11: Slack Notifications", () => {
  it("US-H05: notifyDoneDone posts to Slack correctly (TR-H08)", async () => {
    const report = { 
      featureId: "feat-1", 
      actuals: {
        activeCodingMinutes: 60,
        deliveryWindowHours: 24,
      },
      compression: { 
        pointCompression: 2,
        totalCompression: 1.5
      } 
    };
    await notifyDoneDone(report as any);
    expect(slackNotify.notifySlack).toHaveBeenCalled();
  });
});

describe("FR-H08: Branch Cleanup", () => {
  it("US-H06: cleanupBranch deletes branch (TR-H05)", async () => {
    await cleanupBranch("feat/test", "/tmp");
    expect(gitUtils.deleteRemoteBranch).toHaveBeenCalledWith("/tmp", "feat/test");
  });
});

describe("FR-H03 & Phase-less Harvest: Backfill & Reconciliation", () => {
  let tempDir: string;
  const featureId = "test-feature-backfill";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-harvest-backfill-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("FR-H03: should backfill a run record if no matching pending run is found", async () => {
    const record = {
      featureId,
      phaseId: "phase-01",
      prNumber: 99,
      prUrl: "https://github.com/foo/bar/pull/99",
      mergeCommitSha: "abcdef",
      mergedAt: new Date().toISOString(),
      status: "merged" as const,
    };

    vi.mocked(runsDb.listRuns).mockReturnValue([]);

    await harvestFeature(tempDir, record as any);

    expect(runsDb.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      feature_id: featureId,
      phase_id: "phase-01",
      status: "merged",
      merge_commit_sha: "abcdef",
      pr_number: 99,
    }));
  });

  it("should process all phases sequentially when no phaseId is provided", async () => {
    const record = {
      featureId,
      phaseId: undefined, // Phase-less
      prNumber: 100,
      status: "merged" as const,
    };

    const featureDir = path.join(tempDir, "specs", featureId);
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, "plan.md"), "# Plan");

    vi.mocked(parserUtils.parsePlan).mockReturnValue({
      phases: [{ id: "phase-01", sp: 2 }, { id: "phase-02", sp: 3 }]
    } as any);

    await harvestFeature(tempDir, record as any);

    // Should call listRuns for each phase to find runs
    expect(runsDb.listRuns).toHaveBeenCalledTimes(2);
  });
});
