import { Command } from "commander";

/**
 * FR-035, US-029: Display resolved project profile and conditioning mode.
 */
export const projectInfoCommand = new Command("project")
  .command("info")
  .description("Display resolved project profile")
  .option("--format <type>", "Output format (text, json)", "text")
  .action(() => {
    throw new Error("Not implemented");
  });