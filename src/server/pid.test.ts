/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPid } from "./pid.js";

vi.mock("node:child_process");
vi.mock("node:fs");

describe("FR-015: PID Authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GWRK_RUNTIME_DIR", undefined);
    vi.spyOn(os, "platform").mockReturnValue("darwin");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("prioritizes launchctl over PID file", () => {
    // Mock launchctl returning a PID
    vi.mocked(execSync).mockReturnValue(Buffer.from("99999\n"));

    // Mock PID file existing with different PID
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("12345");

    const pid = readPid();

    expect(pid).toBe(99999);
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("launchctl list com.gwrk.server"),
      expect.any(Object),
    );
  });

  it("reads Linux PID state without consulting launchctl", () => {
    vi.mocked(os.platform).mockReturnValue("linux");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("12345");
    expect(readPid()).toBe(12345);
    expect(execSync).not.toHaveBeenCalled();
  });

  it("falls back to PID file if launchctl fails", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("Not found");
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("12345");

    const pid = readPid();
    expect(pid).toBe(12345);
  });

  it("returns undefined if both fail", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("Not found");
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const pid = readPid();
    expect(pid).toBeUndefined();
  });
});
