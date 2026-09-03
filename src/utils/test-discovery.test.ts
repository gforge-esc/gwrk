/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import {
  phaseHasTests,
  discoverTestsForSources,
  isTestFile,
} from "./test-discovery.js";

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

// ─────────────────────────────────────────────────────────────────────────────
// 025-gate-only-phases — Fix A: test-discovery classifies only real test files.
// The plan's Test-Strategy → Target column names the file a gate *asserts about*
// (`.env.example`, `prisma/schema.prisma`) — NOT a runnable test. A declared
// target must be an actual test file before it counts as discovered coverage.
// ─────────────────────────────────────────────────────────────────────────────

describe("FR-003 (US-001, US-002): isTestFile — the single test-file predicate (TC-005)", () => {
  it("isTestFile recognizes multi-language test basenames", () => {
    // Basenames matching /\.(test|spec)\.[jt]s$|_test\.(go|py)$|test_.*\.py$/.
    expect(isTestFile("src/config/env.test.ts")).toBe(true);
    expect(isTestFile("src/config/env.test.js")).toBe(true);
    expect(isTestFile("src/config/env.spec.ts")).toBe(true);
    expect(isTestFile("src/config/env.spec.js")).toBe(true);
    expect(isTestFile("pkg/handler_test.go")).toBe(true);
    expect(isTestFile("pkg/handler_test.py")).toBe(true);
    expect(isTestFile("pkg/test_handler.py")).toBe(true);
  });

  it("isTestFile matches the profile testExt when the basename regex misses", () => {
    // A behavior-named suite whose basename the regex misses is still a test file
    // when its path ends with the profile's declared testExt (US-002).
    expect(isTestFile("tests/auth/human-flow.suite.mjs", ".suite.mjs")).toBe(true);
    expect(isTestFile("tests/auth/human-flow.suite.mjs")).toBe(false);
  });

  it("isTestFile rejects config / schema / migration files", () => {
    // The Run #2207 offenders — none of these are runnable tests.
    expect(isTestFile(".env.example")).toBe(false);
    expect(isTestFile("prisma/schema.prisma")).toBe(false);
    expect(isTestFile("config.yaml")).toBe(false);
    // A non-test path is not rescued by supplying a testExt it does not end with.
    expect(isTestFile(".env.example", ".test.js")).toBe(false);
    expect(isTestFile("prisma/schema.prisma", ".test.ts")).toBe(false);
  });
});

describe("FR-001 (US-001): discoverTestsForSources drops non-test declared targets", () => {
  it("drops a non-test declared target", () => {
    // TR-001 — `.env.example` exists but is not a test file → excluded.
    expect(
      discoverTestsForSources({
        sourceFiles: [],
        mentionedTests: [],
        testExt: ".test.js",
        fileExists: exists([".env.example"]),
        testsTreeFiles: [],
        declaredTargets: [".env.example"],
      }),
    ).toEqual([]);
  });

  it("drops an existing prisma schema declared target", () => {
    expect(
      discoverTestsForSources({
        sourceFiles: [],
        mentionedTests: [],
        testExt: ".test.js",
        fileExists: exists(["prisma/schema.prisma"]),
        testsTreeFiles: [],
        declaredTargets: ["prisma/schema.prisma"],
      }),
    ).not.toContain("prisma/schema.prisma");
  });

  it("still includes a real declared test (021 FR-005 arm not regressed)", () => {
    // Guard: Fix A must NOT drop a legitimate declared test file.
    expect(
      discoverTestsForSources({
        sourceFiles: [],
        mentionedTests: [],
        testExt: ".test.js",
        fileExists: exists(["tests/auth/human-flow.test.js"]),
        testsTreeFiles: [],
        declaredTargets: ["tests/auth/human-flow.test.js"],
      }),
    ).toContain("tests/auth/human-flow.test.js");
  });

  it("keeps a co-located real test, drops the config target", () => {
    // TR-003 (mixed) — the config target vanishes, the real co-located test survives.
    const result = discoverTestsForSources({
      sourceFiles: ["src/config/env.js"],
      mentionedTests: [],
      testExt: ".test.js",
      fileExists: exists([".env.example", "src/config/env.test.js"]),
      testsTreeFiles: [],
      declaredTargets: [".env.example"],
    });
    expect(result).toContain("src/config/env.test.js");
    expect(result).not.toContain(".env.example");
  });
});

describe("FR-002 (US-001): phaseHasTests does not count non-test declared targets as coverage", () => {
  it("a non-test declared target does not satisfy the gate", () => {
    // TR-002 — `schema.prisma` exists but is not a test file → does not count.
    expect(
      phaseHasTests({
        sourceFiles: ["src/db/schema.js"],
        mentionedTests: [],
        testExt: ".test.js",
        fileExists: exists(["schema.prisma"]),
        testsTreeFiles: [],
        declaredTargets: ["schema.prisma"],
      }),
    ).toBe(false);
  });

  it("a real declared test still satisfies the gate (existence semantics preserved)", () => {
    // Guard: a real, existing declared test still registers as coverage.
    expect(
      phaseHasTests({
        sourceFiles: ["src/db/schema.js"],
        mentionedTests: [],
        testExt: ".test.js",
        fileExists: exists(["tests/x.test.js"]),
        testsTreeFiles: [],
        declaredTargets: ["tests/x.test.js"],
      }),
    ).toBe(true);
  });
});
