/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";

/** Recursively list test files under a top-level `tests/` tree (relative paths). */
export function listTestsTree(cwd: string): string[] {
  const root = path.join(cwd, "tests");
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(test|spec)\.[jt]s$|_test\.(go|py)$|test_.*\.py$/.test(e.name)) {
        out.push(path.relative(cwd, full));
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

/**
 * Return the test files that cover a phase's source files: existing mentioned
 * tests, co-located tests, and out-of-tree tests/ suites matched by source
 * basename. This is what T3's executional gate runs — so it must find
 * out-of-tree suites, not only co-located ones.
 */
export function discoverTestsForSources(opts: {
  sourceFiles: string[];
  mentionedTests: string[];
  testExt: string;
  fileExists: (relPath: string) => boolean;
  testsTreeFiles: string[];
}): string[] {
  const { sourceFiles, mentionedTests, testExt, fileExists, testsTreeFiles } =
    opts;
  const found = new Set<string>();

  for (const t of mentionedTests) if (fileExists(t)) found.add(t);

  for (const src of sourceFiles) {
    const colocated = src.replace(/\.[^/.]+$/, testExt);
    if (fileExists(colocated)) found.add(colocated);
  }

  const sourceBases = new Set(
    sourceFiles.map((s) => path.basename(s).replace(/\.[^/.]+$/, "")),
  );
  for (const t of testsTreeFiles) {
    const base = path
      .basename(t)
      .replace(/\.[^/.]+$/, "")
      .replace(/\.test$/, "");
    if (sourceBases.has(base)) found.add(t);
  }

  return [...found];
}

/**
 * FR-008 (ADR-005 §10.2.4): decide whether a phase has real test coverage.
 * Existence-based (a *mentioned* test that doesn't exist does NOT count) and
 * profile-aware (uses the profile's test extension), and it recognizes tests
 * that live in a separate `tests/` tree, not only co-located ones — so a
 * project that keeps tests out-of-tree is not falsely blocked.
 *
 * Returns true when there is nothing to gate (no source files) or at least one
 * discoverable test maps to the phase; false only when source deliverables
 * exist with no discoverable test.
 */
export function phaseHasTests(opts: {
  sourceFiles: string[];
  mentionedTests: string[];
  testExt: string;
  fileExists: (relPath: string) => boolean;
  testsTreeFiles: string[];
}): boolean {
  const { sourceFiles, mentionedTests, testExt, fileExists, testsTreeFiles } =
    opts;

  if (sourceFiles.length === 0) return true; // nothing to gate

  // 1. A mentioned test only counts if it actually exists.
  if (mentionedTests.some((t) => fileExists(t))) return true;

  // 2. Co-located test next to a source file.
  const colocated = sourceFiles.some((src) => {
    const testPath = src.replace(/\.[^/.]+$/, testExt);
    return fileExists(testPath);
  });
  if (colocated) return true;

  // 3. A basename match anywhere under a tests/ tree.
  const sourceBases = new Set(
    sourceFiles.map((src) => path.basename(src).replace(/\.[^/.]+$/, "")),
  );
  const treeMatch = testsTreeFiles.some((t) => {
    const base = path.basename(t).replace(/\.[^/.]+$/, "").replace(/\.test$/, "");
    return sourceBases.has(base);
  });
  return treeMatch;
}
