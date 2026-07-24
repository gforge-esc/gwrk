/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 023-plan-format-contract — Phase 1 (parser grammar alignment).
 *
 * RED tests for the canonical plan-format grammar. Every case drives the
 * public `planToTasks` pipeline over a committed fixture (copied into a fresh
 * temp dir so no `.gwrk/tasks.json` is written into the repo).
 *
 * Traceability: FR-001/US-001 (TR-001, TR-007), FR-002/US-002 (TR-002),
 * FR-003/US-003 (TR-003), FR-004/US-004 (TR-004, TR-008), TC-004, TC-005.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { TaskState } from "../utils/state.js";
import { planToTasks } from "./plan-to-tasks.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const FIXTURES = path.join(REPO_ROOT, "specs", "_fixtures", "plan-format");
const SPECS = path.join(REPO_ROOT, "specs");

const tmpDirs: string[] = [];

/** Copy a fixture plan.md into a fresh temp feature dir and run the pipeline. */
function parseFixture(name: string): TaskState {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-plan-format-"));
  tmpDirs.push(tmp);
  fs.copyFileSync(path.join(FIXTURES, name), path.join(tmp, "plan.md"));
  return planToTasks(tmp, "plan-format-fixture");
}

/** Parse arbitrary plan.md content (used by the all-specs regression sweep). */
function parseContent(content: string): TaskState {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-plan-format-"));
  tmpDirs.push(tmp);
  fs.writeFileSync(path.join(tmp, "plan.md"), content, "utf-8");
  return planToTasks(tmp, "regression-fixture");
}

const ECHO_STUB = /^echo "Phase \d+/;

function echoStubPhaseCount(state: TaskState): number {
  return state.phases.filter(
    (p) => p.tasks.length === 1 && ECHO_STUB.test(p.tasks[0].gateScript),
  ).length;
}

afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("FR-001: fenced-bash Done-When compiles to an executable gate", () => {
  // US-001 / TR-001 / TR-007 (SEAM). Phase 3 = phases[2].
  it("fenced-bash Done-When — phase gate is the block verbatim, not an echo stub", () => {
    const state = parseFixture("plan.md");
    const phase3 = state.phases[2];
    expect(phase3).toBeDefined();

    const gates = phase3.tasks.map((t) => t.gateScript);
    // The fenced-bash body must survive as an executable gate.
    expect(gates.some((g) => g.includes("make test:db"))).toBe(true);
    // ...and MUST NOT be swallowed by the `echo "Phase N"` last-resort stub.
    expect(gates.every((g) => !ECHO_STUB.test(g))).toBe(true);
  });

  it("SEAM: the 002-metric-model phase-03 shape resolves to `make test:db` (TR-007)", () => {
    const state = parseFixture("plan.md");
    const seamGate = state.phases[2].tasks
      .map((t) => t.gateScript)
      .find((g) => g.includes("make test:db"));
    expect(seamGate).toBeDefined();
    // The full command block is preserved verbatim (VR-004).
    expect(seamGate).toContain("make dev:up && make db:migrate && make test:db");
  });
});

describe("FR-002: em-dash file lines are extracted", () => {
  // US-002 / TR-002. Phase 1 is authored entirely in em-dash form.
  it("em-dash file lines — create maps to a new-file task, amend to a modify task", () => {
    const state = parseFixture("plan.md");
    const phase1 = state.phases[0];
    const byTitle = new Map(phase1.tasks.map((t) => [t.title, t]));

    // `create` → parity with the legacy NEW branch (title "Create <basename>", sp 2).
    expect(byTitle.has("Create client.js")).toBe(true);
    expect(byTitle.get("Create client.js")?.sp).toBe(2);

    // `amend` → modify task (title "Modify <basename>", sp 1).
    expect(byTitle.has("Modify models.js")).toBe(true);
    expect(byTitle.get("Modify models.js")?.sp).toBe(1);
  });

  it("em-dash phase does not collapse to the phase-title last-resort task", () => {
    const state = parseFixture("plan.md");
    const phase1 = state.phases[0];

    // Two em-dash file lines → two per-file tasks, never one phase-title stub.
    expect(phase1.tasks).toHaveLength(2);
    expect(phase1.tasks.some((t) => t.title === phase1.title)).toBe(false);
    expect(phase1.tasks.every((t) => !ECHO_STUB.test(t.gateScript))).toBe(true);
  });

  it("malformed file line (neither em-dash nor paren form) is ignored (non-fatal)", () => {
    // FR-002 Error States: an unrecognized `- ` line is dropped, not fatal.
    const content = [
      "### Phase 1: Mixed file lines",
      "",
      "**Files (2):**",
      "- `src/keep.ts` (NEW: kept via paren form)",
      "- this line is not a valid file line at all",
      "",
    ].join("\n");
    const state = parseContent(content);
    expect(state.phases).toHaveLength(1);
    // Only the well-formed paren line yields a task; the garbage line is dropped.
    expect(state.phases[0].tasks).toHaveLength(1);
    expect(state.phases[0].tasks.map((t) => t.title)).toContain("Create keep.ts");
  });
});

