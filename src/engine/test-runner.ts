/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { type ExecSyncOptions, execSync } from "node:child_process";
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import { getTestCommand } from "../utils/toolchain-mapper.js";
import { type ProjectProfile, detectProfile } from "./profile-detector.js";

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
  /** Completed Vitest suite-load failures, separate from executed assertions. */
  failedSuites?: number;
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

  return executeTestCommand(
    command,
    { cwd, timeout: 300_000 },
    {
      format: getTestResultFormat(profile),
      vitest: { filters: files, grepPattern },
    },
  );
}

/** A baseline may record finished load failures without claiming assertions ran. */
export interface TestExecutionPurpose {
  purpose?: "initial-baseline";
  format?: "vitest-json";
  vitest?: { filters: readonly string[]; grepPattern?: string };
}

/** Unknown producers retain the strict legacy text path. */
export function getTestResultFormat(
  profile: Pick<ProjectProfile, "toolchain">,
): "vitest-json" | undefined {
  return profile.toolchain?.test === "vitest" && !profile.toolchain.testCommand
    ? "vitest-json"
    : undefined;
}

const artifactLimit = 16 * 1024 * 1024;
const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const vitestReportSchema = z.object({
  numTotalTestSuites: countSchema,
  numPassedTestSuites: countSchema,
  numFailedTestSuites: countSchema,
  numPendingTestSuites: countSchema,
  numTotalTests: countSchema,
  numPassedTests: countSchema,
  numFailedTests: countSchema,
  numPendingTests: countSchema,
  numTodoTests: countSchema,
  startTime: z.number().finite(),
  success: z.boolean(),
  testResults: z.array(
    z.object({
      name: z.string().min(1),
      status: z.enum(["passed", "failed"]),
      message: z.string(),
      startTime: z.number().finite(),
      endTime: z.number().finite(),
      assertionResults: z.array(
        z.object({ status: z.enum(["passed", "failed", "skipped", "todo"]) }),
      ),
    }),
  ),
});

function readOwnedJson(file: string): unknown {
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())
    throw new Error();
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let data: unknown;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size === 0 || stat.size > artifactLimit)
      throw new Error();
    const bytes = Buffer.alloc(artifactLimit + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = readSync(fd, bytes, size, bytes.length - size, size);
      if (read === 0) break;
      size += read;
    }
    if (size > artifactLimit) throw new Error();
    data = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)),
    );
  } finally {
    closeSync(fd);
  }
  return data;
}

