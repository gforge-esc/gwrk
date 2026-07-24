/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { isIntegrationTestCommand, parseTestOutput } from "./test-runner.js";

describe("parseTestOutput — structured {testsRun, passed, failed}", () => {
  it("parses a vitest summary and ignores the 'Test Files' line", () => {
    const out = [
      " Test Files  1 failed | 3 passed (4)",
      "      Tests  2 failed | 45 passed (47)",
    ].join("\n");
    expect(parseTestOutput(out)).toEqual({ testsRun: 47, passed: 45, failed: 2 });
  });

  it("parses a clean vitest run", () => {
    expect(parseTestOutput("Tests  16 passed (16)")).toEqual({
      testsRun: 16,
      passed: 16,
      failed: 0,
    });
  });

  it("parses jest summary", () => {
    expect(parseTestOutput("Tests: 2 failed, 8 passed, 10 total")).toEqual({
      testsRun: 10,
      passed: 8,
      failed: 2,
    });
  });

  it("parses pytest summary", () => {
    expect(parseTestOutput("===== 3 passed, 1 failed in 0.42s =====")).toEqual({
      testsRun: 4,
      passed: 3,
      failed: 1,
    });
  });

  it("parses node --test TAP summary", () => {
    const out = ["# tests 3", "# pass 3", "# fail 0"].join("\n");
    expect(parseTestOutput(out)).toEqual({ testsRun: 3, passed: 3, failed: 0 });
  });

  it("treats node --test cancelled-only suites as testsRun 0 (liveness FAIL)", () => {
    // Prisma before-hook throws → every integration test cancels, none run.
    const out = ["# tests 11", "# pass 0", "# fail 0", "# cancelled 11"].join("\n");
    expect(parseTestOutput(out)).toEqual({ testsRun: 0, passed: 0, failed: 0 });
  });

  it("reports testsRun 0 when no tests were discovered", () => {
    expect(parseTestOutput("No test files found, exiting with code 1")).toEqual({
      testsRun: 0,
      passed: 0,
      failed: 0,
    });
  });
});

describe("isIntegrationTestCommand (021 FR-009 / ADR-005 §10.4)", () => {
  it.each([
    "make test:auth",
    "make test",
    "make integration-test",
    "pytest tests/",
    "go test ./...",
    "node --test",
    "npm test",
    "pnpm test",
    "vitest run",
  ])("treats %j as an integration test command", (cmd) => {
    expect(isIntegrationTestCommand(cmd)).toBe(true);
  });

  it.each([
    "test -f src/foo.js",
    'echo "done"',
    "npm run build",
    "pnpm build",
    "tsc --noEmit",
    "curl -s http://localhost | jq -e .ok",
  ])("does not treat %j as an integration test command", (cmd) => {
    expect(isIntegrationTestCommand(cmd)).toBe(false);
  });
});
