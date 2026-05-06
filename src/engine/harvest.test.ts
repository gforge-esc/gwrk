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
    );
  });

  it("should handle missing runs directory gracefully", async () => {
    await expect(finalizeLogs("non-existent", tempDir)).resolves.not.toThrow();
    expect(gitUtils.commitFiles).not.toHaveBeenCalled();
  });

  it("should append to existing index.json", async () => {
    const runsDir = path.join(tempDir, "specs", featureId, ".gwrk", "runs");
    fs.mkdirSync(runsDir, { recursive: true });

    const existingIndex = {
      featureId,
      logs: [
        {
          timestamp: "20260320T100000Z",
          runId: "old-run",
          file: "old.log",
          size: 100,
        },
      ],
    };
    fs.writeFileSync(
      path.join(runsDir, "index.json"),
      JSON.stringify(existingIndex),
    );
    fs.writeFileSync(path.join(runsDir, "old.log"), "old content");

    const newLogFile = "20260321T120000Z-newrun-p2-claude.log";
    fs.writeFileSync(path.join(runsDir, newLogFile), "new content");

    await finalizeLogs(featureId, tempDir);

    const index = JSON.parse(
      fs.readFileSync(path.join(runsDir, "index.json"), "utf-8"),
    );
    expect(index.logs.length).toBe(2);
    expect(index.logs.some((l: any) => l.runId === "old-run")).toBe(true);
    expect(index.logs.some((l: any) => l.runId === "newrun")).toBe(true);
  });
});

describe("FR-H04: Compression Engine", () => {
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

  it("US-H04: harvestFeature calculates Point and Total compression correctly", async () => {
    const record = {
      featureId,
      phaseId,
      prNumber: 1,
      prUrl: "http://github/pr/1",
      mergeCommitSha: "sha123",
      mergedAt: new Date().toISOString(),
      mergedBy: "user",
      status: "merged" as const,
      headBranch: "feat/test",
    };

    // Mock DB runs
    vi.mocked(runsDb.listRuns).mockReturnValue([
      { id: 100, phase_id: phaseId, pr_number: 1, status: "pending" },
    ]);

    // Mock Config
    vi.mocked(configUtils.loadConfig).mockReturnValue({
      project: { name: "test" },
      agents: { define: "gemini", implement: "claude" },
    } as any);

    // Mock Plan Parsing
    const featureDir = path.join(tempDir, "specs", featureId);
    fs.mkdirSync(featureDir, { recursive: true });
    const planPath = path.join(featureDir, "plan.md");
    fs.writeFileSync(planPath, "# Plan");

    vi.mocked(parserUtils.parsePlan).mockReturnValue({
      featureId,
      phases: [{ id: phaseId, sp: 5 }],
    } as any);

    // Mock Compression calculation
    const mockActuals = {
      specCreatedAt: "2026-03-21T10:00:00Z",
      firstImplCommit: "2026-03-21T11:00:00Z",
      lastImplCommit: "2026-03-21T13:00:00Z",
      prMergedAt: "2026-03-21T14:00:00Z",
      dormancyDays: 0.1,
      activeCodingMinutes: 120,
      sessionCount: 1,
      deliveryWindowHours: 4,
    };
    vi.mocked(compressionEngine.gatherDeliveryActuals).mockReturnValue(
      mockActuals,
    );
    vi.mocked(compressionEngine.computeCompression).mockReturnValue({
      pointCompression: 2.5,
      totalCompression: 2.0,
      dormancyDays: 0.1,
    });

    const report = await harvestFeature(tempDir, record);

    expect(report).toBeDefined();
    expect(report?.compression.pointCompression).toBe(2.5);
    expect(compressionDb.recordCompression).toHaveBeenCalled();
    expect(runsDb.finishRun).toHaveBeenCalledWith(
      100,
      expect.objectContaining({
        status: "merged",
        merge_commit_sha: "sha123",
      }),
    );
  });

  it("US-H06: harvestFeature skips if already harvested (idempotency)", async () => {
    const record = {
      featureId,
      phaseId,
      prNumber: 1,
      prUrl: "http://github/pr/1",
      mergeCommitSha: "sha123",
      mergedAt: new Date().toISOString(),
      mergedBy: "user",
      status: "merged" as const,
    };

    vi.mocked(compressionDb.getCompressionRecord).mockReturnValue({
      feature_id: featureId,
      phase_id: phaseId,
      estimated_hours: 1,
      actual_coding_hours: 0.5,
      estimated_days: 1,
      actual_delivery_days: 0.5,
      point_compression: 2,
      total_compression: 2,
      merge_timestamp: new Date().toISOString(),
    });

    const report = await harvestFeature(tempDir, record);

    expect(report).toBeUndefined();
    expect(compressionDb.recordCompression).not.toHaveBeenCalled();
  });
});

describe("FR-H07: Done-Done Slack Notification", () => {
  it("US-H05: notifyDoneDone posts to Slack correctly", async () => {
    const report = {
      featureId: "feat-1",
      phaseId: "phase-1",
      generatedAt: new Date().toISOString(),
      forecast: { totalSP: 5, roles: [], estimatedHours: 7.5, estimatedDays: 1 },
      actuals: {} as any,
      compression: {
        pointCompression: 2,
        totalCompression: 1.5,
        dormancyDays: 0,
      },
    };

    await notifyDoneDone(report);

    expect(slackNotify.notifySlack).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("feat-1") }),
      undefined,
      { opsOnly: true },
    );
  });
});

describe("FR-H08: Remote Branch Cleanup", () => {
  it("US-H06: cleanupBranch deletes branch", async () => {
    await cleanupBranch("feat/test", "/tmp");
    expect(gitUtils.deleteRemoteBranch).toHaveBeenCalledWith(
      "/tmp",
      "feat/test",
    );
  });
});
