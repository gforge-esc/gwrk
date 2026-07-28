/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import * as gateRunner from "./gate-runner.js";
import { runTaskGate } from "./gate-exec.js";

// runGate is the file-exec adapter; mock it so file-based strategies don't hit
// the disk. Inline strategy runs real bash (like gate.test.ts) — do NOT mock
// child_process.
vi.mock("./gate-runner.js");

describe("runTaskGate — the shared gate execution port", () => {
  const featureDir = "/mock/specs/026-gate-runner-convergence";
  const cwd = "/mock/sandbox";

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no gate files on disk → inline strategy is reached.
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
  });

  it("Strategy 1: runs the convention gate file gates/<id>-gate.sh, cwd-pinned", async () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p: any) =>
      String(p).endsWith("gates/T001-gate.sh"),
    );
    vi.mocked(gateRunner.runGate).mockResolvedValue({
      passed: true,
      exitCode: 0,
      output: "ok",
    });

    const r = await runTaskGate(
      { id: "T001", gateScript: "grep -q x file" },
      { featureDir, cwd },
    );

    expect(r.strategy).toBe("convention");
    expect(r.passed).toBe(true);
    expect(gateRunner.runGate).toHaveBeenCalledWith(
      `${featureDir}/gates/T001-gate.sh`,
      { cwd },
    );
  });

  it("Strategy 2: runs gateScript as a file path, cwd-pinned", async () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p: any) =>
      String(p).endsWith("run-all-gates.sh"),
    );
    vi.mocked(gateRunner.runGate).mockResolvedValue({
      passed: false,
      exitCode: 1,
      output: "boom",
    });

    const r = await runTaskGate(
      { id: "T002", gateScript: "run-all-gates.sh" },
      { featureDir, cwd },
    );

    expect(r.strategy).toBe("file");
    expect(r.passed).toBe(false);
    expect(gateRunner.runGate).toHaveBeenCalledWith(
      `${featureDir}/run-all-gates.sh`,
      { cwd },
    );
  });

  it("Strategy 3: runs an inline gate under set -e and PASSes when every command passes", async () => {
    const r = await runTaskGate(
      { id: "T003", gateScript: "echo one\ntrue\necho two" },
      { featureDir, cwd: process.cwd() },
    );
    expect(r.strategy).toBe("inline");
    expect(r.passed).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it("Strategy 3: FAILs when an earlier command fails even if the last passes (set -e)", async () => {
    const r = await runTaskGate(
      { id: "T004", gateScript: "false\ntrue" },
      { featureDir, cwd: process.cwd() },
    );
    expect(r.strategy).toBe("inline");
    expect(r.passed).toBe(false);
    expect(r.exitCode).not.toBe(0);
  });

  it("Strategy 3: does NOT false-fail a passing `cmd | grep -q` (no pipefail)", async () => {
    const r = await runTaskGate(
      {
        id: "T005",
        gateScript:
          "{ echo db/definitions; echo more; } | grep -q db/definitions",
      },
      { featureDir, cwd: process.cwd() },
    );
    expect(r.passed).toBe(true);
  });

  it("rejects a hollow inline gate (echo / test -f only) as a build failure", async () => {
    const r = await runTaskGate(
      { id: "T006", gateScript: 'echo "Phase 1: config"' },
      { featureDir, cwd: process.cwd() },
    );
    expect(r.strategy).toBe("hollow");
    expect(r.passed).toBe(false);
  });

  it("rejects the unauthored placeholder gate", async () => {
    const r = await runTaskGate(
      {
        id: "T007",
        gateScript:
          'echo "FAIL: no test maps to src/x.js — author one (FR-001, ADR-005 §10)"; exit 1',
      },
      { featureDir, cwd: process.cwd() },
    );
    expect(r.strategy).toBe("unauthored");
    expect(r.passed).toBe(false);
  });

  it("returns a missing verdict when there is no gate at all", async () => {
    const r = await runTaskGate(
      { id: "T008", gateScript: "" },
      { featureDir, cwd },
    );
    expect(r.passed).toBe(false);
    expect(r.strategy).toBe("missing");
  });
});
