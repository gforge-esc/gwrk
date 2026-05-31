import fs from "node:fs";
import path from "node:path";
import type { PlanFeature, PlanPhase } from "../db/plan.js";

export interface DriftResult {
  featureId?: string;
  phaseId?: string;
  status: "CLEAN" | "DRIFTED" | "MISSING_FROM_GRAPH" | "MISSING_FROM_SPECS";
  reason?: string;
}

export class DriftDetector {
  constructor(
    private plan: {
      features: PlanFeature[];
      phases: PlanPhase[];
    },
  ) {}

  /**
   * Detect drift between the plan graph state and the actual workspace.
   *
   * Checks:
   * 1. Features in specs/ that are missing from the graph
   * 2. Features in the graph that are missing from specs/
   * 3. Phase status mismatches (graph says SHIPPED but tasks.json says otherwise)
   */
  verify(projectRoot: string): DriftResult[] {
    const results: DriftResult[] = [];

    // 1. Check specs/ directory for features missing from graph
    const specsDir = path.join(projectRoot, "specs");
    if (fs.existsSync(specsDir)) {
      const specEntries = fs.readdirSync(specsDir, { withFileTypes: true });
      const specFeatureIds = specEntries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name);

      const graphFeatureIds = new Set(this.plan.features.map((f) => f.id));

      for (const specId of specFeatureIds) {
        if (!graphFeatureIds.has(specId)) {
          results.push({
            featureId: specId,
            status: "MISSING_FROM_GRAPH",
            reason: `specs/${specId}/ exists but is not in the build plan graph`,
          });
        }
      }

      // 3. Check graph features that are missing from specs/
      const specIdSet = new Set(specFeatureIds);
      for (const feature of this.plan.features) {
        // Skip synthetic/meta features that don't have spec dirs (F000, etc.)
        if (feature.id.startsWith("F0") || feature.id.startsWith("F")) {
          // Only check spec-style IDs (e.g. "001-cli-core")
          continue;
        }
        if (!specIdSet.has(feature.id)) {
          results.push({
            featureId: feature.id,
            status: "MISSING_FROM_SPECS",
            reason: `Feature ${feature.id} is in graph but has no specs/ directory`,
          });
        }
      }
    }

    // 4. Check for tasks.json status mismatches
    for (const feature of this.plan.features) {
      const tasksPath = path.join(
        projectRoot,
        "specs",
        feature.id,
        ".gwrk",
        "tasks.json",
      );
      if (fs.existsSync(tasksPath)) {
        try {
          const tasksData = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
          if (tasksData.phases) {
            for (const taskPhase of tasksData.phases) {
              const graphPhase = this.plan.phases.find(
                (p) => p.feature_id === feature.id && p.id === taskPhase.id,
              );
              if (!graphPhase) continue;

              const hasOpenTasks = taskPhase.tasks?.some(
                (t: { status: string }) => t.status === "open",
              );

              if (
                (graphPhase.status === "DONE" ||
                  graphPhase.status === "SHIPPED") &&
                hasOpenTasks
              ) {
                results.push({
                  featureId: feature.id,
                  phaseId: graphPhase.id,
                  status: "DRIFTED",
                  reason: `Graph says ${graphPhase.status} but tasks.json has open tasks`,
                });
              }
            }
          }
        } catch {
          // Skip unparseable tasks.json
        }
      }
    }

    return results;
  }
}
