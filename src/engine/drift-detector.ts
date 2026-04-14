import type { PlanFeature, PlanPhase } from "../db/plan.js";

export interface DriftResult {
  featureId?: string;
  phaseId?: string;
  status: "CLEAN" | "DRIFTED" | "MISSING_FROM_GRAPH" | "MISSING_FROM_SPECS";
  reason?: string;
}

export class DriftDetector {
  constructor(private plan: { features: PlanFeature[]; phases: PlanPhase[] }) {}

  verify(projectRoot: string): DriftResult[] {
    throw new Error("Method not implemented.");
  }
}
