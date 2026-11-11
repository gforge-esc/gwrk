/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Command } from "commander";
import { writeScopedStdout } from "../adapters/cli/output-scope.js";
import { detectProfile } from "../engine/profile-detector.js";

/**
 * FR-035, US-029: Display resolved project profile and conditioning mode.
 */
export const createProjectInfoCommand = () =>
  new Command("info")
    .description("Display resolved project profile")
    .option("--format <type>", "Output format (text, json)", "text")
    .action(async (options) => {
      const profile = await detectProfile(process.cwd());

      if (options.format === "json") {
        writeScopedStdout(`${JSON.stringify(profile, null, 2)}\n`);
      } else {
        writeScopedStdout(`Project Profile: ${profile.type}\n`);
        writeScopedStdout("Source: auto-detected\n");
        writeScopedStdout(
          `Language: ${profile.stack?.language || "unknown"}\n`,
        );
        writeScopedStdout(`Framework: ${profile.stack?.framework || "none"}\n`);
        writeScopedStdout(
          `Build System: ${profile.stack?.buildSystem || "unknown"}\n`,
        );
        if (profile.toolchain) {
          writeScopedStdout(
            `Toolchain: primary=${profile.toolchain.primary || "none"}, formatter=${profile.toolchain.formatter || "none"}, test=${profile.toolchain.test || "none"}\n`,
          );
        }
        writeScopedStdout(
          `Layout: ${typeof profile.layout === "string" ? profile.layout : JSON.stringify(profile.layout)}\n`,
        );
      }
    });

export const projectInfoCommand = createProjectInfoCommand();
