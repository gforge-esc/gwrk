/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { type ExecSyncOptions, execSync } from "node:child_process";
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
  executionError?: string;
}

function pytestSummary(output: string): string | undefined {
  return output
    .split("\n")
    .reverse()
    .find((line) =>
      /^\s*(?:=+\s*)?\d+\s+(?:passed|failed|skipped|deselected|xfailed|xpassed|errors?)(?:\s|,).*\bin\s+[\d.]+s(?:\s*=+)?\s*$/.test(
        line,
      ),
    );
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

  // go test -json NDJSON events: {"Action":"pass","Test":"TestFoo"} / {"Action":"fail","Test":"TestBar"}
  const jsonLines = output
    .split("\n")
    .filter(
      (l) =>
        l.trim().startsWith("{") &&
        l.includes('"Action"') &&
        l.includes('"Test"'),
    );
  if (jsonLines.length > 0) {
    let passed = 0;
    let failed = 0;
    for (const line of jsonLines) {
      try {
        const parsed = JSON.parse(line) as { Action?: string; Test?: string };
        if (parsed.Test && parsed.Action === "pass") passed++;
        else if (parsed.Test && parsed.Action === "fail") failed++;
      } catch {
        // Ignore non-JSON lines
      }
    }
    if (passed > 0 || failed > 0) {
      return { testsRun: passed + failed, passed, failed };
    }
  }

  // go test verbose output: "--- PASS: TestFoo" / "--- FAIL: TestBar" or package "ok  pkg 0.01s"
  const goPassMatches = output.match(/^\s*---\s*PASS:/gm);
  const goFailMatches = output.match(/^\s*---\s*FAIL:/gm);
  if (goPassMatches || goFailMatches) {
    const passed = goPassMatches ? goPassMatches.length : 0;
    const failed = goFailMatches ? goFailMatches.length : 0;
    return { testsRun: passed + failed, passed, failed };
  }
  const goPkgOk = output.match(/^ok\s+\S+\s+[\d.]+s/gm);
  const goPkgFail = output.match(/^FAIL\s+\S+\s+[\d.]+s/gm);
  if (goPkgOk || goPkgFail) {
    const passed = goPkgOk ? goPkgOk.length : 0;
    const failed = goPkgFail ? goPkgFail.length : 0;
    return { testsRun: passed + failed, passed, failed };
  }

  // cargo test multi-binary output: "test result: ok. N passed; M failed; ..."
  const cargoResultLines = output
    .split("\n")
    .filter((l) => /^\s*test result:\s+(?:ok|FAILED)\./i.test(l));
  if (cargoResultLines.length > 0) {
    let passed = 0;
    let failed = 0;
    for (const line of cargoResultLines) {
      const pMatch = line.match(/(\d+)\s+passed/);
      const fMatch = line.match(/(\d+)\s+failed/);
      if (pMatch) passed += Number.parseInt(pMatch[1], 10);
      if (fMatch) failed += Number.parseInt(fMatch[1], 10);
    }
    return { testsRun: passed + failed, passed, failed };
  }

  // vitest/jest print a "Tests" summary line distinct from "Test Files".
  // Pytest has a separate terminal summary. Fixture logs are not summaries.
  const testsLine = output
    .split("\n")
    .reverse()
    .find((l) => /^\s*Tests[:\s]/.test(l) && !/Test\s+Files/.test(l));
  const scope = testsLine ?? pytestSummary(output) ?? "";

  const failedM = scope.match(/(\d+)\s+failed/);
  const passedM = scope.match(/(\d+)\s+passed/);
  const failed = failedM ? Number.parseInt(failedM[1], 10) : 0;
  const passed = passedM ? Number.parseInt(passedM[1], 10) : 0;
  return { testsRun: passed + failed, passed, failed };
}

/**
 * 027 — whether `output` contains a RECOGNIZED test-runner summary (node TAP
 * `# pass`/`# fail`, a vitest/jest `Tests` line, or a pytest-style `N passed`/
 * `N failed`). Used to make gate liveness conservative: only when a summary is
 * recognized do we trust `parseTestOutput`'s counts enough to fail on
 * `testsRun === 0`. Opaque output (no recognizable summary) returns false, so an
 * opaque wrapper is never false-failed on liveness.
 */
