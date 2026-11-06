/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";

/**
 * Deterministic test activator for phase-isolated test generation.
 *
 * When `define tests` generates RED tests for future phases, those tests
 * use `it.skip(` / `describe.skip(` and include a `@phase N` docblock tag.
 * This function activates (un-skips) tests for the given phase.
 *
 * Idempotent — running on already-active tests is a no-op.
 */
export function activatePhaseTests(
  cwd: string,
  phaseId: string,
  testFiles: string[],
): { activated: number; files: string[] } {
  const phaseNum = phaseId.replace("phase-", "");
  const phaseNumInt = Number.parseInt(phaseNum, 10);
  let activated = 0;
  const touchedFiles: string[] = [];

  for (const testFile of testFiles) {
    const filePath = path.join(cwd, testFile);
    if (!fs.existsSync(filePath)) continue;

    let content = fs.readFileSync(filePath, "utf-8");

    // Only activate files tagged with the matching @phase
    const hasPhaseTag =
      content.includes(`@phase ${phaseNum}`) ||
      content.includes(`@phase ${phaseNumInt}`);
    if (!hasPhaseTag) continue;

    const before = content;
    // Activate TS/JS: it.skip( → it( and describe.skip( → describe(
    content = content.replace(/\bit\.skip\(/g, "it(");
    content = content.replace(/\bdescribe\.skip\(/g, "describe(");
    // Activate Python: @pytest.mark.skip(...) or @unittest.skip(...)
    content = content.replace(
      /^\s*@pytest\.mark\.skip(?:\([^)]*\))?\s*\n/gm,
      "",
    );
    content = content.replace(/^\s*@unittest\.skip(?:\([^)]*\))?\s*\n/gm, "");
    // Activate Rust: #[ignore] or #[ignore = "..."]
    content = content.replace(/^\s*#\[ignore(?:\s*=\s*"[^"]*")?\]\s*\n/gm, "");
    // Activate Go: t.Skip(...) / t.SkipNow()
    content = content.replace(/^\s*t\.Skip(?:Now|f)?\([^)]*\)\s*\n/gm, "");
    // Update tag: @status red → @status active
    content = content.replace(/@status red/g, "@status active");

    if (content !== before) {
      fs.writeFileSync(filePath, content);
      activated++;
      touchedFiles.push(testFile);
    }
  }

  return { activated, files: touchedFiles };
}
