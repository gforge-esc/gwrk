/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { executeTestCommand } from "./test-runner.js";

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function nodeCommand(script: string): string {
  return `${shellQuote(process.execPath)} -e ${shellQuote(script)}`;
}

describe("test command process completion", () => {
  it("reads a successful Jest summary written to stderr", () => {
    const result = executeTestCommand(nodeCommand('console.error("Tests: 3 passed, 3 total");'), { timeout: 5_000 });
    expect(result.executionError).toBeUndefined();
    expect(result).toMatchObject({ exitCode: 0, testsRun: 3, passed: 3, failed: 0 });
  });

  it("captures timeout output without accepting noisy fixture results", () => {
    const result = executeTestCommand(nodeCommand('require("node:fs").writeSync(1, "Gate reconciliation: 2/5 passed (3 failed)\\n"); setInterval(() => {}, 1000);'), { timeout: 500 });
    expect(result.executionError).toContain("ETIMEDOUT");
    expect(result.output).toContain("Gate reconciliation: 2/5 passed (3 failed)");
    expect(result).toMatchObject({ ran: false, testsRun: 0, failed: 0 });
  });

  it("rejects a signalled runner even after a passing summary", () => {
    const result = executeTestCommand(nodeCommand('require("node:fs").writeSync(1, "Tests 3 passed (3)\\n"); process.kill(process.pid, "SIGTERM");'), { timeout: 5_000 });
    expect(result.executionError).toBeTruthy();
    expect(result).toMatchObject({ ran: false, testsRun: 0, failed: 0 });
  });

  it("keeps a nonzero process with incomplete output separate from assertion failure", () => {
    const result = executeTestCommand(nodeCommand('console.log("Gate reconciliation: 2/5 passed (3 failed)"); console.error("runner crashed"); process.exit(1);'), { timeout: 5_000 });
    expect(result.executionError).toBeTruthy();
    expect(result.output).toContain("runner crashed");
    expect(result).toMatchObject({ exitCode: 1, testsRun: 0, failed: 0 });
  });
});
