/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import { getTestCommand } from "../utils/toolchain-mapper.js";
import { detectProfile } from "./profile-detector.js";

export interface TestRunResult {
  testsRun: number;
  passed: number;
  failed: number;
  /** testsRun > 0 — proves at least one assertion actually executed (liveness). */
  ran: boolean;
  exitCode: number;
  command: string;
  output: string;
  /** True when the project declares no test toolchain (`toolchain.test === null`)
   * — the caller treats this as a skip, not a `testsRun == 0` failure. */
  skipped?: boolean;
}

/**
 * Parse a test runner's textual output into executed counts. Supports vitest,
 * jest, pytest, and `node --test` (TAP). The key property (ADR-005 §10.2.1):
 * a suite that discovered nothing, or whose tests were all *cancelled* (e.g. a
 * before-hook threw), yields `testsRun: 0` — it must NOT read as "passed".
 */
export function parseTestOutput(output: string): {
  testsRun: number;
  passed: number;
  failed: number;
} {
  // node --test TAP summary: "# pass 3" / "# fail 0" (cancelled are NOT run)
  const nodePass = output.match(/^#\s*pass\s+(\d+)/m);
  const nodeFail = output.match(/^#\s*fail\s+(\d+)/m);
  if (nodePass || nodeFail) {
    const passed = nodePass ? Number.parseInt(nodePass[1], 10) : 0;
    const failed = nodeFail ? Number.parseInt(nodeFail[1], 10) : 0;
    return { testsRun: passed + failed, passed, failed };
  }

  // vitest/jest print a "Tests" summary line distinct from "Test Files".
  // Prefer it so we count tests, not files. pytest has no such line, so we
  // fall back to scanning the whole output.
  const testsLine = output
    .split("\n")
    .find((l) => /^\s*Tests[:\s]/.test(l) && !/Test\s+Files/.test(l));
  const scope = testsLine ?? output;

  const failedM = scope.match(/(\d+)\s+failed/);
  const passedM = scope.match(/(\d+)\s+passed/);
  const failed = failedM ? Number.parseInt(failedM[1], 10) : 0;
  const passed = passedM ? Number.parseInt(passedM[1], 10) : 0;
  return { testsRun: passed + failed, passed, failed };
}

/**
 * Run the profile's test command over `files` and return structured results.
 * Never throws on test failure — a non-zero exit is captured and parsed.
 */
export async function runTests(
  cwd: string,
  files: string[],
  grepPattern?: string,
): Promise<TestRunResult> {
  const profile = await detectProfile(cwd);
  const command = getTestCommand(profile, files, grepPattern);
  if (command === null) {
    // No test toolchain declared → nothing to run (skip; ADR-005 §11 / 004 FR-023).
    return {
      testsRun: 0,
      passed: 0,
      failed: 0,
      ran: false,
      exitCode: 0,
      command: "",
      output: "",
      skipped: true,
    };
  }

  let output: string;
  let exitCode = 0;
  try {
    output = execSync(command, { cwd, stdio: "pipe", timeout: 300_000 }).toString();
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    output = `${e.stdout?.toString() ?? ""}\n${e.stderr?.toString() ?? ""}`.trim();
    exitCode = e.status ?? 1;
  }

  const { testsRun, passed, failed } = parseTestOutput(output);
  return { testsRun, passed, failed, ran: testsRun > 0, exitCode, command, output };
}
