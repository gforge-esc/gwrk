import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
// Module does not exist yet (RED) — Phase 10: setup state implementation pending
import { loadSetupState, saveSetupState, type SetupState } from "./setup-state.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Setup State Utility (Phase 10)", () => {
  let tempDir: string;
  let homeDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-state-test-"));
    homeDir = path.join(tempDir, "home");
    fs.mkdirSync(homeDir, { recursive: true });
    vi.stubEnv("HOME", homeDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("US-021: SHOULD save and load setup state", () => {
    const state: SetupState = {
      completedAt: new Date().toISOString(),
      steps: {
        tcc: true,
        ssh: true,
        gh: true,
        verification: true,
      },
    };

    saveSetupState(state);
    const loaded = loadSetupState();
    expect(loaded).toEqual(state);
  });

  it("US-021: SHOULD return null if setup state is missing", () => {
    const loaded = loadSetupState();
    expect(loaded).toBeNull();
  });
});