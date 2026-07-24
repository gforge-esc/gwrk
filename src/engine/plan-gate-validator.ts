/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import { isHollowGate } from "../utils/gate-quality.js";
import { parsePlanMarkdown } from "./plan-to-tasks.js";
import type { ProjectProfile } from "./prompt-conditioner.js";

/**
 * FR-006 self-validation for `gwrk define plan` (contract §2).
 *
 * After the orchestrator produces `plan.md`, this deterministic verifier parses
 * it via the SAME `parsePlanMarkdown` the generator uses (TC-005, single source
 * of truth) and, for every source-bearing phase, checks that the resolved phase
 * gate is not a hollow stub per ADR-005 §10 `isHollowGate`. No network, no DB
 * (TC-001) — pure over the plan text.
 */

/** One source-bearing phase whose resolved gate is a hollow stub. */
export interface PlanGateViolation {
  /** e.g. "phase-03" */
  phaseId: string;
  /** phase title */
  title: string;
  /** the resolved (hollow) gate */
  gateScript: string;
}

export interface PlanGateReport {
  /** true when every source-bearing phase has a non-hollow gate */
  ok: boolean;
  /** one per source-bearing phase resolving to a stub */
  violations: PlanGateViolation[];
}

/**
 * Parse `<featureDir>/plan.md` and flag every source-bearing phase that resolves
 * to a hollow stub gate.
 *
 * A phase is **source-bearing** when it declares ≥1 file line AND/OR a
 * `#### Done When` section (fenced-bash gate or prose bullets). Its **resolved
 * gate** is the fenced-bash `#### Done When` block when present (the executable
 * gate the generator compiles, FR-001); absent one, the phase falls back to the
 * `echo "Phase N: <title>"` stub the generator emits as its last resort — a gate
 * that exits 0 without exercising behavior. `isHollowGate` is the FR-006
 * predicate: an honest failing gate (`unauthoredGate`, `exit 1`) is NOT hollow
 * and MUST NOT be flagged.
 *
 * @param featureDir directory containing `plan.md`
 * @param featureId the feature id (reserved for provenance parity with `planToTasks`)
 * @param opts.profile reserved for parity with `planToTasks` gate resolution;
 *        the FR-006 check is phase-gate-level and does not depend on it.
 * @throws when `plan.md` is missing, or when it has no `### Phase N` headings
 *         (FR-006 Error State: the existing `No phases found…` fatal surfaces).
 */
export function validatePlanGates(
  featureDir: string,
  featureId: string,
  opts: { profile?: ProjectProfile } = {},
): PlanGateReport {
  void featureId;
  void opts;

  const planPath = path.join(featureDir, "plan.md");
  if (!fs.existsSync(planPath)) {
    throw new Error(`Plan not found at ${planPath}`);
  }

  const planContent = fs.readFileSync(planPath, "utf-8");
  const parsed = parsePlanMarkdown(planContent);

  // FR-006 Error State: an unparseable plan (no phases) surfaces the same fatal
  // error `planToTasks` raises, rather than passing validation silently.
  if (parsed.length === 0) {
    throw new Error(
      `No phases found in ${planPath}. Expected '### Phase N: Title' headings.`,
    );
  }

  const violations: PlanGateViolation[] = [];

  for (const phase of parsed) {
    const hasDoneWhen =
      phase.gateScript !== undefined || phase.doneWhen.length > 0;
    const sourceBearing = phase.files.length > 0 || hasDoneWhen;
    if (!sourceBearing) continue;

    // Resolve the phase gate exactly as `generateTaskState` does: a fenced-bash
    // `#### Done When` block IS the executable gate; without one the phase
    // resolves to the hollow `echo "Phase N: <title>"` last-resort stub.
    const resolvedGate =
      phase.gateScript ?? `echo "Phase ${phase.number}: ${phase.title}"`;

    if (isHollowGate(resolvedGate)) {
      violations.push({
        phaseId: `phase-${String(phase.number).padStart(2, "0")}`,
        title: phase.title,
        gateScript: resolvedGate,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}
