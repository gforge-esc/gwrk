import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendHistory } from "./history.js";
import { recordHistory } from "../db/runs.js";

vi.mock("../db/runs.js", () => ({
  recordHistory: vi.fn()
}));

describe("History Utility (Phase 9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => {});
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("FR-021: appendHistory SHOULD ONLY write to SQLite and NOT to legacy history.jsonl (RED)", () => {
    const entry = {
      timestamp: new Date().toISOString(),
      featureId: "test-feature",
      taskId: "T001",
      fromStatus: "open" as const,
      toStatus: "completed" as const,
    };

    appendHistory(entry);

    // 1. Verify SQLite recordHistory was called
    expect(recordHistory).toHaveBeenCalled();

    // 2. Verify legacy history.jsonl was NOT appended to
    // In RED state, this fails because current implementation still calls appendFileSync for history.jsonl
    expect(fs.appendFileSync).not.toHaveBeenCalledWith(
      expect.stringContaining("history.jsonl"),
      expect.any(String),
      expect.any(String)
    );
  });
});
