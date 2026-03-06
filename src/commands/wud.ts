import { Command } from "commander";
import { GwrkConfig } from "../utils/config.js";

export interface WudLoopOptions {
  featureDir: string;
  phaseNumber: number;
  config: GwrkConfig;
  maxIterations?: number;
  ciTimeout?: number;
  dryRun?: boolean;
}

export interface WudLoopResult {
  stage: string;
  iteration: number;
  prNumber?: number;
  durationMs: number;
}

export async function runWudLoop(opts: WudLoopOptions): Promise<WudLoopResult> {
  throw new Error("Not implemented");
}

export const wudCommand = new Command("wud")
  .description("Work Until Done — autonomous implement→review→PR loop")
  .argument("<feature>", "Feature ID")
  .argument("<phase>", "Phase number")
  .option("--dry-run", "Dry run mode")
  .option("--max-iterations <n>", "Max iterations", "3")
  .option("--ci-timeout <m>", "CI timeout in minutes", "30")
  .action(() => {
    throw new Error("Not implemented");
  });
