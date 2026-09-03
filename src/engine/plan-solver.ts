/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import pkg from "graphology";
import type { DirectedGraph } from "graphology";
const { DirectedGraph: DirectedGraphConstructor } = pkg;
import { topologicalSort } from "graphology-dag";
import type { PlanEdge, PlanFeature, PlanPhase } from "../db/plan.js";

/**
 * Statuses that satisfy a dependency — the phase is finished, so anything
 * waiting on it is released. Held in one place because the solver's readers
 * previously disagreed: the ready queue filtered these, the wave computation
 * did not, so `plan waves` opened on work shipped months earlier.
 */
const TERMINAL_STATUSES = new Set(["DONE", "SHIPPED", "VERIFIED", "CLOSED"]);

function isTerminal(phase: PlanPhase): boolean {
  return TERMINAL_STATUSES.has(phase.status);
}

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

    // 2. Add edges.
    //
    // A feature-level edge binds the prerequisite's LAST phase to EVERY phase
    // of the dependent feature, not just its first. Binding only the first left
    // phases 2..N with no cross-feature constraint the moment phase 1 read
    // SHIPPED. The intra-feature SEQUENCE chain implies it transitively for an
    // honest graph — but `plan init` promotes PLANNED → SHIPPED from ship-run
    // existence rather than from a passing gate, so the chain is precisely what
    // cannot be trusted. The extra edges are transitively redundant, so wave
    // indices and the critical path are unchanged; only readiness tightens.
    for (const edge of this.edges) {
      const fromIds = this.resolveIds(edge.from_id, "last");
      const toIds = this.resolveIds(edge.to_id, "all");

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

    // 3. Add implicit intra-feature SEQUENCE edges from phase.seq.
    // Phases within a feature run in order (phase-01 → phase-02 → …). Without
    // these, every phase but the cross-feature targets has no predecessor, so
    // the solver reports nearly all phases "ready" at once and inverts wave
    // order. Synthesized deterministically from seq; skipped when an explicit
    // edge already connects the pair.
    const phasesByFeature = new Map<string, PlanPhase[]>();
    for (const phase of this.phases) {
      const list = phasesByFeature.get(phase.feature_id) ?? [];
      list.push(phase);
      phasesByFeature.set(phase.feature_id, list);
    }
    for (const featurePhases of phasesByFeature.values()) {
      const ordered = [...featurePhases].sort((a, b) => a.seq - b.seq);
      for (let i = 0; i < ordered.length - 1; i++) {
        const from = ordered[i].id;
        const to = ordered[i + 1].id;
        if (from !== to && !this.graph.hasEdge(from, to)) {
          this.graph.mergeDirectedEdge(from, to, { type: "SEQUENCE" });
        }
      }
    }
  }

  private resolveIds(
    id: string,
    preference: "first" | "last" | "all",
  ): string[] {
    // If id is a phase, return [id]
    if (this.phaseMap.has(id)) {
      return [id];
    }

    // If id is a feature, find its phases
    const featurePhases = this.phases
      .filter((p) => p.feature_id === id)
      .sort((a, b) => a.seq - b.seq);

    if (featurePhases.length === 0) return [];

    if (preference === "all") {
      return featurePhases.map((p) => p.id);
    }
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
      if (isTerminal(phase)) {
        continue;
      }

      // Check predecessors
      const predecessors = this.graph.inNeighbors(phase.id);
      const allDone = predecessors.every((predId: string) => {
        const pred = this.phaseMap.get(predId);
        return pred !== undefined && isTerminal(pred);
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
   * Phases recorded as finished whose predecessors are not.
   *
   * `plan verify` compares specs/ against the graph; nothing compared the graph
   * against itself, so a phase could read SHIPPED while its prerequisites read
   * PLANNED and no command would mention it. `010-reporting-email/phase-01` is
   * SHIPPED on data-dashboard while all of `007-audience-redaction` is PLANNED.
   *
   * An inversion is always one of two real problems: a status promoted without
   * evidence (`plan init` promotes from ship-run EXISTENCE, not a passing gate),
   * or a missing dependency edge. Both need a human, and readiness now depends on
   * these statuses being honest, so an unreported inversion propagates.
   */
  getStatusInversions(): { phaseId: string; blockedBy: string[] }[] {
    const inversions: { phaseId: string; blockedBy: string[] }[] = [];

    for (const phase of this.phases) {
      if (!isTerminal(phase)) continue;

      const blockedBy = this.graph
        .inNeighbors(phase.id)
        .filter((predId: string) => {
          const pred = this.phaseMap.get(predId);
          return pred !== undefined && !isTerminal(pred);
        })
        .sort();

      if (blockedBy.length > 0) inversions.push({ phaseId: phase.id, blockedBy });
    }

    return inversions;
  }

  /**
   * Topological waves over the work that is NOT yet finished — the operational
   * "what can run concurrently now" view behind `gwrk plan waves`.
   *
   * A terminal predecessor is satisfied, so it is excluded from the subgraph
   * rather than counted as a blocker. Wave 1 is therefore the genuine
   * parallel-ready set and matches `getReadyQueue()`'s membership.
   *
   * Use `getTopologicalWaves()` instead for the plan of record (the rendered
   * build plan), which documents every wave including shipped history.
   *
   * @throws if pending phases form a dependency cycle — Kahn's algorithm emits
   * nothing for one, and returning the partial set would silently drop work.
   */
  getRemainingWaves(): PlanPhase[][] {
    const pending = this.phases.filter((p) => !isTerminal(p));
    const pendingIds = new Set(pending.map((p) => p.id));

    const waves: PlanPhase[][] = [];
    const inDegree = new Map<string, number>();
    let queue: string[] = [];

    for (const phase of pending) {
      const blockers = this.graph
        .inNeighbors(phase.id)
        .filter((id: string) => pendingIds.has(id));
      inDegree.set(phase.id, blockers.length);
      if (blockers.length === 0) queue.push(phase.id);
    }

    let emitted = 0;
    while (queue.length > 0) {
      const waveIds = [...queue];
      waves.push(waveIds.map((id) => this.getPhase(id)));
      emitted += waveIds.length;
      queue = [];

      for (const id of waveIds) {
        this.graph.forEachOutNeighbor(id, (neighbor: string) => {
          if (!pendingIds.has(neighbor)) return;
          const deg = (inDegree.get(neighbor) ?? 0) - 1;
          inDegree.set(neighbor, deg);
          if (deg === 0) queue.push(neighbor);
        });
      }
    }

    if (emitted !== pending.length) {
      const stranded = pending
        .filter((p) => (inDegree.get(p.id) ?? 0) > 0)
        .map((p) => p.id);
      throw new Error(
        `Dependency cycle among pending phases — cannot order: ${stranded.join(", ")}`,
      );
    }

    return waves;
  }

  /**
   * Compute topological waves (generations) across the ENTIRE plan, including
   * phases already shipped. This is the plan of record used by the build-plan
   * renderer; for current work use `getRemainingWaves()`.
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
