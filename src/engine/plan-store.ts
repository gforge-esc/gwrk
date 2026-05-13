import path from "node:path";
import * as db from "../db/plan.js";
import {
  type PlanEdgePayload,
  type PlanFeaturePayload,
  type PlanPhasePayload,
  parsePlan,
} from "../utils/parser-plan.js";
import { scanReadiness } from "./readiness-scanner.js";

export class PlanStore {
  /**
   * Seed the build plan from a file (Markdown or YAML).
   */
  seedPlan(
    features: PlanFeaturePayload[],
    phases: PlanPhasePayload[],
    edges: PlanEdgePayload[],
  ): void {
    for (const feature of features) {
      db.insertFeature({
        id: feature.id,
        name: feature.name,
        status: feature.status,
        sp_total: feature.sp_total,
      });
    }
    for (const phase of phases) {
      db.insertPhase({
        id: phase.id,
        feature_id: phase.feature_id,
        name: phase.name,
        status: phase.status,
        health: phase.health,
        sp_estimate: phase.sp_estimate,
        seq: phase.seq,
      });
    }
    for (const edge of edges) {
      db.insertEdge(edge);
    }
  }

  /**
   * Clear the plan and seed from a file.
   */
  seedFromFile(filePath: string): void {
    const payload = parsePlan(filePath);
    this.seedPlan(payload.features, payload.phases, payload.edges);
  }

  /**
   * Initialize the plan from the specs/ directory without clobbering existing features.
   */
  initFromSpecs(specsDir: string): { added: string[]; skipped: string[] } {
    const readiness = this.scanReadiness(specsDir);
    const added: string[] = [];
    const skipped: string[] = [];

    for (const res of readiness) {
      const existing = db.getFeature(res.featureId);
      if (existing) {
        skipped.push(res.featureId);
      } else {
        db.insertFeature({
          id: res.featureId,
          name: res.featureId,
          status: res.status,
          sp_total: res.spTotal || 0,
        });
        added.push(res.featureId);
      }
    }
    return { added, skipped };
  }

  /**
   * Get the aggregate project status.
   */
  getPlanStatus(): {
    features: (db.PlanFeature & { phases: db.PlanPhase[] })[];
    edges: db.PlanEdge[];
  } {
    const features = db.listFeatures().map((f) => {
      const phases = db.listPhases(f.id);
      return { ...f, phases };
    });
    const edges = db.listAllEdges();
    return { features, edges };
  }

  /**
   * Check if the plan graph is empty.
   */
  isEmpty(): boolean {
    return db.isPlanEmpty();
  }

  /**
   * Add a new feature.
   */
  addFeature(feature: db.PlanFeature): void {
    db.insertFeature(feature);
  }

  /**
   * Add a new phase.
   */
  addPhase(phase: db.PlanPhase): void {
    db.insertPhase(phase);
  }

  /**
   * Remove a phase.
   */
  removePhase(id: string): void {
    db.deletePhase(id);
  }

  /**
   * Update a phase's status and metadata.
   */
  updatePhase(id: string, updates: Partial<db.PlanPhase>): void {
    const existing = db.getPhase(id);
    if (!existing) throw new Error(`Phase ${id} not found`);
    db.insertPhase({ ...existing, ...updates });

    // Auto-cascade if status was updated
    if (updates.status) {
      const feature = db.getFeature(existing.feature_id);
      if (feature) {
        const phases = db.listPhases(existing.feature_id);
        const allCompleted = phases.every(
          (p) => p.status === "DONE" || p.status === "SHIPPED"
        );
        if (allCompleted) {
          db.insertFeature({
            ...feature,
            status: "SHIPPED",
          });
        }
      }
    }
  }

  /**
   * Add a dependency edge.
   */
  addEdge(edge: db.PlanEdge): void {
    db.insertEdge(edge);
  }

  /**
   * Remove a dependency edge.
   */
  removeEdge(from_id: string, to_id: string, edge_type: string): void {
    db.deleteEdge(from_id, to_id, edge_type);
  }

  /**
   * Hook handler for successful ship completion.
   */
  handleShipComplete(event: {
    featureId: string;
    phaseId: string;
    sp_actual: number;
    duration_ms: number;
    evidence: string;
  }): void {
    const phase = db.getPhase(event.phaseId);
    if (phase) {
      db.insertPhase({
        ...phase,
        status: "SHIPPED",
        sp_actual: event.sp_actual,
        duration_ms: event.duration_ms,
        completed_at: new Date().toISOString(),
        evidence: event.evidence,
      });

      // Auto-cascade: If all phases in the feature are now DONE/SHIPPED, mark the feature as SHIPPED
      const feature = db.getFeature(event.featureId);
      if (feature) {
        const phases = db.listPhases(event.featureId);
        const allCompleted = phases.every(
          (p) => p.status === "DONE" || p.status === "SHIPPED"
        );
        if (allCompleted) {
          db.insertFeature({
            ...feature,
            status: "SHIPPED",
          });
        }
      }
    }
  }

  /**
   * Hook handler for successful definition completion.
   */
  handleDefineComplete(event: { featureId: string; status: string }): void {
    const feature = db.getFeature(event.featureId);
    if (feature) {
      db.insertFeature({
        ...feature,
        status: event.status,
      });

      // Also update all phases of this feature that are currently PLANNED
      const phases = db.listPhases(event.featureId);
      for (const p of phases) {
        if (p.status === "PLANNED") {
          db.insertPhase({ ...p, status: event.status });
        }
      }
    }
  }

  /**
   * Render the build plan as Markdown (000-build-plan.md).
   */
  async render(): Promise<string> {
    const status = this.getPlanStatus();
    const solver = await this.getSolver();
    const { PlanRenderer } = await import("./plan-renderer.js");

    const renderer = new PlanRenderer(
      status.features,
      status.features.flatMap((f) => f.phases),
      status.edges,
      solver,
    );

    return renderer.render();
  }

  /**
   * Proxy for readiness scanner (for tests).
   */
  scanReadiness(specsDir: string) {
    return scanReadiness(specsDir);
  }

  /**
   * Get a PlanSolver instance for the current graph state.
   */
  async getSolver() {
    const { PlanSolver } = await import("./plan-solver.js");
    const status = this.getPlanStatus();
    return new PlanSolver(
      status.features,
      status.features.flatMap((f) => f.phases),
      status.edges,
    );
  }

  /**
   * List all proposals.
   */
  listProposals(): db.PlanProposal[] {
    return db.listProposals();
  }

  /**
   * Add a new proposal.
   */
  addProposal(proposal: db.PlanProposal): void {
    db.insertProposal(proposal);
  }

  /**
   * Approve a proposal.
   */
  approveProposal(id: string): void {
    const proposal = db.getProposal(id);
    if (!proposal) throw new Error(`Proposal ${id} not found`);

    if (proposal.proposal_type === "STATUS_UPDATE" && proposal.detail) {
      this.updatePhase(proposal.target_phase_id, {
        status: proposal.detail,
      });
    }

    db.insertProposal({
      ...proposal,
      status: "APPROVED",
      resolved_at: new Date().toISOString(),
    });
  }

  /**
   * Reject a proposal.
   */
  rejectProposal(id: string): void {
    const proposal = db.getProposal(id);
    if (!proposal) throw new Error(`Proposal ${id} not found`);

    db.insertProposal({
      ...proposal,
      status: "REJECTED",
      resolved_at: new Date().toISOString(),
    });
  }
}
