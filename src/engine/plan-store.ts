/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import path from "node:path";
import * as db from "../db/plan.js";
import {
  type PlanEdgePayload,
  type PlanFeaturePayload,
  type PlanPhasePayload,
  parseBuildPlan,
} from "../utils/parser-plan.js";
import { scanReadiness } from "./readiness-scanner.js";

/**
 * Ordering of the definition-frontier statuses that disk readiness owns.
 * Implementation statuses (IN_PROGRESS/SHIPPED/VERIFIED/CLOSED/DONE) are
 * intentionally absent — they are owned by ship runs, not file presence, so
 * disk readiness never advances into or downgrades out of them.
 */
const DEFINITION_RANK: Record<string, number> = {
  PLANNED: 0,
  SPECIFIED: 1,
  DEFINED: 2,
};

export class PlanStore {
  constructor(private readonly projectId: string) {}

  /**
   * Seed the build plan from a file (Markdown or YAML).
   */
  seedPlan(
    features: PlanFeaturePayload[],
    phases: PlanPhasePayload[],
    edges: PlanEdgePayload[],
  ): void {
    for (const feature of features) {
      db.insertFeature(
        {
          id: feature.id,
          name: feature.name,
          status: feature.status,
          sp_total: feature.sp_total,
        },
        this.projectId,
      );
    }
    for (const phase of phases) {
      db.insertPhase(
        {
          id: phase.id,
          feature_id: phase.feature_id,
          name: phase.name,
          status: phase.status,
          health: phase.health,
          sp_estimate: phase.sp_estimate,
          seq: phase.seq,
        },
        this.projectId,
      );
    }
    for (const edge of edges) {
      db.insertEdge(edge, this.projectId);
    }
  }

  /**
   * Clear the plan and seed from a file.
   */
  seedFromFile(filePath: string): void {
    const payload = parseBuildPlan(filePath);
    this.seedPlan(payload.features, payload.phases, payload.edges);
  }

