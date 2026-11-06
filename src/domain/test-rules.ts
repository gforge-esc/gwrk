/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import path from "node:path";

const TEST_BASENAME_RE =
  /\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rs)$|^test_.*\.py$/;

const SOURCE_EXT_RE = /\.(?:[cm]?[jt]sx?|py|go|rs)$/;

export function isPolyglotTestFile(filePath: string, testExt?: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const base = path.posix.basename(normalized);
  if (TEST_BASENAME_RE.test(base)) return true;

  if (
    normalized.endsWith(".rs") &&
    (normalized.startsWith("tests/") || normalized.includes("/tests/"))
  ) {
    return true;
  }

  if (
    testExt &&
    testExt !== ".py" &&
    testExt !== ".go" &&
    testExt !== ".rs" &&
    testExt !== ".ts" &&
    testExt !== ".js" &&
    normalized.endsWith(testExt)
  ) {
    return true;
  }

  return false;
}

export function isPolyglotSourceFile(
  filePath: string,
  testExt?: string,
): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (!SOURCE_EXT_RE.test(normalized)) return false;
  if (normalized.endsWith(".d.ts")) return false;
  return !isPolyglotTestFile(normalized, testExt);
}

export function getColocatedTestCandidates(
  srcPath: string,
  testExt: string,
): string[] {
  const normalized = srcPath.replace(/\\/g, "/");
  const dir = path.posix.dirname(normalized);
  const ext = path.posix.extname(normalized);
  const stem = path.posix.basename(normalized, ext);
  const prefix = dir === "." ? "" : `${dir}/`;

  if (ext === ".py" || testExt === ".py") {
    return [`${prefix}test_${stem}.py`, `${prefix}${stem}_test.py`];
  }
  if (ext === ".go" || testExt === "_test.go") {
    return [`${prefix}${stem}_test.go`];
  }
  if (ext === ".rs" || testExt === "_test.rs") {
    return [`${prefix}${stem}_test.rs`, `tests/${stem}.rs`];
  }
  return [`${prefix}${stem}${testExt}`];
}

export function normalizeTestStem(filePath: string): string {
  return path.posix
    .basename(filePath.replace(/\\/g, "/"))
    .replace(/\.[^/.]+$/, "")
    .replace(/(?:\.test|\.spec|_test)$/, "")
    .replace(/^test_/, "");
}
