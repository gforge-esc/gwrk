/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import path from "node:path";

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
