/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runGate } from "./gate-runner.js";
import { isHollowGate, isUnauthoredGate } from "./gate-quality.js";

/**
 * 026 — the ONE gate execution port. Every driver (`gwrk gate`, ship pre-flight /
 * TEST_GATE / CODE_REVIEW / post-flight, harvest reconciliation) verifies a task's
 * gate through this function, so the verdict is identical everywhere for the same
 * `task.gateScript` on the same checkout.
 *
 * A gate is resolved by three strategies, in order:
 *   1. convention file  `<featureDir>/gates/<task.id>-gate.sh`
 *   2. `gateScript` as a file path  `<featureDir>/<gateScript>`
 *   3. inline shell — the fenced `#### Done When` body (023 FR-001), run under
 *      `/bin/bash` with `set -e` so ANY failing command fails the gate. `pipefail`
 *      is deliberately omitted (a `producer | grep -q` assertion must not SIGPIPE-
 *      false-fail). Hollow (echo / `test -f` only) and unauthored placeholder gates
 *      are rejected as build failures BEFORE execution (FR-001), never run as a pass.
 */

export type GateStrategy =
  | "convention"
  | "file"
  | "inline"
  | "hollow"
  | "unauthored"
  | "missing";

export interface TaskGateResult {
  passed: boolean;
  exitCode: number;
  /** combined stdout + stderr (or the rejection reason for hollow/unauthored/missing) */
  output: string;
  strategy: GateStrategy;
  /** human label: "gates/<id>-gate.sh" | gateScript | "(inline) …60" | "(none)" */
  gatePath: string;
  /** first meaningful line of a failing inline gate — for NO-GO navigation */
  offendingLine?: string;
}

/** Default gate timeout. Generous enough for Docker-backed integration gates
 * (`make dev:up && make db:migrate && make test:db`) which the 30s legacy timeout
 * could trip. Override per call when needed. */
export const GATE_TIMEOUT_MS = 120_000;

export async function runTaskGate(
  task: { id: string; gateScript?: string },
  opts: { featureDir: string; cwd: string; timeoutMs?: number },
): Promise<TaskGateResult> {
  const { featureDir, cwd } = opts;

  // Strategy 1 — convention gate file.
  const conventionPath = path.join(featureDir, "gates", `${task.id}-gate.sh`);
  if (fs.existsSync(conventionPath)) {
    const r = await runGate(conventionPath, { cwd });
    return {
      passed: r.passed,
      exitCode: r.exitCode,
      output: r.output,
      strategy: "convention",
      gatePath: `gates/${task.id}-gate.sh`,
    };
  }

  const gateScript = (task.gateScript ?? "").trim();
  if (!gateScript) {
    return {
      passed: false,
      exitCode: 1,
      output: `No gate defined for ${task.id}`,
      strategy: "missing",
      gatePath: "(none)",
    };
  }

  // Strategy 2 — gateScript as a file path.
  const scriptPath = path.join(featureDir, gateScript);
  if (fs.existsSync(scriptPath)) {
    const r = await runGate(scriptPath, { cwd });
    return {
      passed: r.passed,
      exitCode: r.exitCode,
      output: r.output,
      strategy: "file",
      gatePath: gateScript,
    };
  }

  // Strategy 3 — inline shell. Reject non-verification gates first (FR-001).
  const label = `(inline) ${gateScript.substring(0, 60)}`;
  if (isUnauthoredGate(gateScript)) {
    return {
      passed: false,
      exitCode: 1,
      output:
        "unauthored placeholder gate — no test was authored for this deliverable (FR-001)",
      strategy: "unauthored",
      gatePath: label,
    };
  }
  if (isHollowGate(gateScript)) {
    return {
      passed: false,
      exitCode: 1,
      output:
        "hollow gate (echo / test -f only) — not a functional assertion (FR-001, ADR-005 §10.2.5)",
      strategy: "hollow",
      gatePath: label,
    };
  }
  return runInlineGate(gateScript, cwd, opts.timeoutMs ?? GATE_TIMEOUT_MS, label);
}

/**
 * Execute an inline gate script under `bash -e`. Shared by `runTaskGate` and by
 * ship's phase-gate path so there is one inline executor. Pass iff exit 0.
 */
export function runInlineGate(
  script: string,
  cwd: string,
  timeoutMs: number = GATE_TIMEOUT_MS,
  label?: string,
): TaskGateResult {
  const gatePath = label ?? `(inline) ${script.substring(0, 60)}`;
  try {
    const output = execSync(`set -e\n${script}`, {
      cwd,
      stdio: "pipe",
      timeout: timeoutMs,
      encoding: "utf-8",
      shell: "/bin/bash",
    });
    return {
      passed: true,
      exitCode: 0,
      output: String(output ?? ""),
      strategy: "inline",
      gatePath,
    };
  } catch (err: unknown) {
    const e = err as {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    const output = `${e.stdout?.toString() ?? ""}\n${e.stderr?.toString() ?? ""}`.trim();
    const exitCode = typeof e.status === "number" ? e.status : 1;
    return {
      passed: false,
      exitCode,
      output,
      strategy: "inline",
      gatePath,
      offendingLine: firstMeaningfulLine(script),
    };
  }
}

/** The first executable line of a gate (skipping blanks, comments, `set …`).
 * A cheap, side-effect-free stand-in for "the offending line" — good enough for
 * a NO-GO message, and it never re-runs the gate (important for Docker gates). */
function firstMeaningfulLine(script: string): string {
  const lines = script
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("set "));
  return lines[0] ?? script.trim();
}
