/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A phase cannot be finished before the work it depends on.
 *
 * `gwrk plan verify` checks specs/ against the graph — membership drift only.
 * Nothing checked the graph against ITSELF, so a phase could read SHIPPED while
 * its predecessors read PLANNED and no command would say a word.
 *
 * That is not hypothetical: `010-reporting-email/phase-01` reads SHIPPED on
 * data-dashboard while all five phases of its declared prerequisite
 * `007-audience-redaction` read PLANNED. `plan init` promotes PLANNED → SHIPPED
 * from ship-run EXISTENCE rather than from a passing gate, so a run that started
 * and died can leave exactly this state — and #167's readiness tightening then
 * releases later phases on the strength of that false SHIPPED.
 *
 * An inversion is always one of two real problems: a status promoted without
 * evidence, or a missing dependency edge. Both are worth a human's attention,
 * and neither is currently reported.
 */

import { describe, expect, it } from "vitest";
import { PlanSolver } from "./plan-solver.js";

const feature = (id: string) => ({
  id,
  name: id,
  status: "PLANNED",
  sp_total: 2,
});

const phase = (id: string, featureId: string, seq: number, status: string) => ({
  id,
  feature_id: featureId,
  name: id,
  status,
  sp_estimate: 2,
  seq,
  health: "CLEAN",
});

/** A → B at feature level, one phase each unless stated. */
function solver(aStatus: string, bStatus: string) {
  return new PlanSolver(
    [feature("A"), feature("B")],
    [phase("A-P1", "A", 1, aStatus), phase("B-P1", "B", 1, bStatus)],
    [{ from_id: "A", to_id: "B", edge_type: "DEPENDS_ON" }],
  );
}

describe("getStatusInversions", () => {
  it("reports a shipped phase whose prerequisite is still planned", () => {
    // The 010-reporting-email / 007-audience-redaction shape exactly.
    const inversions = solver("PLANNED", "SHIPPED").getStatusInversions();

    expect(inversions).toEqual([{ phaseId: "B-P1", blockedBy: ["A-P1"] }]);
  });

  it("reports nothing when the prerequisite is finished too", () => {
    expect(solver("SHIPPED", "SHIPPED").getStatusInversions()).toEqual([]);
  });

  it("reports nothing when the dependent phase is not finished", () => {
    // Unfinished work with unfinished predecessors is the normal mid-plan state.
    expect(solver("PLANNED", "PLANNED").getStatusInversions()).toEqual([]);
  });

  it("accepts every terminal status as satisfying a dependency", () => {
    for (const done of ["DONE", "SHIPPED", "VERIFIED", "CLOSED"]) {
      expect(solver(done, "SHIPPED").getStatusInversions()).toEqual([]);
    }
  });

  it("counts a phase in any non-terminal status as unfinished", () => {
    for (const notDone of ["PLANNED", "IN_PROGRESS", "BLOCKED"]) {
      expect(solver(notDone, "SHIPPED").getStatusInversions()).toEqual([
        { phaseId: "B-P1", blockedBy: ["A-P1"] },
      ]);
    }
  });

  it("names every unfinished predecessor, not just the first", () => {
    const s = new PlanSolver(
      [feature("A"), feature("B"), feature("C")],
      [
        phase("A-P1", "A", 1, "PLANNED"),
        phase("B-P1", "B", 1, "PLANNED"),
        phase("C-P1", "C", 1, "SHIPPED"),
      ],
      [
        { from_id: "A", to_id: "C", edge_type: "DEPENDS_ON" },
        { from_id: "B", to_id: "C", edge_type: "DEPENDS_ON" },
      ],
    );

    expect(s.getStatusInversions()).toEqual([
      { phaseId: "C-P1", blockedBy: ["A-P1", "B-P1"] },
    ]);
  });

  it("catches an inversion across the implicit intra-feature sequence", () => {
    // No cross-feature edge needed: phase-02 shipped while phase-01 has not.
    const s = new PlanSolver(
      [feature("A")],
      [phase("A-P1", "A", 1, "PLANNED"), phase("A-P2", "A", 2, "SHIPPED")],
      [],
    );

    expect(s.getStatusInversions()).toEqual([
      { phaseId: "A-P2", blockedBy: ["A-P1"] },
    ]);
  });
});
