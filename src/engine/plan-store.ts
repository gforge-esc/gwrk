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
   * Render the build plan as Markdown (000-build-plan.md).
   */
  render(): string {
    const status = this.getPlanStatus();
    let md = "# 000 Build Plan — gwrk\n\n";

    md += `> **Status:** Authoritative · **Date:** ${new Date().toISOString().split("T")[0]}\n`;
    md +=
      "> **Anchored to:** [architecture.md](docs/architecture.md), [GWRK-PRD-PRFAQ.md](docs/GWRK-PRD-PRFAQ.md)\n\n---\n\n";

    md += "## Dependency Graph\n\n```mermaid\ngraph TD\n";
    for (const edge of status.edges) {
      const from = status.features.find((f) => f.id === edge.from_id);
      const to = status.features.find((f) => f.id === edge.to_id);
      const fromLabel = from
        ? `${from.id}["${from.id}: ${from.name}${from.status === "DONE" ? " ✅" : ""}"]`
        : edge.from_id;
      const toLabel = to
        ? `${to.id}["${to.id}: ${to.name}${to.status === "DONE" ? " ✅" : ""}"]`
        : edge.to_id;
      md += `    ${fromLabel} --> ${toLabel}\n`;
    }
    md += "```\n\n---\n\n## Features\n\n";

    for (const f of status.features) {
      let icon = "⚪";
      if (f.status === "DONE" || f.status === "SHIPPED") icon = "✅";
      else if (f.status === "IN_PROGRESS") icon = "🔴";
      else if (f.status === "SPECIFIED" || f.status === "DEFINED") icon = "🟡";

      md += `### Feature ${f.id.replace(/^F/, "")} — ${f.name} ${icon}\n\n`;
      md += `**Status:** ${f.status}\n\n`;

      if (f.phases && f.phases.length > 0) {
        md += "| Phase | Name | Status | SP |\n";
        md += "|---|---|---|---|\n";
        for (const p of f.phases) {
          let pIcon = "⚪";
          if (p.status === "DONE" || p.status === "SHIPPED") pIcon = "✅";
          else if (p.status === "IN_PROGRESS") pIcon = "🔴";

          md += `| ${p.seq} | ${p.name} | ${p.status} ${pIcon} | ${p.sp_estimate} |\n`;
        }
        md += "\n";
      }
    }

    return md;
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
}
