import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { persistDispatch } from "./persistence.js";
import type { DispatchRecord } from "./types.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// FR-008: JSONL persistence
describe("FR-008: Dispatch Persistence", () => {
  const tmpDir = path.join(os.tmpdir(), `gwrk-persist-test-${Date.now()}`);
  const jsonlPath = path.join(tmpDir, ".gwrk", "dispatches.jsonl");

  beforeEach(() => {
    fs.mkdirSync(path.join(tmpDir, ".gwrk"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeRecord = (id: string): DispatchRecord => ({
    id,
    featureId: "001-cli-core",
    phaseId: "phase-01",
    backend: "gemini",
    status: "queued",
    branchName: "phase/001-cli-core-phase-01",
    attempts: [],
    createdAt: new Date().toISOString(),
  });

  it("US-005 #1: appends a JSON line to dispatches.jsonl", () => {
    const record = makeRecord("test-id-1");
    persistDispatch(record, jsonlPath);

    const lines = fs.readFileSync(jsonlPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe("test-id-1");
  });

  it("US-005 #2: appends multiple records (not overwrites)", () => {
    persistDispatch(makeRecord("id-1"), jsonlPath);
    persistDispatch(makeRecord("id-2"), jsonlPath);

    const lines = fs.readFileSync(jsonlPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("US-005 #3: creates file if it doesn't exist", () => {
    const newPath = path.join(tmpDir, ".gwrk", "new-dispatches.jsonl");
    persistDispatch(makeRecord("id-new"), newPath);
    expect(fs.existsSync(newPath)).toBe(true);
  });

  it("US-005 #4: each line is valid JSON", () => {
    persistDispatch(makeRecord("id-1"), jsonlPath);
    persistDispatch(makeRecord("id-2"), jsonlPath);

    const lines = fs.readFileSync(jsonlPath, "utf-8").trim().split("\n");
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
