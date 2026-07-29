/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import {
  getPhaseVerificationGate,
  isHollowGate,
  isUnauthoredGate,
  unauthoredGate,
} from "./gate-quality.js";

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

describe("isUnauthoredGate", () => {
  it("flags the unauthored placeholder gate", () => {
    expect(isUnauthoredGate(unauthoredGate("src/config/env.js"))).toBe(true);
  });
  it("does not flag a real authored gate", () => {
    expect(isUnauthoredGate("make test:db\nmake config:inspect")).toBe(false);
  });
});

describe("getPhaseVerificationGate (026 — the one gate-resolution port)", () => {
  it("returns the single authored task.gateScript (the fenced Done-When)", () => {
    // Canonical shape: the fenced block is copied onto every task's gateScript.
    const gate = 'grep -q "listByLifecycle" src/lib/db/definitions.js\nmake test:db';
    const phase = {
      tasks: [
        { gateScript: gate },
        { gateScript: gate },
      ],
    };
    expect(getPhaseVerificationGate(phase)).toBe(gate);
  });

  it("falls back to prose doneWhen when no authored task gate exists", () => {
    const phase = {
      tasks: [
        {
          gateScript:
            'echo "FAIL: no test maps to src/x.js — author one (FR-001, ADR-005 §10)"; exit 1',
        },
      ],
      doneWhen: ["make config:inspect | tail -1 | grep -q PASSED"],
    };
    expect(getPhaseVerificationGate(phase)).toBe(
      "make config:inspect | tail -1 | grep -q PASSED",
    );
  });

  it("returns null when the only gate is a hollow echo-only stub", () => {
    const phase = { tasks: [{ gateScript: 'echo "Phase 1: config"' }] };
    expect(getPhaseVerificationGate(phase)).toBeNull();
  });

  it("returns null when the only gate is the unauthored placeholder", () => {
    const phase = {
      tasks: [{ gateScript: unauthoredGate("src/config/env.js") }],
    };
    expect(getPhaseVerificationGate(phase)).toBeNull();
  });
});
