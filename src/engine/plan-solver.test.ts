import { describe, expect, it } from "vitest";
// @ts-ignore: PlanSolver might not exist yet
import { PlanSolver } from "./plan-solver.js";

describe("src/engine/plan-solver.ts (FR-002/003/004)", () => {
  const mockFeatures = [
    { id: "F1", name: "Feat 1", status: "DONE", sp_total: 10 },
    { id: "F2", name: "Feat 2", status: "PLANNED", sp_total: 20 },
    { id: "F3", name: "Feat 3", status: "PLANNED", sp_total: 15 },
    { id: "F4", name: "Feat 4", status: "PLANNED", sp_total: 5 },
  ];

  const mockPhases = [
    { id: "F1-P1", feature_id: "F1", name: "P1", status: "DONE", sp_estimate: 10 },
    { id: "F2-P1", feature_id: "F2", name: "P1", status: "PLANNED", sp_estimate: 20 },
    { id: "F3-P1", feature_id: "F3", name: "P1", status: "PLANNED", sp_estimate: 15 },
    { id: "F4-P1", feature_id: "F4", name: "P1", status: "PLANNED", sp_estimate: 0 }, // Missing SP (FR-018)
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
    expect(warnings).toContain(expect.stringContaining("F4-P1 has no SP estimate"));
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

  it("FR-011: should detect dependency cycles", () => {
    const cyclicEdges = [
        { from_id: "F1", to_id: "F2", edge_type: "DEPENDS_ON" },
        { from_id: "F2", to_id: "F1", edge_type: "DEPENDS_ON" },
    ];
    const solver = new PlanSolver(mockFeatures, mockPhases, cyclicEdges);
    expect(() => solver.validate()).toThrow(/cycle/i);
  });
});
