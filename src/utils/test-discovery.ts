/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";

/** The single multi-language test-file basename pattern (TC-005). `.test`/`.spec`
 * for JS/TS, `_test.go`/`_test.py` and `test_*.py` for Go/Python. */
const TEST_FILE_RE = /\.(test|spec)\.[jt]s$|_test\.(go|py)$|test_.*\.py$/;

/**
 * The one definition of "what is a test file" (FR-003, TC-005). Returns true when
 * the path's basename matches {@link TEST_FILE_RE} or — when a profile test
 * extension is supplied — the path ends with that `testExt`. Pure path/regex
 * check; never invokes a binary (TC-006).
 */
export function isTestFile(relPath: string, testExt?: string): boolean {
  if (TEST_FILE_RE.test(path.basename(relPath))) return true;
  if (testExt && relPath.endsWith(testExt)) return true;
  return false;
}

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
      else if (isTestFile(e.name)) {
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
  /** Explicit test files a phase points at (plan Test Strategy) — the "declared
   * target" arm (ADR-005 §10.2 Invariant 4 / §11). Existence-checked; lets a
   * behavior-named out-of-tree suite map to a phase without a basename match. */
  declaredTargets?: string[];
}): string[] {
  const {
    sourceFiles,
    mentionedTests,
    testExt,
    fileExists,
    testsTreeFiles,
    declaredTargets,
  } = opts;
  const found = new Set<string>();

  for (const t of declaredTargets ?? [])
    if (fileExists(t) && isTestFile(t, testExt)) found.add(t);
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
  /** Explicit test files a phase points at (plan Test Strategy) — the "declared
   * target" arm (ADR-005 §10.2 Invariant 4 / §11). Existence-based. */
  declaredTargets?: string[];
}): boolean {
  const {
    sourceFiles,
    mentionedTests,
    testExt,
    fileExists,
    testsTreeFiles,
    declaredTargets,
  } = opts;

  if (sourceFiles.length === 0) return true; // nothing to gate

  // 0. A declared target only counts if it exists AND is a real test file.
  if ((declaredTargets ?? []).some((t) => fileExists(t) && isTestFile(t, testExt)))
    return true;

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
