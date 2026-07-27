/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 023-plan-format-contract — Phase 3 (`define plan` self-validation).
 *
 * RED tests for FR-006 / US-006 (TR-005, TR-007 negative arm). The plan-gate
 * validator does not exist yet, so importing it is the intended RED state; the
 * implementing agent creates `src/engine/plan-gate-validator.ts`.
 *
 * Named `-t` targets (per US-006 acceptance scenarios):
 *   - "passes on executable gates"
 *   - "fails on stub-gate phase"
 *
 * 024-gate-assertion-contract — Phase 2 (`define plan` output-as-pass lint).
 *
 * Adds RED tests for FR-003 / US-003 (TR-003 positive, TR-004 negative, TR-005
 * SEAM). The FR-003 lint — an additive extension of `validatePlanGates` — must
 * flag a source-bearing phase whose fenced-bash `#### Done When` pipes the
 * command under test into `grep -q` (output-as-pass), carrying `kind:
 * "output-as-pass"` and the `offendingLine`, while NOT false-failing legitimate
 * exit-based commands or a file-argument `grep -q <pattern> <file>`. RED until
 * the implementing agent extends the validator + `define-plan.ts` message
 * mapping (contract §2, §3).
 *
 * Named `-t` targets (per US-003 acceptance scenarios):
 *   - "rejects output-as-pass Done-When"
 *   - "accepts exit-based and file grep"
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
// RED: this module is created by the implementing agent (contract §2).
import { validatePlanGates } from "../engine/plan-gate-validator.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const FIXTURES = path.join(REPO_ROOT, "specs", "_fixtures", "plan-format");
// 024 FR-003 fixtures (committed, deterministic, network-free — TC-001).
const GATE_ASSERTION_FIXTURES = path.join(
  REPO_ROOT,
  "specs",
  "_fixtures",
  "gate-assertion",
);

const tmpDirs: string[] = [];

/** Copy a fixture plan.md into a fresh temp feature dir for validation. */
function validateFixture(name: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-define-plan-"));
  tmpDirs.push(tmp);
  fs.copyFileSync(path.join(FIXTURES, name), path.join(tmp, "plan.md"));
  return validatePlanGates(tmp, "plan-format-fixture");
}

/** Copy a 024 gate-assertion fixture plan.md into a fresh temp feature dir. */
function validateGateAssertionFixture(name: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-define-plan-024-"));
  tmpDirs.push(tmp);
  fs.copyFileSync(
    path.join(GATE_ASSERTION_FIXTURES, name),
    path.join(tmp, "plan.md"),
  );
  return validatePlanGates(tmp, "gate-assertion-fixture");
}

/**
 * 024 extends `PlanGateViolation` (contract §2) with a `kind` discriminator and
 * an optional `offendingLine`. Typed loosely here so these RED assertions
 * transpile before the engine adds the fields (the field access is `undefined`
 * at runtime pre-implementation → the assertions fail for the RIGHT reason).
 */
type Violation024 = {
  phaseId: string;
  title: string;
  gateScript: string;
  kind?: "hollow" | "output-as-pass";
  offendingLine?: string;
};

/** The exact data-dashboard `002-metric-model` phase-03 false-green line. */
const OUTPUT_AS_PASS_LINE = "make test:db 2>&1 | grep -q 'db/definitions'";

/** Write arbitrary plan.md content into a fresh temp feature dir. */
function tmpFeatureDir(planContent: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-define-plan-"));
  tmpDirs.push(tmp);
  fs.writeFileSync(path.join(tmp, "plan.md"), planContent, "utf-8");
  return tmp;
}

afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("FR-006: validatePlanGates", () => {
  it("passes on executable gates", () => {
    // Every source-bearing phase has a fenced-bash executable gate.
    const report = validateFixture("plan.md");
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it("fails on stub-gate phase", () => {
    // Phase 3 is source-bearing but its Done-When is prose only → hollow stub.
    const report = validateFixture("plan-stub.md");
    expect(report.ok).toBe(false);

    const flagged = report.violations.map((v) => v.phaseId);
    // The offending phase is named (error-as-navigation).
    expect(flagged).toContain("phase-03");
  });

  it("does not flag an honest failing (exit 1) gate as a stub", () => {
    // Phase 2's Done-When is `echo …; exit 1` — an honest RED gate, NOT hollow.
    const report = validateFixture("plan-stub.md");
    const flagged = report.violations.map((v) => v.phaseId);
    expect(flagged).not.toContain("phase-02"); // unauthoredGate exemption
    expect(flagged).not.toContain("phase-01"); // executable gate, valid
  });

  it("reports phaseId, title and gateScript for each violation", () => {
    const report = validateFixture("plan-stub.md");
    const violation = report.violations.find((v) => v.phaseId === "phase-03");
    expect(violation).toBeDefined();
    expect(typeof violation?.title).toBe("string");
    expect(violation?.title.length).toBeGreaterThan(0);
    expect(typeof violation?.gateScript).toBe("string");
  });

  it("surfaces `No phases found` on an unparseable plan", () => {
    // FR-006 Error States: a plan with no `### Phase N` headings surfaces the
    // existing fatal parser error (exit 1) rather than passing silently.
    const dir = tmpFeatureDir("# Title only\n\nJust prose, no phases.\n");
    expect(() => validatePlanGates(dir, "empty")).toThrow(/No phases found/);
  });
});

describe("FR-006: define plan integration wiring (source contract)", () => {
  // The command must run the validator after generation and fail loudly with a
  // corrective message that cites the CURRENT grounding brief (023), not the
  // stale pre-renumber 022 reference (spec §4 FR-006 note / plan Phase 3).
  const definePlanSrc = fs.readFileSync(
    path.join(REPO_ROOT, "src", "commands", "define-plan.ts"),
    "utf-8",
  );

  it("wires validatePlanGates into `define plan`", () => {
    expect(definePlanSrc).toMatch(/validatePlanGates/);
  });

  it("cites the 023 grounding brief and not the stale 022 reference", () => {
    expect(definePlanSrc).toContain(
      "docs/grounding/023-plan-format-contract.md",
    );
    expect(definePlanSrc).not.toContain("022-plan-format-contract");
    expect(definePlanSrc).toMatch(/resolves to a stub gate/);
  });
});

describe("FR-003: define plan rejects the output-as-pass antipattern", () => {
  it("rejects output-as-pass Done-When", () => {
    // TR-003: Phase 3's fenced-bash Done-When pipes the command under test into
    // `grep -q`. Under Layer 2 (set -e, no pipefail) only the trailing grep -q
    // decides pass/fail, so a failing `make test:db` still reports PASS. The
    // FR-003 lint must reject it and name the phase AND the offending line.
    const report = validateGateAssertionFixture("plan-output-as-pass.md");
    expect(report.ok).toBe(false);

    const violations = report.violations as Violation024[];
    const violation = violations.find((v) => v.phaseId === "phase-03");
    expect(violation).toBeDefined();
    // error-as-navigation: the phase is named, the kind is discriminated, and
    // the offending Done-When line is carried verbatim (contract §2).
    expect(violation?.kind).toBe("output-as-pass");
    expect(violation?.offendingLine).toBe(OUTPUT_AS_PASS_LINE);
  });

  it("accepts exit-based and file grep", () => {
    // TR-004 (negative regression guard): a plan whose Done-When asserts
    // exit-based (`make test:db`, `pnpm vitest run x.test.ts`) and separately
    // uses a FILE-argument `grep -q 'schemaVersion' package.json` (no pipe from
    // a command) MUST NOT be flagged. The detection shape requires a leading
    // `|`, so a bare file grep and exit-based commands never match.
    const report = validateGateAssertionFixture("plan-exit-based.md");
    expect(report.ok).toBe(true);

    const violations = report.violations as Violation024[];
    const outputAsPass = violations.filter((v) => v.kind === "output-as-pass");
    expect(outputAsPass).toEqual([]);
  });

  it("rejects the 002-metric-model false-green SEAM case", () => {
    // TR-005 (SEAM): the EXACT `make test:db 2>&1 | grep -q 'db/definitions'`
    // case that PASSES under Layer 2 `set -e` execution — because on failure the
    // path `db/definitions` appears in make's error text, so `grep -q` matches —
    // is the Layer-3 gap. Define-time linting is the coverage that would have
    // caught this false-green after Layers 1 (extraction) and 2 (execution) both
    // did their jobs.
    const report = validateGateAssertionFixture("plan-output-as-pass.md");
    expect(report.ok).toBe(false);

    const violations = report.violations as Violation024[];
    const offenders = violations
      .filter((v) => v.kind === "output-as-pass")
      .map((v) => v.offendingLine);
    expect(offenders).toContain(OUTPUT_AS_PASS_LINE);
  });
});

describe("FR-003: define plan output-as-pass message wiring (source contract)", () => {
  // The command must map an `output-as-pass` violation to the FR-003 corrective
  // message (contract §3) — distinct from the 023 hollow-stub message — and cite
  // THIS feature's spec, so the error-as-navigation names the remediation.
  const definePlanSrc = fs.readFileSync(
    path.join(REPO_ROOT, "src", "commands", "define-plan.ts"),
    "utf-8",
  );

  it("branches the violation message by kind for output-as-pass", () => {
    // Discriminates on the new `kind` and emits the FR-003 remediation text.
    expect(definePlanSrc).toMatch(/output-as-pass/);
    expect(definePlanSrc).toMatch(/asserts on output, not exit/);
  });

  it("cites the 024 spec in the output-as-pass remediation", () => {
    expect(definePlanSrc).toContain(
      "specs/024-gate-assertion-contract/spec.md",
    );
  });
});
