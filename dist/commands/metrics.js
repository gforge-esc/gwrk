import { Command } from "commander";
import { effortCommand } from "./effort.js";
import { compressionCommand } from "./compression.js";
export const metricsCommand = new Command("metrics")
    .description("Productivity and effort reporting")
    .addCommand(effortCommand)
    .addCommand(compressionCommand);
