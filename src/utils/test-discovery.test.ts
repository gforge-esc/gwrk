/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { phaseHasTests, discoverTestsForSources } from "./test-discovery.js";

const exists = (set: string[]) => (p: string) => set.includes(p);

describe("discoverTestsForSources (T3 discovery — returns the actual test files)", () => {
  it("returns a co-located test that exists", () => {
    expect(
      discoverTestsForSources({
        sourceFiles: ["src/config/env.js"],
        mentionedTests: [],
        testExt: ".test.js",
        fileExists: exists(["src/config/env.test.js"]),
        testsTreeFiles: [],
      }),
    ).toEqual(["src/config/env.test.js"]);
  });

  it("returns an out-of-tree test whose basename matches a source", () => {
    expect(
      discoverTestsForSources({
        sourceFiles: ["src/lib/db/auth.js"],
        mentionedTests: [],
        testExt: ".test.js",
        fileExists: exists([]),
        testsTreeFiles: ["tests/db/auth.test.js", "tests/db/other.test.js"],
      }),
    ).toEqual(["tests/db/auth.test.js"]);
  });

  it("returns an existing mentioned test", () => {
    expect(
      discoverTestsForSources({
        sourceFiles: ["src/lib/db/auth.js"],
        mentionedTests: ["tests/auth/auth.test.js"],
        testExt: ".test.js",
        fileExists: exists(["tests/auth/auth.test.js"]),
        testsTreeFiles: [],
      }),
    ).toEqual(["tests/auth/auth.test.js"]);
  });

  it("returns empty when nothing maps", () => {
    expect(
      discoverTestsForSources({
        sourceFiles: ["src/lib/db/auth.js"],
        mentionedTests: [],
        testExt: ".test.js",
        fileExists: exists([]),
        testsTreeFiles: ["tests/db/unrelated.test.js"],
      }),
    ).toEqual([]);
  });
});

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

describe("declared targets (021 FR-005 / ADR-005 §10.2 Invariant 4)", () => {
  it("discoverTestsForSources includes an existing declared target with no basename match", () => {
    expect(
      discoverTestsForSources({
        sourceFiles: ["src/lib/auth/session.js"],
        mentionedTests: [],
        testExt: ".test.js",
        fileExists: exists(["tests/auth/human-flow.test.js"]),
        // basename 'human-flow' ≠ source 'session' → tree match misses; declared target rescues it
        testsTreeFiles: ["tests/auth/human-flow.test.js"],
        declaredTargets: ["tests/auth/human-flow.test.js"],
      }),
    ).toContain("tests/auth/human-flow.test.js");
  });

  it("phaseHasTests: an existing declared target satisfies the gate (no false block)", () => {
    expect(
      phaseHasTests({
        sourceFiles: ["src/lib/auth/session.js"],
        mentionedTests: [],
        testExt: ".test.js",
        fileExists: exists(["tests/auth/human-flow.test.js"]),
        testsTreeFiles: [],
        declaredTargets: ["tests/auth/human-flow.test.js"],
      }),
    ).toBe(true);
  });

  it("phaseHasTests: a declared target that does NOT exist does not satisfy (existence-based)", () => {
    expect(
      phaseHasTests({
        sourceFiles: ["src/lib/auth/session.js"],
        mentionedTests: [],
        testExt: ".test.js",
        fileExists: exists([]),
        testsTreeFiles: [],
        declaredTargets: ["tests/auth/missing.test.js"],
      }),
    ).toBe(false);
  });
});
