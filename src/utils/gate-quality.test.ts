/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { isHollowGate, unauthoredGate } from "./gate-quality.js";

describe("isHollowGate (FR-001 — no file-existence-only gates)", () => {
  it("flags a gate whose only assertion is test -f", () => {
    expect(isHollowGate("#!/bin/bash\ntest -f src/foo.ts")).toBe(true);
  });

  it("flags [ -f ... ] existence checks", () => {
    expect(isHollowGate("[ -f src/foo.ts ]")).toBe(true);
  });

  it("passes a gate with a functional assertion alongside test -f", () => {
    expect(
      isHollowGate("test -f src/foo.ts\npnpm vitest run src/foo.test.ts"),
    ).toBe(false);
  });

  it("ignores comments, set, and echo lines when judging", () => {
    const g = '#!/bin/bash\nset -euo pipefail\necho "checking"\ntest -f src/foo.ts';
    expect(isHollowGate(g)).toBe(true);
  });

  it("does not flag an honest failing gate (echo + exit 1)", () => {
    expect(isHollowGate('echo "FAIL: no test for src/foo.ts"\nexit 1')).toBe(false);
  });

  it("does not flag an empty/comment-only script", () => {
    expect(isHollowGate("#!/bin/bash\n# nothing here")).toBe(false);
  });

  it("flags an echo-only gate (does nothing but print) — the auto-pass vector", () => {
    expect(isHollowGate('#!/bin/bash\necho "Phase 1: Schema ✅ SHIPPED"')).toBe(true);
  });

  it("does not flag a gate that echoes AND runs a real assertion", () => {
    expect(
      isHollowGate('echo "running"\nmake test:db\necho "PASS"'),
    ).toBe(false);
  });

  it("does not flag a single-line echo that forces a non-zero exit (honest fail)", () => {
    // `echo "..."; exit 1` can never pass — it's an honest failing gate, not a
    // hollow one, even though the line begins with `echo`.
    expect(isHollowGate('echo "FAIL: no test for src/foo.ts"; exit 1')).toBe(false);
  });

  it("does not flag the honest-failing gate that unauthoredGate emits", () => {
    // The exact string plan-to-tasks writes for a source file with no test.
    expect(isHollowGate(unauthoredGate("src/foo.ts"))).toBe(false);
  });
});
