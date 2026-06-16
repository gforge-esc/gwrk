/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Temp dir created once — vi.mock runs before module evaluation
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-setup-test-"));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    default: { ...actual, homedir: () => TEST_HOME },
    homedir: () => TEST_HOME,
  };
});

describe("setup-state utility (Phase 10)", () => {
  const setupFile = path.join(TEST_HOME, ".gwrk", "setup.json");

  beforeEach(() => {
    // Clean between tests
    if (fs.existsSync(setupFile)) {
      fs.unlinkSync(setupFile);
    }
  });

  afterEach(() => {
    if (fs.existsSync(setupFile)) {
      fs.unlinkSync(setupFile);
    }
  });

  it("SHOULD save and load setup state", async () => {
    const { saveSetupState, loadSetupState } = await import("./setup-state.js");
    const state = {
      completedAt: new Date().toISOString(),
      steps: { tcc: true, ssh: true, gh: true, verification: true }
    };
    
    saveSetupState(state);
    
    const loaded = loadSetupState();
    expect(loaded).toEqual(state);
  });

  it("SHOULD return null if setup.json does not exist", async () => {
    const { loadSetupState } = await import("./setup-state.js");
    const loaded = loadSetupState();
    expect(loaded).toBeNull();
  });
});