export function hasRecognizedTestSummary(output: string): boolean {
  if (/^#\s*(pass|fail)\s+\d+/m.test(output)) return true; // node --test TAP
  if (
    output
      .split("\n")
      .some((l) => /^\s*Tests[:\s]/.test(l) && !/Test\s+Files/.test(l))
  )
    return true; // vitest / jest
  if (pytestSummary(output)) return true;
  if (/^\s*test result:\s+(?:ok|FAILED)\./im.test(output)) return true;
  if (/^\s*---\s*(PASS|FAIL):/m.test(output)) return true; // go test -v
  if (/^(?:ok|FAIL)\s+\S+\s+[\d.]+s/m.test(output)) return true; // go test package summary
  if (
    /"Action"\s*:\s*"(?:pass|fail)"/.test(output) &&
    /"Test"\s*:/.test(output)
  )
    return true; // go test -json
  return false;
}

/**
 * Whether a shell command (e.g. a plan `Done-When` entry) is a runnable test
 * invocation that TEST_GATE should execute under liveness (ADR-005 §10.4).
 * Matches make test-targets and common harnesses; excludes build/lint/echo and
 * bare `test -f` existence checks.
 */
export function isIntegrationTestCommand(cmd: string): boolean {
  const c = cmd.trim();
  return [
    /\bmake\s+[\w:-]*test/, // make test, make test:auth, make integration-test
    /\bpytest\b/,
    /\bgo\s+test\b/,
    /\bcargo\s+test\b/,
    /\bnode\s+--test\b/,
    /\bvitest\b/,
    /\bjest\b/,
    /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b/, // npm test / pnpm test (not `run build`)
  ].some((re) => re.test(c));
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

  return executeTestCommand(command, { cwd, timeout: 300_000 });
}

/** Capture process failure separately from completed assertion results. */
export function executeTestCommand(
  command: string,
  options: ExecSyncOptions,
): TestRunResult {
  let output: string;
  let exitCode = 0;
  let executionError: string | undefined;
  let processError:
    | {
        status?: number | null;
        signal?: string | null;
        code?: string;
        message?: string;
      }
    | undefined;
  try {
    // Merge stderr before execution without introducing a wrapper subshell.
    output = execSync(`exec 2>&1\n${command}`, {
      ...options,
      stdio: "pipe",
      maxBuffer: 16 * 1024 * 1024,
      killSignal: "SIGKILL",
    }).toString();
  } catch (err: unknown) {
    const error = err as typeof processError & {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    output =
      `${error?.stdout?.toString() ?? ""}\n${error?.stderr?.toString() ?? ""}`.trim();
    processError = error ?? {};
    exitCode = processError.status ?? 1;
  }

  const counts = parseTestOutput(output);
  const noTests = /No test files found|no tests (?:ran|collected)/i.test(
    output,
  );
  if (
    processError &&
    (processError.status == null ||
      processError.signal ||
      processError.code ||
      exitCode >= 128)
  ) {
    executionError = `Test runner interrupted: ${processError.code ?? processError.message ?? `exit ${exitCode}`}${processError.signal ? ` (${processError.signal})` : ""}`;
  } else if (
    exitCode !== 0 &&
    (!hasRecognizedTestSummary(output) || counts.failed === 0) &&
    !noTests
  ) {
    executionError = `Test runner exited ${exitCode} without completed failing-test results`;
  } else if (!hasRecognizedTestSummary(output) && !noTests) {
    executionError = "Test runner produced no recognized terminal summary";
  } else if (/^#\s*cancelled\s+[1-9]\d*/m.test(output)) {
    executionError = "Test runner cancelled tests before completion";
  }

  if (executionError) {
    output = `${output}\n${executionError}\nCommand: ${command}`.trim();
    return {
      testsRun: 0,
      passed: 0,
      failed: 0,
      ran: false,
      exitCode: exitCode || 1,
      command,
      output,
      executionError,
    };
  }
  return { ...counts, ran: counts.testsRun > 0, exitCode, command, output };
}
