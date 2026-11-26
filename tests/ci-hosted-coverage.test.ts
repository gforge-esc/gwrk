/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";

const repo = fileURLToPath(new URL("..", import.meta.url));
const vitest = join(repo, "node_modules/vitest/vitest.mjs");
const config = join(repo, "vitest.config.ts");

const portableFixtureSuites = [
  "tests/hosted-pilot/fixtures/runtime-policy.test.mjs",
  "tests/hosted-pilot/fixtures/docker-diagnostics.test.mjs",
  "tests/hosted-pilot/fixtures/native-observer-parser.test.mjs",
  "tests/hosted-pilot/fixtures/native-observer-wiring.test.mjs",
  "tests/hosted-pilot/fixtures/native-observer.test.mjs",
  "tests/hosted-pilot/fixtures/bootstrap-diagnostics.test.mjs",
  "tests/hosted-pilot/fixtures/nested-lifecycle.test.mjs",
  "tests/hosted-pilot/fixtures/oidc-overrides.test.mjs",
  "tests/hosted-pilot/fixtures/process-scope.test.mjs",
  "tests/hosted-pilot/fixtures/raw-https.test.mjs",
  "tests/hosted-pilot/fixtures/run-native.test.mjs",
  "tests/hosted-pilot/fixtures/issuer.test.mjs",
  "tests/hosted-pilot/fixtures/syn-gate.test.mjs",
];

const nativeExcludedSuites = [
  "tests/hosted-pilot/fixtures/gateway-cases.test.mjs",
  "tests/hosted-pilot/fixtures/legacy-offline-stage.test.mjs",
  "tests/hosted-pilot/gateway-startup.test.ts",
  "tests/hosted-pilot/tls-preflight.test.ts",
];

function runVitest(args: string[], envOverrides: Record<string, string> = {}) {
  const env = {
    ...process.env,
    CI: "true",
    FORCE_COLOR: "1",
    NO_COLOR: undefined,
    ...envOverrides,
  };
  const result = spawnSync(
    process.execPath,
    [vitest, ...args, "--root", repo, "--config", config],
    { cwd: repo, env, encoding: "utf8", timeout: 30_000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return {
    status: result.status,
    output: stripVTControlCharacters(result.stdout + result.stderr),
  };
}

describe("CI hosted fixture coverage selection policy", () => {
  it("selects all portable fixture suites when CI=true", () => {
    const result = runVitest(["list", "--filesOnly"]);
    expect(result.status, result.output).toBe(0);
    const selectedFiles = new Set(
      result.output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    );

    for (const suite of portableFixtureSuites) {
      expect
        .soft(
          selectedFiles.has(suite),
          `CI must select portable suite: ${suite}`,
        )
        .toBe(true);
    }
  });

  it("excludes Docker and kernel-mount dependent suites when CI=true", () => {
    const result = runVitest(["list", "--filesOnly"]);
    expect(result.status, result.output).toBe(0);
    const selectedFiles = new Set(
      result.output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    );

    for (const suite of nativeExcludedSuites) {
      expect
        .soft(
          selectedFiles.has(suite),
          `CI must exclude native-dependent suite: ${suite}`,
        )
        .toBe(false);
    }
  });

  it("actually executes portable fixture suites under CI=true without exclusion failure", () => {
    const targetSuites = [
      "tests/hosted-pilot/fixtures/runtime-policy.test.mjs",
      "tests/hosted-pilot/fixtures/docker-diagnostics.test.mjs",
      "tests/hosted-pilot/fixtures/native-observer-parser.test.mjs",
    ];

    const result = runVitest(["run", ...targetSuites]);
    expect(result.output).not.toContain("No test files found");
    expect(result.status, result.output).toBe(0);
    expect(result.output).toMatch(/passed/i);
  });
});
