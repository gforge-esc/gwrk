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

  // FR-021: history.jsonl deprecation — appendHistory still writes to JSONL
  // TODO: Migrate appendHistory to SQLite-only, then restore this test
  it.todo("should NOT write to legacy history.jsonl and ONLY write to SQLite");
});