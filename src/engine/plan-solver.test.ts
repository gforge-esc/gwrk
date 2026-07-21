/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { PlanSolver } from "./plan-solver.js";

describe("src/engine/plan-solver.ts (FR-002/003/004)", () => {
  const mockFeatures = [
    { id: "F1", name: "Feat 1", status: "DONE", sp_total: 10 },
    { id: "F2", name: "Feat 2", status: "PLANNED", sp_total: 20 },
    { id: "F3", name: "Feat 3", status: "PLANNED", sp_total: 15 },
    { id: "F4", name: "Feat 4", status: "PLANNED", sp_total: 5 },
  ];

  const mockPhases = [
    { id: "F1-P1", feature_id: "F1", name: "P1", status: "DONE", sp_estimate: 10, seq: 1, health: "CLEAN" },
    { id: "F2-P1", feature_id: "F2", name: "P1", status: "PLANNED", sp_estimate: 20, seq: 1, health: "CLEAN" },
    { id: "F3-P1", feature_id: "F3", name: "P1", status: "PLANNED", sp_estimate: 15, seq: 1, health: "CLEAN" },
    { id: "F4-P1", feature_id: "F4", name: "P1", status: "PLANNED", sp_estimate: 0, seq: 1, health: "CLEAN" }, // Missing SP (FR-018)
  ];

  const mockEdges = [
    { from_id: "F1", to_id: "F2", edge_type: "DEPENDS_ON" },
    { from_id: "F2", to_id: "F3", edge_type: "DEPENDS_ON" },
    { from_id: "F3", to_id: "F4", edge_type: "DEPENDS_ON" },
  ];

  it("FR-003: should compute the ready queue using Kahn's algorithm", () => {
    const solver = new PlanSolver(mockFeatures, mockPhases, mockEdges);
    const ready = solver.getReadyQueue();
    
    // F2 depends on F1 (DONE), so F2 should be ready.
    // F3 depends on F2 (PLANNED), so it's not ready.
    expect(ready.map(p => p.id)).toContain("F2-P1");
    expect(ready.map(p => p.id)).not.toContain("F3-P1");
  });

  it("FR-004: should compute the critical path using CPM", () => {
    const solver = new PlanSolver(mockFeatures, mockPhases, mockEdges);
    const { path, warnings } = solver.getCriticalPath();
    
    // Path should be F1 -> F2 -> F3 -> F4
    expect(path.map(p => p.id)).toEqual(["F1-P1", "F2-P1", "F3-P1", "F4-P1"]);
    
    // FR-018: Should warn about F4-P1 having 0 SP
    expect(warnings.find(w => w.includes("F4-P1 has no SP estimate"))).toBeDefined();
  });

  it("FR-002: should compute topological waves (generations)", () => {
    const edges = [
        { from_id: "F1", to_id: "F2", edge_type: "DEPENDS_ON" },
        { from_id: "F1", to_id: "F3", edge_type: "DEPENDS_ON" },
        { from_id: "F2", to_id: "F4", edge_type: "DEPENDS_ON" },
        { from_id: "F3", to_id: "F4", edge_type: "DEPENDS_ON" },
    ];
    const solver = new PlanSolver(mockFeatures, mockPhases, edges);
    const waves = solver.getTopologicalWaves();
    
    expect(waves[0].map(p => p.id)).toContain("F1-P1");
    expect(waves[1].map(p => p.id)).toContain("F2-P1");
    expect(waves[1].map(p => p.id)).toContain("F3-P1");
    expect(waves[2].map(p => p.id)).toContain("F4-P1");
  });

  it("FR-002: should order phases within a feature via implicit sequence edges", () => {
    const features = [{ id: "F1", name: "F1", status: "PLANNED", sp_total: 0 }];
    const phases = [
      { id: "F1-P1", feature_id: "F1", name: "P1", status: "PLANNED", sp_estimate: 1, seq: 1, health: "CLEAN" },
      { id: "F1-P2", feature_id: "F1", name: "P2", status: "PLANNED", sp_estimate: 1, seq: 2, health: "CLEAN" },
      { id: "F1-P3", feature_id: "F1", name: "P3", status: "PLANNED", sp_estimate: 1, seq: 3, health: "CLEAN" },
    ];
    const solver = new PlanSolver(features, phases, []);

    // Each phase is its own wave, in seq order — not all "ready" at once.
    expect(solver.getTopologicalWaves().map(w => w.map(p => p.id))).toEqual([
      ["F1-P1"], ["F1-P2"], ["F1-P3"],
    ]);
    // Only the first phase is ready when nothing is shipped.
    expect(solver.getReadyQueue().map(p => p.id)).toEqual(["F1-P1"]);
  });

  it("FR-002: should chain a feature's phases before crossing to a dependent feature", () => {
    const features = [
      { id: "A", name: "A", status: "PLANNED", sp_total: 0 },
      { id: "B", name: "B", status: "PLANNED", sp_total: 0 },
    ];
    const phases = [
      { id: "A-P1", feature_id: "A", name: "P1", status: "PLANNED", sp_estimate: 1, seq: 1, health: "CLEAN" },
      { id: "A-P2", feature_id: "A", name: "P2", status: "PLANNED", sp_estimate: 1, seq: 2, health: "CLEAN" },
      { id: "B-P1", feature_id: "B", name: "P1", status: "PLANNED", sp_estimate: 1, seq: 1, health: "CLEAN" },
      { id: "B-P2", feature_id: "B", name: "P2", status: "PLANNED", sp_estimate: 1, seq: 2, health: "CLEAN" },
    ];
    // A is a prerequisite of B (gwrk convention: from = prerequisite).
    const edges = [{ from_id: "A", to_id: "B", edge_type: "DEPENDS_ON" }];
    const solver = new PlanSolver(features, phases, edges);

    expect(solver.getTopologicalWaves().map(w => w.map(p => p.id))).toEqual([
      ["A-P1"], ["A-P2"], ["B-P1"], ["B-P2"],
    ]);
  });

  it("FR-011: should detect dependency cycles", () => {
    const cyclicEdges = [
        { from_id: "F1", to_id: "F2", edge_type: "DEPENDS_ON" },
        { from_id: "F2", to_id: "F1", edge_type: "DEPENDS_ON" },
    ];
    const solver = new PlanSolver(mockFeatures, mockPhases, cyclicEdges);
    expect(() => solver.validate()).toThrow(/cycle/i);
  });
});