  /**
   * Initialize the plan from the specs/ directory without clobbering existing features.
   * Inserts phases from plan.md and enriches status from ship runs.
   * Prunes ghost features (DB entries with no specs/ directory).
   * Reconciles feature status from phase data.
   */
  initFromSpecs(specsDir: string): {
    added: string[];
    skipped: string[];
    phasesInserted: number;
    pruned: string[];
    reconciled: string[];
  } {
    const readiness = this.scanReadiness(specsDir);
    const added: string[] = [];
    const skipped: string[] = [];
    const reconciled: string[] = [];
    let phasesInserted = 0;

    // Get shipped phases for status enrichment
    const shippedPhases = db.getShippedPhases(this.projectId);

    // Build set of feature IDs that exist on disk
    const diskFeatureIds = new Set(readiness.map((r) => r.featureId));

    // Prune ghost features (exist in DB but not on disk)
    const pruned: string[] = [];
    const existingFeatures = db.listFeatures(this.projectId);
    for (const feature of existingFeatures) {
      if (!diskFeatureIds.has(feature.id)) {
        db.deleteFeature(feature.id, this.projectId);
        pruned.push(feature.id);
      }
    }

    for (const res of readiness) {
      const existing = db.getFeature(res.featureId, this.projectId);
      if (existing) {
        skipped.push(res.featureId);
        // Reconcile name if it was seeded with wrong name (e.g., from plan seed YAML)
        if (existing.name !== res.featureId && existing.name !== res.featureId) {
          db.updateFeatureName(res.featureId, res.featureId, this.projectId);
        }
        // Refresh status from disk readiness when the docs have advanced the
        // definition frontier (PLANNED → SPECIFIED → DEFINED). Never downgrade,
        // and never overwrite an implementation status (IN_PROGRESS/SHIPPED/…)
        // which is owned by ship runs, not by file presence.
        const cur = DEFINITION_RANK[existing.status];
        const disk = DEFINITION_RANK[res.status];
        if (cur !== undefined && disk !== undefined && disk > cur) {
          db.updateFeatureStatus(res.featureId, res.status, this.projectId);
          reconciled.push(`${res.featureId}: ${existing.status} → ${res.status}`);
        }
        // Refresh sp_total from disk (tasks.json). Only when we have an
        // estimate — absent tasks.json must not zero an existing total.
        if (res.spTotal !== undefined && res.spTotal !== existing.sp_total) {
          db.updateFeatureSpTotal(res.featureId, res.spTotal, this.projectId);
        }
      } else {
        db.insertFeature(
          {
            id: res.featureId,
            name: res.featureId,
            status: res.status,
            sp_total: res.spTotal || 0,
          },
          this.projectId,
        );
        added.push(res.featureId);
      }

      // Always populate phases (additive — new phases get inserted, existing stay)
      for (const phase of res.phases) {
        const phaseSeq = `phase-${String(phase.number).padStart(2, "0")}`;
        const phaseId = `${res.featureId}/${phaseSeq}`;
        const existingPhase = db.getPhase(phaseId, this.projectId);

        // Determine status: check if this feature+phase has a ship run
        const shipKey = `${res.featureId}:${phaseSeq}`;
        const shippedByRun = shippedPhases.has(shipKey);

        if (existingPhase) {
          // Idempotent-but-not-static: doc-derived fields (name/sp/seq) track
          // plan.md; runtime fields (status/health) are preserved, with ship
          // enrichment (PLANNED → SHIPPED when a run says so).
          const status =
            shippedByRun && existingPhase.status === "PLANNED"
              ? "SHIPPED"
              : existingPhase.status;
          db.insertPhase(
            {
              ...existingPhase,
              name: phase.title,
              sp_estimate: phase.sp,
              seq: phase.number,
              status,
            },
            this.projectId,
          );
          continue;
        }

        const status = shippedByRun ? "SHIPPED" : "PLANNED";

        db.insertPhase(
          {
            id: phaseId,
            feature_id: res.featureId,
            name: phase.title,
            status,
            health: "CLEAN",
            sp_estimate: phase.sp,
            seq: phase.number,
          },
          this.projectId,
        );
        phasesInserted++;
      }

      // Reconcile feature status from phases
      const feature = db.getFeature(res.featureId, this.projectId);
      if (feature) {
        const phases = db.listPhases(res.featureId, this.projectId);
        if (phases.length > 0) {
          const allShipped = phases.every(
            (p) => p.status === "DONE" || p.status === "SHIPPED",
          );
          const anyShipped = phases.some(
            (p) => p.status === "DONE" || p.status === "SHIPPED",
          );

          let newStatus = feature.status;
          if (allShipped) {
            newStatus = "SHIPPED";
          } else if (anyShipped && feature.status !== "SHIPPED") {
            newStatus = "IN_PROGRESS";
          }

          if (newStatus !== feature.status) {
            db.updateFeatureStatus(
              res.featureId,
              newStatus,
              this.projectId,
            );
            reconciled.push(`${res.featureId}: ${feature.status} → ${newStatus}`);
          }
        }
      }
    }
    return { added, skipped, phasesInserted, pruned, reconciled };
  }

  /**
   * Get the aggregate project status.
   */
  getPlanStatus(): {
    features: (db.PlanFeature & { phases: db.PlanPhase[] })[];
    edges: db.PlanEdge[];
  } {
    const features = db.listFeatures(this.projectId).map((f) => {
      const phases = db.listPhases(f.id, this.projectId);
      return { ...f, phases };
    });
    const edges = db.listAllEdges(this.projectId);
    return { features, edges };
  }

  /**
   * Check if the plan graph is empty.
   */
  isEmpty(): boolean {
    return db.isPlanEmpty(this.projectId);
  }

  /**
   * Add a new feature.
   */
  addFeature(feature: db.PlanFeature): void {
    db.insertFeature(feature, this.projectId);
  }

  /**
   * Add a new phase.
   */
  addPhase(phase: db.PlanPhase): void {
    db.insertPhase(phase, this.projectId);
  }