function readVitestArtifact(file: string): {
  testsRun: number;
  passed: number;
  failed: number;
  failedSuites: number;
  success: boolean;
  fileCount: number;
} {
  const data = readOwnedJson(file);
  const report = vitestReportSchema.parse(data);
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let todo = 0;
  let failedSuites = 0;
  let failedFiles = 0;
  const names = new Set<string>();
  for (const file of report.testResults) {
    if (names.has(file.name) || file.endTime < file.startTime)
      throw new Error();
    names.add(file.name);
    let assertionFailures = 0;
    for (const assertion of file.assertionResults) {
      if (assertion.status === "passed") passed++;
      else if (assertion.status === "failed") {
        failed++;
        assertionFailures++;
      } else if (assertion.status === "skipped") skipped++;
      else todo++;
    }
    if (file.status === "failed") {
      failedFiles++;
      if (file.assertionResults.length === 0 && file.message.trim())
        failedSuites++;
      else if (file.message || assertionFailures === 0) throw new Error();
    } else if (file.message || assertionFailures > 0) throw new Error();
  }
  if (
    report.numPassedTests !== passed ||
    report.numFailedTests !== failed ||
    report.numPendingTests !== skipped ||
    report.numTodoTests !== todo ||
    report.numTotalTests !== passed + failed + skipped + todo ||
    report.numTotalTestSuites !==
      report.numPassedTestSuites +
        report.numFailedTestSuites +
        report.numPendingTestSuites ||
    report.numTotalTestSuites < report.testResults.length ||
    report.numFailedTestSuites < failedFiles ||
    (failedFiles === 0 && report.numFailedTestSuites !== 0) ||
    report.success === (failed > 0 || failedFiles > 0)
  )
    throw new Error();
  return {
    testsRun: passed + failed,
    passed,
    failed,
    failedSuites,
    success: report.success,
    fileCount: report.testResults.length,
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const completionSchema = z.object({
  reason: z.enum(["passed", "failed", "interrupted"]),
  unhandledErrorCount: countSchema,
  moduleCount: countSchema,
  startResolved: z.literal(true),
  closeResolved: z.literal(true),
});
const invocationSchema = z.object({
  filters: z.array(z.string()),
  grepPattern: z.string().optional(),
});

// Only public Vitest APIs and a public Vite config hook cross this boundary.
const vitestProducerSource = String.raw`
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const request = JSON.parse(readFileSync(process.argv[2], "utf8"));
process.chdir(request.cwd);
let context;
let closed = false;
let completion;
let endCount = 0;
try {
  const requireProject = createRequire(join(process.cwd(), "package.json"));
  const { createVitest } = await import(pathToFileURL(requireProject.resolve("vitest/node")).href);
  const observer = { onTestRunEnd(modules, errors, reason) {
    endCount++;
    completion = { reason, unhandledErrorCount: errors.length, moduleCount: modules.length };
  } };
  const reporting = { name: "gwrk-authoritative-vitest-results", enforce: "post", config(config) {
    const configured = config.test?.reporters;
    const reporters = configured == null ? [] : Array.isArray(configured) ? configured : [configured];
    config.test = { ...config.test, reporters: [...reporters, "verbose", ["json", { outputFile: request.reportFile }], observer] };
  } };
  context = await createVitest("test", { root: process.cwd(), run: true, watch: false,
    ...(request.grepPattern === undefined ? {} : { testNamePattern: request.grepPattern })
  }, { plugins: [reporting] });
  const shutdownFailures = [];
  const recordFailure = (error) => { shutdownFailures.push(error); throw error; };
  const registerClose = context.onClose.bind(context);
  context.onClose = (callback) => registerClose(function (...args) {
    let result;
    try { result = callback.apply(this, args); } catch (error) { return recordFailure(error); }
    return result && typeof result.then === "function" ? result.catch(recordFailure) : result;
  });
  const observedClose = new WeakSet();
  const observeClose = (target) => {
    if (observedClose.has(target)) return;
    observedClose.add(target);
    const close = target.close.bind(target);
    let observed;
    target.close = () => {
      if (!observed) {
        try { observed = close().catch(recordFailure); } catch (error) { return recordFailure(error); }
      }
      return observed;
    };
  };
  const observeProjectClose = () => {
    for (const project of new Set([...context.projects, context.getRootProject()])) {
      observeClose(project);
      // Vite settles environment failures too; observe their public plugin container promise.
      for (const environment of Object.values(project.vite.environments)) observeClose(environment.pluginContainer);
    }
  };
  observeProjectClose();
  await context.start(request.filters);
  observeProjectClose();
  await context.close();
  closed = true;
  if (shutdownFailures.length) throw shutdownFailures[0];
  if (endCount !== 1 || !completion) throw new Error("Missing unique Vitest run completion");
  writeFileSync(request.completionFile, JSON.stringify({ ...completion, startResolved: true, closeResolved: true }));
  if (process.exitCode == null) process.exitCode = completion.reason === "passed" ? 0 : 1;
} catch (error) {
  console.error("Vitest producer failed before completion", error);
  process.exitCode = 2;
} finally {
  if (context && !closed) {
    try { await context.close(); } catch (error) {
      console.error("Vitest producer cleanup failed", error);
      process.exitCode = 2;
    }
  }
}
`;

/** Each explicit producer owns an isolated, single-use result artifact. */
export function executeTestCommand(
  command: string,
  options: ExecSyncOptions,
  purpose?: TestExecutionPurpose,
): TestRunResult {
  if (purpose?.format !== "vitest-json")
    return executeCapturedTestCommand(command, options, purpose);
  let directory: string | undefined;
  try {
    directory = mkdtempSync(path.join(tmpdir(), "gwrk-vitest-result-"));
    const artifact = path.join(directory, "result.json");
    closeSync(
      openSync(
        artifact,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      ),
    );
    const invocation = invocationSchema.parse(purpose.vitest);
    const completion = path.join(directory, "completion.json");
    closeSync(
      openSync(
        completion,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      ),
    );
    const producer = path.join(directory, "gwrk-vitest-producer.mjs");
    const request = path.join(directory, "request.json");
    writeFileSync(producer, vitestProducerSource, { mode: 0o600, flag: "wx" });
    writeFileSync(
      request,
      JSON.stringify({
        ...invocation,
        cwd:
          typeof options.cwd === "object"
            ? fileURLToPath(options.cwd)
            : path.resolve(options.cwd ?? process.cwd()),
        reportFile: artifact,
        completionFile: completion,
      }),
      { mode: 0o600, flag: "wx" },
    );
    const reported = `pnpm exec node ${shellQuote(producer)} ${shellQuote(request)}`;
    return executeCapturedTestCommand(reported, options, purpose, {
      report: artifact,
      completion,
    });
  } catch {
    const executionError = "Vitest result artifact is unavailable or invalid";
    return {
      testsRun: 0,
      passed: 0,
      failed: 0,
      ran: false,
      exitCode: 1,
      command,
      output: `${executionError}\nCommand: ${command}`,
      executionError,
    };
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
}

const vitestRunBanner = /^[ \t]*RUN[ \t]+v\d+\.\d+\.\d+[^\n]*$/m;
const failedVitestSuites =
  /^[ \t]*[⎯─━-]*[ \t]*Failed Suites[ \t]+([1-9]\d*)[ \t]*[⎯─━-]*[ \t]*$/m;

function summaryTotal(
  text: string,
): { failed: number; total: number } | undefined {
  const match = text.match(/^(.+?)\s+\((\d+)\)$/);
  if (!match) return undefined;
  let total = 0;
  let failed = 0;
  const seen = new Set<string>();
  for (const part of match[1].split(/\s*\|\s*/)) {
    const count = part.match(/^(\d+) (failed|passed|skipped|todo)$/);
    if (!count || seen.has(count[2])) return undefined;
    seen.add(count[2]);
    total += Number(count[1]);
    if (count[2] === "failed") failed = Number(count[1]);
  }
  return total === Number(match[2]) ? { failed, total } : undefined;
}

function completedVitestLoadReport(
  output: string,
):
  | { failedSuites: number; counts: ReturnType<typeof parseTestOutput> }
  | undefined {
  const clean = stripVTControlCharacters(output).trim();
  if (!vitestRunBanner.test(clean)) return undefined;
  const failed = clean.match(failedVitestSuites);
  if (!failed) return undefined;
  // Only the observed terminal Vitest frame and known wrapper cleanup may end it.
  const terminal = clean.match(
    /^[ \t]*Test Files[ \t]+([^\n]+)\n[ \t]*Tests[ \t]+([^\n]+)\n[ \t]*Start at[ \t]+\d{2}:\d{2}:\d{2}\n[ \t]*Duration[ \t]+\d+(?:\.\d+)?(?:ms|s)[ \t]+\([^()\n]*\)\s*(?:\[gwrk heavy\] slot \d+ released\s*)?$(?![\s\S])/m,
  );
  if (
    !terminal ||
    terminal.index === undefined ||
    terminal.index < (failed.index ?? 0)
  )
    return undefined;
  const files = summaryTotal(terminal[1].trim());
  const tests =
    terminal[2].trim() === "no tests"
      ? { failed: 0, total: 0 }
      : summaryTotal(terminal[2].trim());
  const failedSuites = Number(failed[1]);
  if (!files || !tests || failedSuites > files.failed) return undefined;
  return { failedSuites, counts: parseTestOutput(`Tests ${terminal[2]}`) };
}

/** Capture process failure separately from completed assertion results. */
function executeCapturedTestCommand(
  command: string,
  options: ExecSyncOptions,
  purpose?: TestExecutionPurpose,
  artifact?: { report: string; completion: string },
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

  if (artifact) {
    const interrupted =
      processError &&
      (processError.status == null ||
        processError.signal ||
        processError.code ||
        exitCode >= 128);
    if (interrupted)
      executionError =
        "Test runner interrupted before validated Vitest completion";
    else {
      try {
        const result = readVitestArtifact(artifact.report);
        const completion = completionSchema.parse(
          readOwnedJson(artifact.completion),
        );
        if (
          completion.unhandledErrorCount !== 0 ||
          completion.reason === "interrupted" ||
          completion.moduleCount !== result.fileCount ||
          completion.reason !== (result.success ? "passed" : "failed")
        )
          throw new Error();
        if (exitCode !== (result.success ? 0 : 1)) throw new Error();
        if (
          result.failedSuites > 0 &&
          purpose?.purpose !== "initial-baseline"
        ) {
          executionError =
            "Test runner has suite-load failures; verification requires executable tests";
        } else {
          const {
            success: _success,
            fileCount: _fileCount,
            ...counts
          } = result;
          return {
            ...counts,
            ran: counts.testsRun > 0,
            exitCode,
            command,
            output,
          };
        }
      } catch {
        executionError =
          "Vitest result artifact is unavailable, inconsistent, or incomplete";
      }
    }
    return {
      testsRun: 0,
      passed: 0,
      failed: 0,
      ran: false,
      exitCode: exitCode || 1,
      command,
      output: `${output}\n${executionError}\nCommand: ${command}`.trim(),
      executionError,
    };
  }

  let counts = parseTestOutput(output);
  let failedSuites: number | undefined;
  const completedLoadReport = completedVitestLoadReport(output);
  const cleanOutput = stripVTControlCharacters(output);
  const hasLoadFailures =
    vitestRunBanner.test(cleanOutput) && failedVitestSuites.test(cleanOutput);
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
  } else if (/^#\s*cancelled\s+[1-9]\d*/m.test(output)) {
    executionError = "Test runner cancelled tests before completion";
  } else if (hasLoadFailures) {
    if (
      purpose?.purpose === "initial-baseline" &&
      exitCode === 1 &&
      completedLoadReport
    ) {
      failedSuites = completedLoadReport.failedSuites;
      counts = completedLoadReport.counts;
    } else {
      executionError =
        "Test runner has suite-load failures; verification requires executable tests";
    }
  } else if (
    exitCode !== 0 &&
    (!hasRecognizedTestSummary(output) || counts.failed === 0) &&
    !noTests
  ) {
    executionError = `Test runner exited ${exitCode} without completed failing-test results`;
  } else if (!hasRecognizedTestSummary(output) && !noTests) {
    executionError = "Test runner produced no recognized terminal summary";
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
  return {
    ...counts,
    ran: counts.testsRun > 0,
    exitCode,
    command,
    output,
    ...(failedSuites === undefined ? {} : { failedSuites }),
  };
}
