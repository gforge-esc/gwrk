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

const tmpDirs: string[] = [];

/** Copy a fixture plan.md into a fresh temp feature dir for validation. */
function validateFixture(name: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-define-plan-"));
  tmpDirs.push(tmp);
  fs.copyFileSync(path.join(FIXTURES, name), path.join(tmp, "plan.md"));
  return validatePlanGates(tmp, "plan-format-fixture");
}

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
