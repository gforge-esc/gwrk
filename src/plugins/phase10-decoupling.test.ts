/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    if (fs.statSync(path.join(dirPath, file)).isDirectory()) {
      arrayOfFiles = getAllFiles(path.join(dirPath, file), arrayOfFiles);
    } else {
      arrayOfFiles.push(path.join(dirPath, file));
    }
  });

  return arrayOfFiles;
}

/**
 * Phase 10: .agents/ Runtime Decoupling
 * Verified by checking all source files for hardcoded .agents/ paths.
 */
describe("Phase 10: .agents/ Runtime Decoupling", () => {
  it("should not contain any hardcoded .agents/ filesystem paths in src/", () => {
    const srcDir = path.join(process.cwd(), "src");
    const allFiles = getAllFiles(srcDir);
    const files = allFiles.filter(f => f.endsWith(".ts"));

    const forbiddenPattern = /\.agents\//;
    const violations: string[] = [];

    for (const file of files) {
      // Skip all test files (they are allowed to check for the pattern)
      if (file.endsWith(".test.ts")) continue;
      if (file.endsWith("migrate.ts")) continue; // migrate.ts is allowed to reference .agents for migration

      const content = fs.readFileSync(file, "utf-8");
      if (forbiddenPattern.test(content)) {
        violations.push(path.relative(process.cwd(), file));
      }
    }

    expect(violations, `Found hardcoded .agents/ paths in: ${violations.join(", ")}`).toHaveLength(0);
  });
});
