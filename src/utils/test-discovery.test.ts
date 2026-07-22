/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { phaseHasTests } from "./test-discovery.js";

const exists = (set: string[]) => (p: string) => set.includes(p);

describe("phaseHasTests (FR-008 — existence-based, profile-aware discovery)", () => {
  it("blocks when source files exist but no test does", () => {
    expect(
      phaseHasTests({
        sourceFiles: ["src/lib/db/auth.js"],
        mentionedTests: [],
        testExt: ".test.js",
        fileExists: exists([]),
        testsTreeFiles: [],
      }),
    ).toBe(false);
  });

  it("a MENTIONED test that does not exist does NOT satisfy the gate", () => {
    expect(
      phaseHasTests({
        sourceFiles: ["src/lib/db/auth.js"],
        mentionedTests: ["tests/auth/auth.test.js"], // referenced but absent
        testExt: ".test.js",
        fileExists: exists([]),
        testsTreeFiles: [],
      }),
    ).toBe(false);
  });

  it("a mentioned test that EXISTS satisfies the gate", () => {
    expect(
      phaseHasTests({
        sourceFiles: ["src/lib/db/auth.js"],
        mentionedTests: ["tests/auth/auth.test.js"],
        testExt: ".test.js",
        fileExists: exists(["tests/auth/auth.test.js"]),
        testsTreeFiles: [],
      }),
    ).toBe(true);
  });

  it("a co-located test satisfies the gate", () => {
    expect(
      phaseHasTests({
        sourceFiles: ["src/lib/db/auth.js"],
        mentionedTests: [],
        testExt: ".test.js",
        fileExists: exists(["src/lib/db/auth.test.js"]),
        testsTreeFiles: [],
      }),
    ).toBe(true);
  });

  it("a matching basename under a tests/ tree satisfies the gate (no false block)", () => {
    expect(
      phaseHasTests({
        sourceFiles: ["src/lib/db/auth.js"],
        mentionedTests: [],
        testExt: ".test.js",
        fileExists: exists([]),
        testsTreeFiles: ["tests/db/auth.test.js"],
      }),
    ).toBe(true);
  });

  it("no source files ⇒ not blocked (nothing to gate)", () => {
    expect(
      phaseHasTests({
        sourceFiles: [],
        mentionedTests: [],
        testExt: ".test.js",
        fileExists: exists([]),
        testsTreeFiles: [],
      }),
    ).toBe(true);
  });
});
