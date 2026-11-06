/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import {
  getColocatedTestCandidates,
  isPolyglotTestFile,
  normalizeTestStem,
} from "../ports/toolchain-port.js";

/**
 * The one definition of "what is a test file" (FR-003, TC-005). Returns true when
 * the path matches polyglot test naming rules or — when a dedicated profile test
 * extension is supplied — the path ends with that `testExt`. Pure path/regex
 * check; never invokes a binary (TC-006).
 */
export function isTestFile(relPath: string, testExt?: string): boolean {
  return isPolyglotTestFile(relPath, testExt);
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
      const rel = path.relative(cwd, full).replace(/\\/g, "/");
      if (e.isDirectory()) walk(full);
      else if (isTestFile(rel)) {
        out.push(rel);
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

/**
 * Return the test files that cover a phase's source files: existing mentioned
 * tests, co-located tests, and out-of-tree tests/ suites matched by source
 * basename.
 */
export function discoverTestsForSources(opts: {
  sourceFiles: string[];
  mentionedTests: string[];
  testExt: string;
  fileExists: (relPath: string) => boolean;
  testsTreeFiles: string[];
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
    for (const candidate of getColocatedTestCandidates(src, testExt)) {
      if (fileExists(candidate)) found.add(candidate);
    }
  }

  const sourceBases = new Set(
    sourceFiles.map((s) => path.basename(s).replace(/\.[^/.]+$/, "")),
  );
  for (const t of testsTreeFiles) {
    const base = normalizeTestStem(t);
    if (sourceBases.has(base)) found.add(t);
  }

  return [...found];
}

/**
 * FR-008 (ADR-005 §10.2.4): decide whether a phase has real test coverage.
 */
export function phaseHasTests(opts: {
  sourceFiles: string[];
  mentionedTests: string[];
  testExt: string;
  fileExists: (relPath: string) => boolean;
  testsTreeFiles: string[];
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
  if (
    (declaredTargets ?? []).some((t) => fileExists(t) && isTestFile(t, testExt))
  )
    return true;

  // 1. A mentioned test only counts if it actually exists.
  if (mentionedTests.some((t) => fileExists(t))) return true;

  // 2. Co-located test next to a source file.
  const colocated = sourceFiles.some((src) =>
    getColocatedTestCandidates(src, testExt).some((candidate) =>
      fileExists(candidate),
    ),
  );
  if (colocated) return true;

  // 3. A basename match anywhere under a tests/ tree.
  const sourceBases = new Set(
    sourceFiles.map((src) => path.basename(src).replace(/\.[^/.]+$/, "")),
  );
  const treeMatch = testsTreeFiles.some((t) => {
    const base = normalizeTestStem(t);
    return sourceBases.has(base);
  });
  return treeMatch;
}
