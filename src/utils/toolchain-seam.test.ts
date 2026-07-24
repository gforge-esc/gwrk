/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectProfile } from "../engine/profile-detector.js";
import { getTestExtension } from "./toolchain-mapper.js";
import { listTestsTree, phaseHasTests } from "./test-discovery.js";

/**
 * TR-004 (021 FR-002/FR-006) — SEAM test.
 *
 * Drives the REAL resolver chain `detectProfile → getTestExtension → phaseHasTests`
 * for a JavaScript project with NO injected extension. This is the coverage the
 * prior unit tests bypassed by hand-passing `testExt: ".test.js"` — the exact hole
 * that let `getTestExtension` ship with no JS branch and blocked `gwrk ship` on a
 * phase whose co-located `.test.js` existed.
 */
describe("SEAM: detectProfile → getTestExtension → phaseHasTests (JavaScript)", () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-seam-js-"));
    // A plain JS project (no typescript dep, no pnpm-lock → detected as JavaScript).
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "seam-js-fixture", scripts: { test: "vitest run" } }),
    );
    fs.writeFileSync(
      path.join(dir, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "seam-js-fixture", stack: { language: "JavaScript" } } }),
    );
    fs.mkdirSync(path.join(dir, "src", "config"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "config", "env.js"), "export const x = 1;\n");
    fs.writeFileSync(path.join(dir, "src", "config", "env.test.js"), "test('x', () => {});\n");
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("resolves the JS test extension and discovers the co-located .test.js (no [BLOCKED])", async () => {
    const profile = await detectProfile(dir);
    const testExt = getTestExtension(profile);
    expect(testExt).toBe(".test.js"); // was ".test.ts" — the bug

    const hasTests = phaseHasTests({
      sourceFiles: ["src/config/env.js"],
      mentionedTests: [],
      testExt,
      fileExists: (rel) => fs.existsSync(path.join(dir, rel)),
      testsTreeFiles: listTestsTree(dir),
    });
    expect(hasTests).toBe(true); // co-located env.test.js is now visible
  });
});
