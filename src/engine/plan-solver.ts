/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import pkg from "graphology";
import type { DirectedGraph } from "graphology";
const { DirectedGraph: DirectedGraphConstructor } = pkg;
import { topologicalSort } from "graphology-dag";
import type { PlanEdge, PlanFeature, PlanPhase } from "../db/plan.js";

/**
 * Build Plan Solver engine.
 * Computes topological sorts, ready queue, and critical path.
 */
export class PlanSolver {
  private graph: DirectedGraph;
  private phaseMap: Map<string, PlanPhase>;

  constructor(
    private features: PlanFeature[],
    private phases: PlanPhase[],
    private edges: PlanEdge[],
  ) {
    this.graph = new DirectedGraphConstructor() as DirectedGraph;
    this.phaseMap = new Map();
    this.buildGraph();
  }

  private buildGraph(): void {
    // 1. Add all phases as nodes
    for (const phase of this.phases) {
      this.graph.addNode(phase.id, { ...phase });
      this.phaseMap.set(phase.id, phase);
    }

    // 2. Add edges
    for (const edge of this.edges) {
      const fromIds = this.resolveIds(edge.from_id, "last");
      const toIds = this.resolveIds(edge.to_id, "first");

      for (const from of fromIds) {
        for (const to of toIds) {
          if (this.graph.hasNode(from) && this.graph.hasNode(to)) {
            // Avoid self-loops
            if (from !== to) {
              this.graph.mergeDirectedEdge(from, to, { type: edge.edge_type });
            }
          }
        }
      }
    }

    // 3. Add implicit SEQUENCE edges from phase.seq if not already present
    // Actually, plan.md says we have SEQUENCE edges in plan_edges table.
    // But we should also respect the 'seq' order within a feature if no explicit edges exist?
    // Let's stick to the edges table for now as per FR-001.
  }

  private resolveIds(id: string, preference: "first" | "last"): string[] {
    // If id is a phase, return [id]
    if (this.phaseMap.has(id)) {
      return [id];
    }

    // If id is a feature, find its phases
    const featurePhases = this.phases
      .filter((p) => p.feature_id === id)
      .sort((a, b) => a.seq - b.seq);

    if (featurePhases.length === 0) return [];

    if (preference === "first") {
      return [featurePhases[0].id];
    }
    return [featurePhases[featurePhases.length - 1].id];
  }

  private getPhase(id: string): PlanPhase {
    const p = this.phaseMap.get(id);
    if (!p) throw new Error(`Invariant: Phase ${id} not found in map`);
    return p;
  }

  /**
   * Kahn's algorithm for ready queue computation.
   * A phase is ready if all its predecessors are DONE or SHIPPED or VERIFIED.
   */
  getReadyQueue(): PlanPhase[] {
    const readyPhases: PlanPhase[] = [];

    for (const phase of this.phases) {
      if (
        phase.status === "DONE" ||
        phase.status === "SHIPPED" ||
        phase.status === "VERIFIED"
      ) {
        continue;
      }

      // Check predecessors
      const predecessors = this.graph.inNeighbors(phase.id);
      const allDone = predecessors.every((predId: string) => {
        const pred = this.phaseMap.get(predId);
        return (
          pred &&
          (pred.status === "DONE" ||
            pred.status === "SHIPPED" ||
            pred.status === "VERIFIED")
        );
      });

      if (allDone) {
        readyPhases.push(phase);
      }
    }

    // Sort ready phases by critical path priority (slack ascending) then Most Successors First
    try {
      const { slackMap } = this.getCriticalPath();
      readyPhases.sort((a, b) => {
        const slackA = slackMap[a.id] ?? Number.POSITIVE_INFINITY;
        const slackB = slackMap[b.id] ?? Number.POSITIVE_INFINITY;

        if (Math.abs(slackA - slackB) > 0.001) {
          return slackA - slackB; // Ascending slack
        }

        // Tie-breaker: Most Successors First
        const succA = this.graph.outDegree(a.id);
        const succB = this.graph.outDegree(b.id);
        if (succA !== succB) return succB - succA;

        return a.seq - b.seq;
      });
    } catch {
      readyPhases.sort((a, b) => a.seq - b.seq);
    }
    return readyPhases;
  }

