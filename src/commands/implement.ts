import { GwrkConfig } from "../utils/config";

export interface ExecutePhaseOptions {
  featureDir: string;
  phaseNumber: number;
  config: GwrkConfig;
  dryRun?: boolean;
}

export interface ExecutePhaseResult {
  tasksCompleted: number;
  tasksSkipped: number;
  totalTasks: number;
  branch: string;
}

export async function executePhase(opts: ExecutePhaseOptions): Promise<ExecutePhaseResult> {
  throw new Error("Not implemented");
}
