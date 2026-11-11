/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Command } from "commander";
import { createCompressionCommand } from "./compression.js";
import { registerPulseSubcommands } from "./pulse.js";

/**
 * gwrk measure — The Pulse/Compression Pillar (Value)
 *
 * Everything that proves value — what shipped and how fast.
 *
 *   gwrk measure pulse [--days N]           Git activity dashboard
 *   gwrk measure compression <feature>      Effort vs actual ratio
 */
export function createMeasureCommand(): Command {
  const command = new Command("measure")
    .description("Measure: pulse, compression (Value)")
    .addHelpText(
      "after",
      `
Examples:
  gwrk measure pulse
  gwrk measure compression 001
`,
    )
    .enablePositionalOptions()
    .addCommand(createCompressionCommand());
  registerPulseSubcommands(command);
  return command;
}

export const measureCommand = createMeasureCommand();
