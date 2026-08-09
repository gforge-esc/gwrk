/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Two status-consistency gaps in the solver, both surfaced by data-dashboard.
 *
 * 1. `getTopologicalWaves()` computes in-degree over the WHOLE graph and never
 *    reads `status`, so `gwrk plan waves` — a command titled "Parallel
 *    Execution Waves" — opens on work shipped months ago. `getReadyQueue()`
 *    filters terminal statuses; waves did not. `getRemainingWaves()` is the
 *    status-aware view; the full view stays for the build-plan renderer, which
 *    documents the plan of record including history.
 *
 * 2. A feature-level edge resolved to the dependent feature's FIRST phase only
 *    (`resolveIds(to, "first")`). Once that first phase reads SHIPPED, phases
 *    2..N carry no cross-feature constraint at all. For an honest graph the
 *    intra-feature SEQUENCE chain still implies it transitively — but
 *    `plan init` promotes PLANNED → SHIPPED from ship-run EXISTENCE rather than
 *    from a passing gate, so the chain is exactly what cannot be trusted.
 *    Binding every phase makes the invariant locally enforced.
 */

import { describe, expect, it } from "vitest";
import { PlanSolver } from "./plan-solver.js";

const SHIPPED = "SHIPPED";
const PLANNED = "PLANNED";

/** Feature A (3 phases) → Feature B (2 phases), one feature-level edge. */
function fixture(statuses: Record<string, string>) {
  const features = [
    { id: "A", name: "Feat A", status: PLANNED, sp_total: 6 },
    { id: "B", name: "Feat B", status: PLANNED, sp_total: 4 },
  ];
  const phases = [
    { id: "A-P1", feature_id: "A", name: "A1", status: statuses["A-P1"] ?? PLANNED, sp_estimate: 2, seq: 1, health: "CLEAN" },
    { id: "A-P2", feature_id: "A", name: "A2", status: statuses["A-P2"] ?? PLANNED, sp_estimate: 2, seq: 2, health: "CLEAN" },
    { id: "A-P3", feature_id: "A", name: "A3", status: statuses["A-P3"] ?? PLANNED, sp_estimate: 2, seq: 3, health: "CLEAN" },
    { id: "B-P1", feature_id: "B", name: "B1", status: statuses["B-P1"] ?? PLANNED, sp_estimate: 2, seq: 1, health: "CLEAN" },
    { id: "B-P2", feature_id: "B", name: "B2", status: statuses["B-P2"] ?? PLANNED, sp_estimate: 2, seq: 2, health: "CLEAN" },
  ];
  const edges = [{ from_id: "A", to_id: "B", edge_type: "DEPENDS_ON" }];
  return new PlanSolver(features, phases, edges);
}

const ids = (waves: { id: string }[][]) => waves.map((w) => w.map((p) => p.id).sort());

describe("plan solver — remaining work vs. plan of record", () => {
  describe("getRemainingWaves", () => {
    it("opens on the first unfinished phase, not on shipped history", () => {
      const solver = fixture({ "A-P1": SHIPPED });

      expect(ids(solver.getRemainingWaves())).toEqual([
        ["A-P2"],
        ["A-P3"],
        ["B-P1"],
        ["B-P2"],
      ]);
    });

    it("treats a shipped predecessor as satisfied rather than as a blocker", () => {
      // A fully shipped ⇒ B-P1 leads the remaining plan even though its
      // cross-feature predecessor A-P3 is not in the pending set at all.
      const solver = fixture({ "A-P1": SHIPPED, "A-P2": SHIPPED, "A-P3": SHIPPED });

      expect(ids(solver.getRemainingWaves())).toEqual([["B-P1"], ["B-P2"]]);
    });

    it("surfaces a dependency cycle instead of silently dropping the stranded phases", () => {
      // Kahn's algorithm emits nothing for a cycle. Returning the partial set
      // would read as "that work does not exist" — the plan would quietly lose
      // phases. Name them instead.
      const features = [
        { id: "A", name: "Feat A", status: PLANNED, sp_total: 2 },
        { id: "B", name: "Feat B", status: PLANNED, sp_total: 2 },
      ];
      const phases = [
        { id: "A-P1", feature_id: "A", name: "A1", status: PLANNED, sp_estimate: 2, seq: 1, health: "CLEAN" },
        { id: "B-P1", feature_id: "B", name: "B1", status: PLANNED, sp_estimate: 2, seq: 1, health: "CLEAN" },
      ];
      const edges = [
        { from_id: "A", to_id: "B", edge_type: "DEPENDS_ON" },
        { from_id: "B", to_id: "A", edge_type: "DEPENDS_ON" },
      ];
      const solver = new PlanSolver(features, phases, edges);

      expect(() => solver.getRemainingWaves()).toThrow(/cycle/i);
    });

    it("returns no waves when every phase is terminal", () => {
      const solver = fixture({
        "A-P1": SHIPPED, "A-P2": SHIPPED, "A-P3": SHIPPED,
        "B-P1": "DONE", "B-P2": "CLOSED",
      });

      expect(solver.getRemainingWaves()).toEqual([]);
    });

    it("agrees with the ready queue on what leads the plan", () => {
      const solver = fixture({ "A-P1": SHIPPED, "A-P2": SHIPPED });
      const readyIds = solver.getReadyQueue().map((p) => p.id);

      expect(solver.getRemainingWaves()[0].map((p) => p.id)).toEqual(
        expect.arrayContaining(readyIds.filter((id) => id === "A-P3")),
      );
      expect(solver.getRemainingWaves()[0].map((p) => p.id)).toEqual(["A-P3"]);
    });
  });

  describe("getTopologicalWaves (plan of record)", () => {
    it("still includes shipped phases, so the rendered build plan keeps its history", () => {
      const solver = fixture({ "A-P1": SHIPPED, "A-P2": SHIPPED });

      expect(ids(solver.getTopologicalWaves())[0]).toEqual(["A-P1"]);
    });

    it("keeps wave indices stable under the wider cross-feature binding", () => {
      // Binding A's last phase to every B phase adds only transitively
      // redundant edges, so the rendered Wave Strategy table must not churn.
      const solver = fixture({});

      expect(ids(solver.getTopologicalWaves())).toEqual([
        ["A-P1"],
        ["A-P2"],
        ["A-P3"],
        ["B-P1"],
        ["B-P2"],
      ]);
    });
  });

  describe("cross-feature edges bind every phase of the dependent feature", () => {
    it("withholds a later phase whose prerequisite feature is unfinished", () => {
      // data-dashboard's real state: 010/phase-01 reads SHIPPED while all of
      // 007 is PLANNED, so 010/phase-02 showed up in `plan next` as ready to
      // build a redaction consumer against a module that does not exist.
      const solver = fixture({ "B-P1": SHIPPED });
      const ready = solver.getReadyQueue().map((p) => p.id);

      expect(ready).not.toContain("B-P2");
      expect(ready).toContain("A-P1");
    });

    it("releases the later phase once the prerequisite feature completes", () => {
      const solver = fixture({
        "A-P1": SHIPPED, "A-P2": SHIPPED, "A-P3": SHIPPED, "B-P1": SHIPPED,
      });

      expect(solver.getReadyQueue().map((p) => p.id)).toContain("B-P2");
    });

    it("does not lengthen the critical path with the redundant edges", () => {
      const solver = fixture({});

      expect(solver.getCriticalPath().path.map((p) => p.id)).toEqual([
        "A-P1", "A-P2", "A-P3", "B-P1", "B-P2",
      ]);
    });
  });
});
