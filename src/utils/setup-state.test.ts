import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { loadSetupState, saveSetupState } from "./setup-state.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("setup-state utility (Phase 10) (RED)", () => {
  const SETUP_FILE = path.join(os.homedir(), ".gwrk", "setup.json");

  beforeEach(() => {
    if (fs.existsSync(SETUP_FILE)) {
      fs.unlinkSync(SETUP_FILE);
    }
  });

  afterEach(() => {
    if (fs.existsSync(SETUP_FILE)) {
      fs.unlinkSync(SETUP_FILE);
    }
  });

  it("SHOULD save and load setup state (RED)", () => {
    const state = {
      completedAt: new Date().toISOString(),
      steps: { tcc: true, ssh: true, gh: true, verification: true }
    };
    
    // This will fail because saveSetupState throws "Not implemented"
    saveSetupState(state);
    
    const loaded = loadSetupState();
    expect(loaded).toEqual(state);
  });

  it("SHOULD return null if setup.json does not exist (RED)", () => {
    // This will fail because loadSetupState throws "Not implemented"
    const loaded = loadSetupState();
    expect(loaded).toBeNull();
  });
});
