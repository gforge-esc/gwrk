import { Command } from "commander";

/**
 * Unified Init Command stub.
 * Absorbs setup.ts and integrates interactive profile wizard.
 */
export const initAction = async (options: any): Promise<void> => {
  throw new Error("Not implemented: FR-001, FR-046");
};

export const initCommand = new Command("init")
  .description("Initialize a new gwrk project")
  .option("--non-interactive", "Run without interactive prompts")
  .option("--agent", "Agent-optimized init mode")
  .action(initAction);
