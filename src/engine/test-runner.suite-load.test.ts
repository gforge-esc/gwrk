/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdtempSync, writeFileSync, rmSync, cpSync, copyFileSync, constants } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeTestCommand } from "./test-runner.js";

const complete = [
  " RUN  v3.2.4 /fixture", "",
  "⎯⎯⎯ Failed Suites 3 ⎯⎯⎯",
  "Error: Cannot find module './not-yet-implemented.js'", "",
  " Test Files  3 failed | 1 passed (4)",
  "      Tests  2 passed (2)",
  "   Start at  19:04:22",
  "   Duration  1.06s (transform 540ms, setup 0ms, collect 48ms, tests 725ms, environment 0ms, prepare 202ms)",
  "", "[gwrk heavy] slot 1 released",
].join("\n");
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const command = (output: string, ending = "process.exit(1)") => `${quote(process.execPath)} -e ${quote(`require("node:fs").writeSync(1, ${JSON.stringify(output)}); ${ending};`)}`;
const baseline = { purpose: "initial-baseline" as const };

describe("completed Vitest suite-load failures", () => {
  it("records an actual completed Vitest run with three missing-module suites and two passing assertions", () => {
    const root = mkdtempSync(join(tmpdir(), "gwrk-vitest-load-baseline-"));
    try {
      copyFileSync(join(process.cwd(), "package.json"), join(root, "package.json"));
      copyFileSync(join(process.cwd(), "pnpm-lock.yaml"), join(root, "pnpm-lock.yaml"));
      cpSync(join(process.cwd(), "node_modules"), join(root, "node_modules"), { recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true });
      const config = join(root, "vitest.config.mjs");
      writeFileSync(config, `export default { test: { globals: true, include: ["*.test.js"], maxWorkers: 1, minWorkers: 1 } };`);
      for (let n = 0; n < 3; n++) writeFileSync(join(root, `missing-${n}.test.js`), 'import "./absent-implementation.js";');
      writeFileSync(join(root, "existing.test.js"), 'test("existing one", () => expect(1).toBe(1)); test("existing two", () => expect(2).toBe(2));');
      const entry = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");
      const result = executeTestCommand(`${quote(process.execPath)} ${quote(entry)} run --config ${quote(config)}`, { cwd: root, timeout: 15000, env: { ...process.env, NODE_OPTIONS: "" } }, { ...baseline, format: "vitest-json", vitest: { filters: [] } });
      expect(result.output).toContain("Failed Suites 3");
      expect(result.executionError, result.output).toBeUndefined();
      expect(result).toMatchObject({ exitCode: 1, testsRun: 2, passed: 2, failed: 0, failedSuites: 3, ran: true });
      expect(executeTestCommand(command(result.output), { timeout: 5000 }).executionError).toBeTruthy();
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 20000);

  it("accepts a finished load-failure report only as negative initial baseline evidence", () => {
    const result = executeTestCommand(command(complete), { timeout: 5000 }, baseline);
    expect(result.executionError).toBeUndefined();
    expect(result).toMatchObject({ exitCode: 1, testsRun: 2, passed: 2, failed: 0, failedSuites: 3, ran: true });
  });
  it("does not claim assertions executed when every suite failed to load", () => {
    const output = complete.replace("3 failed | 1 passed (4)", "3 failed (3)").replace("2 passed (2)", "no tests");
    const result = executeTestCommand(command(output), { timeout: 5000 }, baseline);
    expect(result.executionError).toBeUndefined();
    expect(result).toMatchObject({ exitCode: 1, testsRun: 0, passed: 0, failed: 0, failedSuites: 3, ran: false });
  });
  it("retains executed assertion failures separately from load failures", () => {
    const output = complete.replace("3 failed | 1 passed (4)", "4 failed (4)").replace("2 passed (2)", "1 failed | 2 passed (3)");
    const result = executeTestCommand(command(output), { timeout: 5000 }, baseline);
    expect(result.executionError).toBeUndefined();
    expect(result).toMatchObject({ testsRun: 3, passed: 2, failed: 1, failedSuites: 3 });
  });
  it("remains a verification error with the same complete report", () => {
    expect(executeTestCommand(command(complete), { timeout: 5000 }).executionError).toBeTruthy();
  });
  it("does not hide suite-load failures behind executed assertion failures", () => {
    const output = complete.replace("3 failed | 1 passed (4)", "4 failed (4)").replace("2 passed (2)", "1 failed | 2 passed (3)");
    expect(executeTestCommand(command(output), { timeout: 5000 }).executionError).toBeTruthy();
  });
  it.each([
    ["missing duration", complete.split("   Duration")[0]],
    ["unterminated duration", complete.replace("prepare 202ms)", "prepare")],
    ["missing start", complete.replace(/   Start at[^\n]*\n/, "")],
    ["missing runner banner", complete.replace(/ RUN[^\n]*\n/, "")],
    ["missing failed suite section", complete.replace("⎯⎯⎯ Failed Suites 3 ⎯⎯⎯", "fixture failed")],
    ["inconsistent file total", complete.replace("(4)", "(99)")],
    ["inconsistent assertion total", complete.replace("(2)", "(99)")],
    ["more failed suites than files", complete.replace("Failed Suites 3", "Failed Suites 5")],
    ["trailing crash diagnostic", `${complete}\nrunner crashed after reporting`],
    ["cancelled assertions", `# cancelled 1\n${complete}`],
    ["positive partial summary", "RUN v3.2.4 /fixture\nTests 2 passed (2)\nfixture remains active"],
    ["exit one after all passes", complete.replace("⎯⎯⎯ Failed Suites 3 ⎯⎯⎯", "").replace("3 failed | 1 passed (4)", "4 passed (4)")],
  ])("rejects %s even during initial baseline", (_label, output) => {
    const result = executeTestCommand(command(output), { timeout: 5000 }, baseline);
    expect(result.executionError).toBeTruthy();
    expect(result).toMatchObject({ ran: false, testsRun: 0, failed: 0 });
  });
  it.each([
    ["timeout", "setInterval(() => {}, 1000)", 200],
    ["signal", 'process.kill(process.pid, "SIGTERM")', 5000],
    ["wrong exit", "process.exit(2)", 5000],
    ["false successful exit", "process.exit(0)", 5000],
  ] as const)("rejects %s after a complete-looking report", (_label, ending, timeout) => {
    const result = executeTestCommand(command(complete, ending), { timeout }, baseline);
    expect(result.executionError).toBeTruthy();
    expect(result.ran).toBe(false);
  });
});
