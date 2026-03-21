import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { finalizeLogs } from "./harvest.js";
import * as gitUtils from "../utils/git.js";

vi.mock("../utils/git.js", async () => {
  const actual = await vi.importActual("../utils/git.js");
  return {
    ...actual as any,
    commitFiles: vi.fn(),
  };
});

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
      expect.stringContaining(featureId)
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
    fs.writeFileSync(path.join(runsDir, "index.json"), JSON.stringify(existingIndex));
    fs.writeFileSync(path.join(runsDir, "old.log"), "old content");

    const newLogFile = "20260321T120000Z-newrun-p2-claude.log";
    fs.writeFileSync(path.join(runsDir, newLogFile), "new content");

    await finalizeLogs(featureId, tempDir);

    const index = JSON.parse(fs.readFileSync(path.join(runsDir, "index.json"), "utf-8"));
    expect(index.logs.length).toBe(2);
    expect(index.logs.some((l: any) => l.runId === "old-run")).toBe(true);
    expect(index.logs.some((l: any) => l.runId === "newrun")).toBe(true);
  });
});

// Placeholder for future phases
describe("FR-H04: Compression Engine", () => {
  it.todo("US-H04: harvestFeature calculates Point and Total compression correctly");
});

describe("FR-H07: Done-Done Slack Notification", () => {
  it.todo("US-H05: notifyDoneDone posts to Slack correctly");
});

describe("FR-H08: Remote Branch Cleanup", () => {
  it.todo("US-H06: cleanupBranch deletes branch and handles failure gracefully");
});
