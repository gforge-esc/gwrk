/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as gateRunner from "./gate-runner.js";
import { GATE_TIMEOUT_MS, runTaskGate, runInlineGate } from "./gate-exec.js";
import { parsePlanMarkdown } from "../engine/plan-to-tasks.js";

// runGate is the file-exec adapter; mock it so file-based strategies don't hit
// the disk. Inline strategy runs real bash (like gate.test.ts) — do NOT mock
// child_process.
vi.mock("./gate-runner.js", async () => {
  const actual = await vi.importActual<typeof import("./gate-runner.js")>("./gate-runner.js");
  return {
    ...actual,
    runGate: vi.fn(),
  };
});

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
      { cwd, timeoutMs: GATE_TIMEOUT_MS },
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
      { cwd, timeoutMs: GATE_TIMEOUT_MS },
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

// SEAM (026): a fenced `#### Done When` block compiles to task.gateScript, and
// the shared runner executes THAT — no injected doneWhen, no vacuous skip. This
// is the exact path the 025 field bug bypassed (tests mocked phase.doneWhen).
describe("SEAM: fenced Done-When → task.gateScript → runTaskGate", () => {
  beforeEach(() => vi.clearAllMocks());

  const PLAN = [
    "### Phase 1: Config readers",
    "",
    "**Files (1):**",
    "- `src/config/env.js` — **create** — reader",
    "",
    "#### Done When",
    "```bash",
    "true",
    'echo "config gate ran"',
    "```",
    "",
  ].join("\n");

  it("puts the fenced block on the phase gate (not phase.doneWhen)", () => {
    const phases = parsePlanMarkdown(PLAN);
    expect(phases).toHaveLength(1);
    // The executable gate is captured as gateScript; doneWhen stays prose-empty.
    expect(phases[0].gateScript).toContain('echo "config gate ran"');
    expect(phases[0].doneWhen).toEqual([]);
  });

  it("the shared runner executes that compiled gate (real bash)", async () => {
    const phases = parsePlanMarkdown(PLAN);
    const gateScript = phases[0].gateScript as string;
    // Simulate plan-to-tasks copying the fenced gate onto a task.
    const r = await runTaskGate(
      { id: "T001", gateScript },
      { featureDir: "/mock/specs/026", cwd: process.cwd() },
    );
    expect(r.strategy).toBe("inline");
    expect(r.passed).toBe(true);
    expect(r.output).toContain("config gate ran");
  });
});

// 027 — gate-invoked-test liveness. A gate that exits 0 but whose invoked test
// runner reports a recognized 0-test summary is a false green. Conservative:
// only fails on a recognized 0-count; opaque output and no-test gates pass.
describe("027 liveness: gate-invoked test command that runs 0 tests", () => {
  const CWD = process.cwd();

  it("FAILS when an invoked runner reports a recognized 0-test summary", () => {
    // Line 3 mentions `node --test` (an integration command); output is a node
    // TAP summary with zero tests.
    const r = runInlineGate(
      "echo '# pass 0'\necho '# fail 0'\necho 'node --test ran'",
      CWD,
    );
    expect(r.passed).toBe(false);
    expect(r.offendingLine).toMatch(/0 tests/);
  });

  it("PASSES when the invoked runner reports N>0 tests", () => {
    const r = runInlineGate(
      "echo '# pass 3'\necho '# fail 0'\necho 'node --test ran'",
      CWD,
    );
    expect(r.passed).toBe(true);
  });

  it("PASSES (no false-fail) when the invoked runner's output is opaque", () => {
    // `make test:db` is an integration command, but the output has no
    // recognizable test summary — an opaque wrapper must not be liveness-failed.
    const r = runInlineGate(
      "echo 'building'\necho 'make test:db invoked'",
      CWD,
    );
    expect(r.passed).toBe(true);
  });

  it("PASSES a gate with no test invocation regardless of output", () => {
    const r = runInlineGate("echo 'grep passed check'\ntrue", CWD);
    expect(r.passed).toBe(true);
  });
});

