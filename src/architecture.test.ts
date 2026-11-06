/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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

function getStaticImports(filePath: string): { spec: string; targetPkg: string; targetRel: string }[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const re =
    /^\s*(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["'](\.[^"']+)["']/gm;
  const out: { spec: string; targetPkg: string; targetRel: string }[] = [];
  for (const match of content.matchAll(re)) {
    const spec = match[1];
    const resolved = path.resolve(path.dirname(filePath), spec.replace(/\.js$/, ".ts"));
    const rel = path.relative(path.resolve("src"), resolved).replace(/\\/g, "/");
    const targetPkg = rel.includes("/") ? rel.split("/")[0] : "(root)";
    out.push({ spec, targetPkg, targetRel: rel });
  }
  return out;
}

describe("034-hexagonal-architecture: 4-Layer Boundary Gate (ADR-011)", () => {
  it("src/domain/** has zero outward imports to any other layer", () => {
    const domainFiles = walkTsFiles(path.resolve("src/domain"));
    expect(domainFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of domainFiles) {
      const relFile = path.relative(path.resolve("src"), file);
      for (const imp of getStaticImports(file)) {
        if (imp.targetPkg !== "domain") {
          violations.push(`${relFile} -> ${imp.targetRel}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("src/ports/** imports only from src/domain/** and src/ports/**", () => {
    const portFiles = walkTsFiles(path.resolve("src/ports"));
    expect(portFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of portFiles) {
      const relFile = path.relative(path.resolve("src"), file);
      for (const imp of getStaticImports(file)) {
        if (imp.targetPkg !== "domain" && imp.targetPkg !== "ports") {
          violations.push(`${relFile} -> ${imp.targetRel}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("src/application/** imports only from src/domain/**, src/ports/**, and src/application/**", () => {
    const appFiles = walkTsFiles(path.resolve("src/application"));
    expect(appFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of appFiles) {
      const relFile = path.relative(path.resolve("src"), file);
      for (const imp of getStaticImports(file)) {
        if (
          imp.targetPkg !== "domain" &&
          imp.targetPkg !== "ports" &&
          imp.targetPkg !== "application"
        ) {
          violations.push(`${relFile} -> ${imp.targetRel}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("src/db/** has zero imports from engine, utils, plugins, server, or commands", () => {
    const dbFiles = walkTsFiles(path.resolve("src/db"));
    expect(dbFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of dbFiles) {
      const relFile = path.relative(path.resolve("src"), file);
      for (const imp of getStaticImports(file)) {
        if (imp.targetPkg !== "db" && imp.targetPkg !== "domain" && imp.targetPkg !== "ports") {
          violations.push(`${relFile} -> ${imp.targetRel}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("src/utils/** has zero static imports from src/server/**", () => {
    const utilFiles = walkTsFiles(path.resolve("src/utils"));
    const violations: string[] = [];
    for (const file of utilFiles) {
      const relFile = path.relative(path.resolve("src"), file);
      for (const imp of getStaticImports(file)) {
        if (imp.targetPkg === "server") {
          violations.push(`${relFile} -> ${imp.targetRel}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("src/engine/** has zero static imports from src/server/**", () => {
    const engineFiles = walkTsFiles(path.resolve("src/engine"));
    const violations: string[] = [];
    for (const file of engineFiles) {
      const relFile = path.relative(path.resolve("src"), file);
      for (const imp of getStaticImports(file)) {
        if (imp.targetPkg === "server") {
          violations.push(`${relFile} -> ${imp.targetRel}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("034-hexagonal-architecture: Decomposed Ship Stage Handlers", () => {
  it("extracts open task errors and builds review-aware diagnosis prompts", () => {
    const errors = extractOpenTaskErrors([
      { id: "T001", status: "completed", description: "BUILD_CHECK FAILED: old" },
      { id: "T002", status: "open", description: "Impl\n\nREVIEW FINDING: missing null guard" },
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
    expect(extractFixLines(streamOut)).toEqual(["FIX: src/foo.ts — Add null check"]);
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
      evaluateScopedTestOutcome({ testsRun: 0, failed: 0, baselineFailed: 0 }).passed,
    ).toBe(false);
    expect(
      evaluateScopedTestOutcome({ testsRun: 5, failed: 1, baselineFailed: 0 }).passed,
    ).toBe(false);
    expect(
      evaluateScopedTestOutcome({ testsRun: 5, failed: 0, baselineFailed: 0 }).passed,
    ).toBe(true);
  });
});