  /**
   * Remove a phase.
   */
  removePhase(id: string): void {
    db.deletePhase(id, this.projectId);
  }

  /**
   * Update a phase's status and metadata.
   */
  updatePhase(id: string, updates: Partial<db.PlanPhase>): void {
    const existing = db.getPhase(id, this.projectId);
    if (!existing) throw new Error(`Phase ${id} not found`);
    db.insertPhase({ ...existing, ...updates }, this.projectId);

    // Auto-cascade if status was updated
    if (updates.status) {
      const feature = db.getFeature(existing.feature_id, this.projectId);
      if (feature) {
        const phases = db.listPhases(existing.feature_id, this.projectId);
        const allCompleted = phases.every(
          (p) => p.status === "DONE" || p.status === "SHIPPED",
        );
        if (allCompleted) {
          db.insertFeature(
            {
              ...feature,
              status: "SHIPPED",
            },
            this.projectId,
          );
        }
      }
    }
  }

  /**
   * Add a dependency edge.
   */
  addEdge(edge: db.PlanEdge): void {
    db.insertEdge(edge, this.projectId);
  }

  /**
   * Remove a dependency edge.
   */
  removeEdge(from_id: string, to_id: string, edge_type: string): void {
    db.deleteEdge(from_id, to_id, edge_type, this.projectId);
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
    const phase = db.getPhase(event.phaseId, this.projectId);
    if (phase) {
      db.insertPhase(
        {
          ...phase,
          status: "SHIPPED",
          sp_actual: event.sp_actual,
          duration_ms: event.duration_ms,
          completed_at: new Date().toISOString(),
          evidence: event.evidence,
        },
        this.projectId,
      );

      // Auto-cascade: If all phases in the feature are now DONE/SHIPPED, mark the feature as SHIPPED
      const feature = db.getFeature(event.featureId, this.projectId);
      if (feature) {
        const phases = db.listPhases(event.featureId, this.projectId);
        const allCompleted = phases.every(
          (p) => p.status === "DONE" || p.status === "SHIPPED",
        );
        if (allCompleted) {
          db.insertFeature(
            {
              ...feature,
              status: "SHIPPED",
            },
            this.projectId,
          );
        }
      }
    }
  }

  /**
   * Hook handler for successful definition completion.
   */
  handleDefineComplete(event: { featureId: string; status: string }): void {
    const feature = db.getFeature(event.featureId, this.projectId);
    if (feature) {
      db.insertFeature(
        {
          ...feature,
          status: event.status,
        },
        this.projectId,
      );

      // Also update all phases of this feature that are currently PLANNED
      const phases = db.listPhases(event.featureId, this.projectId);
      for (const p of phases) {
        if (p.status === "PLANNED") {
          db.insertPhase({ ...p, status: event.status }, this.projectId);
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
    return db.listProposals(this.projectId);
  }

  /**
   * Add a new proposal.
   */
  addProposal(proposal: db.PlanProposal): void {
    db.insertProposal(proposal, this.projectId);
  }

  /**
   * Approve a proposal.
   */
  approveProposal(id: string): void {
    const proposal = db.getProposal(id, this.projectId);
    if (!proposal) throw new Error(`Proposal ${id} not found`);

    if (proposal.proposal_type === "STATUS_UPDATE" && proposal.detail) {
      this.updatePhase(proposal.target_phase_id, {
        status: proposal.detail,
      });
    }

    db.insertProposal(
      {
        ...proposal,
        status: "APPROVED",
        resolved_at: new Date().toISOString(),
      },
      this.projectId,
    );
  }

  /**
   * Reject a proposal.
   */
  rejectProposal(id: string): void {
    const proposal = db.getProposal(id, this.projectId);
    if (!proposal) throw new Error(`Proposal ${id} not found`);

    db.insertProposal(
      {
        ...proposal,
        status: "REJECTED",
        resolved_at: new Date().toISOString(),
      },
      this.projectId,
    );
  }
}