describe("child-process gate output capture behavioral regression", () => {
  const CWD = process.cwd();

  describe("runInlineGate", () => {
    it("captures stdout above 1MiB (1.2 MiB) with exit 0", () => {
      const result = runInlineGate(
        'node -e "process.stdout.write(\'x\'.repeat(1200000))"',
        CWD,
      );
      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output.length).toBe(1200000);
    });

    it("captures stderr above 1MiB (1.2 MiB) with exit 0", () => {
      const result = runInlineGate(
        'node -e "process.stderr.write(\'y\'.repeat(1200000))"',
        CWD,
      );
      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output.length).toBe(1200000);
    });

    it("classifies buffer overflow explicitly at start of output when finite cap is exceeded", () => {
      const result = runInlineGate(
        'node -e "process.stdout.write(\'x\'.repeat(100000))"',
        CWD,
        GATE_TIMEOUT_MS,
        undefined,
        undefined,
        50000,
      );
      expect(result.passed).toBe(false);
      expect(result.output).toMatch(
        /^Gate output exceeded maximum buffer limit \(50000 bytes\)/,
      );
    });

    it("preserves ordinary nonzero exit output without buffer overflow classification", () => {
      const result = runInlineGate(
        'echo "normal error message"; exit 2',
        CWD,
      );
      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(2);
      expect(result.output).toBe("normal error message");
      expect(result.output).not.toContain("Gate output exceeded maximum buffer limit");
    });
  });

  describe("runGate (actual child-process file execution)", () => {
    let tmpDir: string;
    let realRunGate: typeof import("./gate-runner.js").runGate;

    beforeEach(async () => {
      const gateRunnerMod = await vi.importActual<typeof import("./gate-runner.js")>("./gate-runner.js");
      realRunGate = gateRunnerMod.runGate;
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-gate-behavioral-"));
    });

    it("captures stdout above 1MiB (1.2 MiB) with exit 0 in real script", async () => {
      const scriptPath = path.join(tmpDir, "gate-stdout.sh");
      fs.writeFileSync(
        scriptPath,
        '#!/bin/bash\nnode -e "process.stdout.write(\'x\'.repeat(1200000))"\n',
        { mode: 0o755 },
      );

      const result = await realRunGate(scriptPath);
      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output.length).toBe(1200000);
    });

    it("captures stderr above 1MiB (1.2 MiB) with exit 0 in real script", async () => {
      const scriptPath = path.join(tmpDir, "gate-stderr.sh");
      fs.writeFileSync(
        scriptPath,
        '#!/bin/bash\nnode -e "process.stderr.write(\'y\'.repeat(1200000))"\n',
        { mode: 0o755 },
      );

      const result = await realRunGate(scriptPath);
      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output.length).toBe(1200000);
    });

    it("classifies buffer overflow explicitly at start of output when finite cap is exceeded", async () => {
      const scriptPath = path.join(tmpDir, "gate-overflow.sh");
      fs.writeFileSync(
        scriptPath,
        '#!/bin/bash\nnode -e "process.stdout.write(\'x\'.repeat(100000))"\n',
        { mode: 0o755 },
      );

      const result = await realRunGate(scriptPath, { maxBuffer: 50000 });
      expect(result.passed).toBe(false);
      expect(result.output).toMatch(
        /^Gate output exceeded maximum buffer limit \(50000 bytes\)/,
      );
    });

    it("preserves ordinary nonzero exit output without buffer overflow classification", async () => {
      const scriptPath = path.join(tmpDir, "gate-fail.sh");
      fs.writeFileSync(
        scriptPath,
        '#!/bin/bash\necho "ordinary failure"; exit 3\n',
        { mode: 0o755 },
      );

      const result = await realRunGate(scriptPath);
      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(3);
      expect(result.output).toBe("ordinary failure");
      expect(result.output).not.toContain("Gate output exceeded maximum buffer limit");
    });

    it("preserves existing timeout semantics", async () => {
      const scriptPath = path.join(tmpDir, "gate-timeout.sh");
      fs.writeFileSync(
        scriptPath,
        '#!/bin/bash\nsleep 5\n',
        { mode: 0o755 },
      );

      const result = await realRunGate(scriptPath, { timeoutMs: 100 });
      expect(result.passed).toBe(false);
      expect(result.output).toContain("Gate timed out after 100 ms");
      expect(result.output).not.toContain("Gate output exceeded maximum buffer limit");
    });
  });
});
