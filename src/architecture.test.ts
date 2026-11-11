/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  architectureViolations,
  inspectArchitectureSource,
} from "../tests/helpers/architecture-boundary.js";
import {
  buildDiagnosisPrompt,
  evaluateReviewVerdict,
  evaluateScopedTestOutcome,
  extractFixLines,
  extractOpenTaskErrors,
} from "./application/ship/index.js";

function walkTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTsFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

function fixture(name: string): string {
  return fs.readFileSync(
    path.resolve("tests/fixtures/architecture-boundary", name),
    "utf-8",
  );
}

describe("Architecture import detection", () => {
  it("detects static, package and dynamic dependencies", () => {
    const { imports } = inspectArchitectureSource(
      "domain/fixture.ts",
      fixture("imports.txt"),
    );
    expect(imports.map((entry) => entry.specifier)).toEqual([
      "node:fs",
      "fastify",
      "better-sqlite3",
      "node:fs/promises",
      "node:net",
      "node:child_process",
      null,
    ]);
    expect(
      architectureViolations("domain/fixture.ts", fixture("imports.txt")),
    ).toEqual([
      "domain/fixture.ts -> package:node:fs",
      "domain/fixture.ts -> package:fastify",
      "domain/fixture.ts -> package:better-sqlite3",
      "domain/fixture.ts -> package:node:fs/promises",
      "domain/fixture.ts -> dynamic:node:net",
      "domain/fixture.ts -> require:node:child_process",
      "domain/fixture.ts -> dynamic:<non-literal>",
    ]);
  });

  it("ignores import syntax inside prompt text", () => {
    expect(
      architectureViolations("application/prompt.ts", fixture("prompt.txt")),
    ).toEqual([]);
  });

  it("detects direct ambient process and clock reads", () => {
    expect(
      architectureViolations("domain/fixture.ts", fixture("ambient.txt")),
    ).toEqual([
      "domain/fixture.ts -> ambient:process.cwd",
      "domain/fixture.ts -> ambient:process.env",
      "domain/fixture.ts -> ambient:Date.now",
      "domain/fixture.ts -> ambient:new Date()",
    ]);
  });

  it("detects cross-layer dynamic imports", () => {
    expect(
      architectureViolations(
        "application/fixture.ts",
        'await import("../adapters/git/index.js");',
      ),
    ).toEqual([
      "application/fixture.ts -> dynamic-dependency:adapters/git/index.js",
    ]);
  });
});

const layers = ["domain", "ports", "application", "db", "utils", "engine"];

describe("Hexagonal boundary gates (ADR-011)", () => {
  it.each(layers)("rejects new boundary violations in %s", (layer) => {
    const srcRoot = path.resolve("src");
    const files = walkTsFiles(path.join(srcRoot, layer));
    expect(files.length).toBeGreaterThan(0);

    const violations = files.flatMap((file) =>
      architectureViolations(
        path.relative(srcRoot, file).split(path.sep).join("/"),
        fs.readFileSync(file, "utf-8"),
      ),
    );

    expect(violations.sort()).toEqual([]);
  });
});

describe("034-hexagonal-architecture: Decomposed Ship Stage Handlers", () => {
  it("extracts open task errors and builds review-aware diagnosis prompts", () => {
    const errors = extractOpenTaskErrors([
      {
        id: "T001",
        status: "completed",
        description: "BUILD_CHECK FAILED: old",
      },
      {
        id: "T002",
        status: "open",
        description: "Impl\n\nREVIEW FINDING: missing null guard",
      },
    ]);
    expect(errors).toEqual(["Task T002: REVIEW FINDING: missing null guard"]);

    const prompt = buildDiagnosisPrompt(errors, "");
    expect(prompt).toContain("## Review Findings (build and gates are GREEN)");
    expect(prompt).toContain("Task T002: REVIEW FINDING: missing null guard");
  });

  it("unwraps stream-json when extracting FIX: lines", () => {
    const streamOut = JSON.stringify({
      type: "result",
      result: "FIX: src/foo.ts — Add null check\nNotes: done",
    });
    expect(extractFixLines(streamOut)).toEqual([
      "FIX: src/foo.ts — Add null check",
    ]);
  });

  it("evaluates review verdict as a one-way ratchet and detects divergence", () => {
    expect(
      evaluateReviewVerdict({
        agentStdout: '{"verdict": "GO"}',
        reopenedTasks: ["T001"],
        failedGateTasks: [],
      }),
    ).toEqual({
      verdict: "NO-GO",
      divergenceTasks: ["T001"],
    });
  });

  it("evaluates scoped test liveness and baseline regressions", () => {
    expect(
      evaluateScopedTestOutcome({ testsRun: 0, failed: 0, baselineFailed: 0 })
        .passed,
    ).toBe(false);
    expect(
      evaluateScopedTestOutcome({ testsRun: 5, failed: 1, baselineFailed: 0 })
        .passed,
    ).toBe(false);
    expect(
      evaluateScopedTestOutcome({ testsRun: 5, failed: 0, baselineFailed: 0 })
        .passed,
    ).toBe(true);
  });
});
