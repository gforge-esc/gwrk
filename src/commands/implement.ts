import { Command } from "commander";
import { GwrkConfig } from "../utils/config.js";

export const implementCommand = new Command("implement")
  .description("Implement a feature or fix")
  .argument("<feature>", "Feature ID")
  .argument("<phase>", "Phase number")
  .option("--dry-run", "Dry run mode")
  .action(() => {
    throw new Error("Not implemented");
  });

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
