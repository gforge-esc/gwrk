import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendHistory } from "./history.js";
// Module does not exist yet (RED) — Phase 9: history.jsonl deprecation pending
import { recordHistory } from "../db/runs.js";

vi.mock("../db/runs.js", () => ({
  recordHistory: vi.fn()
}));

describe("History Utility", () => {
  const tempDir = path.join(process.cwd(), "temp-test-history");

  beforeEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // FR-021: history.jsonl deprecation
  it("should NOT write to legacy history.jsonl and ONLY write to SQLite", () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const entry = {
        timestamp: new Date().toISOString(),
        featureId: "001-cli-core",
        taskId: "T001",
        fromStatus: "open" as const,
        toStatus: "completed" as const,
        agentId: "user"
      };

      appendHistory(entry);

      const historyPath = path.join(".gwrk", "history.jsonl");
      
      // RED test assertion: It should NO LONGER write to history.jsonl per FR-021
      expect(fs.existsSync(historyPath)).toBe(false);

      // It should still write to SQLite
      expect(recordHistory).toHaveBeenCalledWith(expect.objectContaining({
        feature_id: "001-cli-core",
        task_id: "T001",
        to_status: "completed"
      }));
    } finally {
      process.chdir(originalCwd);
    }
  });
});