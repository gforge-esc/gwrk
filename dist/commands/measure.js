import { Command } from "commander";
import { compressionCommand } from "./compression.js";
import { effortCommand } from "./effort.js";
import { registerPulseSubcommands } from "./pulse.js";
/**
 * gwrk measure — The Pulse/Compression Pillar (Value)
 *
 * Everything that proves value — what shipped and how fast.
 *
 *   gwrk measure pulse [--days N]           Git activity dashboard
 *   gwrk measure effort <feature>           SP-driven estimation
 *   gwrk measure compression <feature>      Effort vs actual ratio
 */
export const measureCommand = new Command("measure")
    .description("Measure: pulse, effort, compression (Value)")
    .addCommand(effortCommand)
    .addCommand(compressionCommand);
// Register pulse as a subcommand of measure
registerPulseSubcommands(measureCommand);
