import { Command } from "commander";

/**
 * gwrk setup — Interactive workstation provisioning
 */
export const setupCommand = new Command("setup")
  .description("Interactively configure macOS workstation for unattended agent execution")
  .action(async () => {
    throw new Error("Not implemented");
  });