describe("FR-003: Type-flexible Test Strategy targets are parsed", () => {
  // US-003 / TR-003.
  it("bracketed Test Strategy type — `[integration]` target lands in phase.testTargets", () => {
    const state = parseFixture("plan.md");
    const phase3 = state.phases[2];
    expect(phase3.testTargets).toBeDefined();
    expect(phase3.testTargets ?? []).toContain("tests/db/definitions.test.js");
  });

  it("bare Test Strategy type — `Unit` still parses (regression lock)", () => {
    // Legacy fixture uses a bare `Unit` type; must keep working (FR-004).
    const state = parseFixture("plan-legacy.md");
    expect(state.phases[0].testTargets ?? []).toContain(
      "src/legacy/parser.test.ts",
    );
  });
});

describe("FR-004: existing ####+prose-bullet plans still parse (backward compatibility)", () => {
  // US-004 / TR-004. Golden values captured from the pre-023 parser — the
  // additive grammar MUST reproduce these exactly.
  it("backward-compatible ####+bullet + paren-form file line parses unchanged", () => {
    const state = parseFixture("plan-legacy.md");

    expect(state.phases).toHaveLength(2);

    const p1 = state.phases[0];
    expect(p1.id).toBe("phase-01");
    expect(p1.title).toBe("Legacy parser support");
    expect(p1.tasks).toHaveLength(1);
    expect(p1.tasks[0].title).toBe("Create parser.ts"); // paren-form NEW → Create
    expect(p1.tasks[0].sp).toBe(2);
    expect(p1.tasks[0].gateScript).toBe(
      "pnpm vitest run src/legacy/parser.test.ts --reporter=verbose",
    );
    expect(p1.doneWhen).toEqual(["All unit tests pass", "Build is clean"]);

    const p2 = state.phases[1];
    expect(p2.id).toBe("phase-02");
    expect(p2.title).toBe("Legacy integration");
    expect(p2.tasks).toHaveLength(1);
    expect(p2.tasks[0].title).toBe("Modify integration.ts"); // paren-form MODIFY → Modify
    expect(p2.tasks[0].sp).toBe(1);
    // Honest unauthored gate (exit 1) — NOT rewritten by the grammar change.
    expect(p2.tasks[0].gateScript).toContain(
      "no test maps to src/legacy/integration.ts",
    );
    expect(p2.tasks[0].gateScript).toMatch(/exit 1/);
  });
});

describe("FR-004 / TC-004: no regression across existing specs (TR-008)", () => {
  // Baseline captured from the pre-023 parser (phase count, echo-stub phase
  // count) for every spec that uses `### Phase N` headings. The additive
  // grammar MUST preserve phase counts and MUST NOT increase echo-stub phases
  // (it may DECREASE them — that is the whole point of the fix, e.g. 023 itself
  // drops from 3 → 0). Two specs are intentionally excluded (no silent cap):
  //   - 000-tdd-infrastructure uses `## Phase` (h2) headings
  //   - 021-polyglot-toolchain uses a single `## Phases` heading
  // Neither has ever matched the `### Phase N: Title` regex; the grammar change
  // does not touch phase-heading parsing, so they remain out of scope here.
  const BASELINE: Record<string, { phases: number; echoStubs: number }> = {
    "001-cli-core": { phases: 18, echoStubs: 6 },
    "002-build-server": { phases: 4, echoStubs: 0 },
    "003-slack": { phases: 3, echoStubs: 0 },
    "004-ship-loop": { phases: 7, echoStubs: 0 },
    "005-parallel-dispatch": { phases: 2, echoStubs: 0 },
    "006-pulse": { phases: 3, echoStubs: 0 },
    "007-effort-compression": { phases: 5, echoStubs: 0 },
    "008-agent-router": { phases: 4, echoStubs: 0 },
    "011-harvest": { phases: 5, echoStubs: 0 },
    "013-agent-native-interface": { phases: 3, echoStubs: 0 },
    "014-plugin-system": { phases: 23, echoStubs: 14 },
    "018-build-plan-orchestrator": { phases: 5, echoStubs: 0 },
    "019-agy-agent-migration": { phases: 2, echoStubs: 0 },
    "020-polyglot-monorepo": { phases: 2, echoStubs: 0 },
    "023-plan-format-contract": { phases: 3, echoStubs: 3 },
  };

  const EXCLUDED = ["000-tdd-infrastructure", "021-polyglot-toolchain"];

  it.each(Object.entries(BASELINE))(
    "%s parses with a stable phase count and no new echo-stub phases",
    (id, expected) => {
      const planPath = path.join(SPECS, id, "plan.md");
      // The fixture is only meaningful if the spec still exists on disk.
      expect(fs.existsSync(planPath)).toBe(true);
      const content = fs.readFileSync(planPath, "utf-8");
      const state = parseContent(content);

      expect(state.phases).toHaveLength(expected.phases);
      // Additive grammar: echo stubs may vanish but must never appear anew.
      expect(echoStubPhaseCount(state)).toBeLessThanOrEqual(expected.echoStubs);
    },
  );

  it.each(EXCLUDED)(
    "%s still throws `No phases found` (non-`### Phase` headings, out of scope)",
    (id) => {
      const planPath = path.join(SPECS, id, "plan.md");
      expect(fs.existsSync(planPath)).toBe(true);
      const content = fs.readFileSync(planPath, "utf-8");
      expect(() => parseContent(content)).toThrow(/No phases found/);
    },
  );
});