  /**
   * Critical Path Method (CPM).
   */
  getCriticalPath(): {
    path: PlanPhase[];
    warnings: string[];
    slackMap: Record<string, number>;
  } {
    const warnings: string[] = [];
    if (this.phases.length === 0) return { path: [], warnings, slackMap: {} };

    // 1. Topological Sort
    let sorted: string[];
    try {
      sorted = topologicalSort(this.graph);
    } catch (e) {
      throw new Error("Dependency cycle detected");
    }

    // 2. Forward Pass (Early Start, Early Finish)
    const es: Record<string, number> = {};
    const ef: Record<string, number> = {};

    for (const id of sorted) {
      const phase = this.getPhase(id);
      const duration = phase.sp_estimate || 0;
      if (phase.sp_estimate === 0) {
        // We'll check if it's on the path later to warn correctly as per FR-018
      }

      const preds = this.graph.inNeighbors(id);
      es[id] =
        preds.length === 0
          ? 0
          : Math.max(...preds.map((p: string) => ef[p] || 0));
      ef[id] = es[id] + duration;
    }

    // 3. Backward Pass (Late Start, Late Finish)
    const ls: Record<string, number> = {};
    const lf: Record<string, number> = {};
    const maxEf = Math.max(...Object.values(ef));

    for (let i = sorted.length - 1; i >= 0; i--) {
      const id = sorted[i];
      const phase = this.getPhase(id);
      const duration = phase.sp_estimate || 0;

      const succs = this.graph.outNeighbors(id);
      lf[id] =
        succs.length === 0
          ? maxEf
          : Math.min(...succs.map((s: string) => ls[s]));
      ls[id] = lf[id] - duration;
    }

    // 4. Identify Critical Path (Slack = 0)
    const slackMap: Record<string, number> = {};
    const criticalPathIds = sorted.filter((id) => {
      const slack = lf[id] - ef[id];
      slackMap[id] = slack;
      return Math.abs(slack) < 0.001;
    });

    const path = criticalPathIds.map((id) => this.getPhase(id));

    // FR-018: CPM warnings MUST appear when critical-path nodes lack SP estimates.
    for (const p of path) {
      if (p.sp_estimate === 0) {
        warnings.push(`⚠️ ${p.id} has no SP estimate — CPM results approximate`);
      }
    }

    return { path, warnings, slackMap };
  }

  /**
   * Compute topological waves (generations).
   */
  getTopologicalWaves(): PlanPhase[][] {
    const waves: PlanPhase[][] = [];
    const inDegree = new Map<string, number>();
    const queue: string[] = [];

    // Initialize in-degrees
    this.graph.forEachNode((node: string) => {
      const deg = this.graph.inDegree(node);
      inDegree.set(node, deg);
      if (deg === 0) {
        queue.push(node);
      }
    });

    while (queue.length > 0) {
      const waveIds: string[] = [...queue];
      waves.push(waveIds.map((id) => this.getPhase(id)));
      queue.length = 0;

      for (const id of waveIds) {
        this.graph.forEachOutNeighbor(id, (neighbor: string) => {
          const currentDeg = inDegree.get(neighbor);
          if (currentDeg === undefined) throw new Error("Invariant missing");
          const deg = currentDeg - 1;
          inDegree.set(neighbor, deg);
          if (deg === 0) {
            queue.push(neighbor);
          }
        });
      }
    }

    return waves;
  }

  /**
   * Validate the graph (e.g., cycle detection).
   */
  validate(): void {
    try {
      topologicalSort(this.graph);
    } catch (e) {
      throw new Error("Dependency cycle detected");
    }
  }
}
