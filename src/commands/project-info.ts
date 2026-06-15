import { Command } from "commander";
import { detectProfile } from "../engine/profile-detector.js";

/**
 * FR-035, US-029: Display resolved project profile and conditioning mode.
 */
export const projectInfoCommand = new Command("info")
  .description("Display resolved project profile")
  .option("--format <type>", "Output format (text, json)", "text")
  .action(async (options) => {
    const profile = await detectProfile(process.cwd());

    if (options.format === "json") {
      process.stdout.write(JSON.stringify(profile, null, 2) + "\n");
    } else {
      process.stdout.write(`Project Profile: ${profile.type}\n`);
      process.stdout.write("Source: auto-detected\n");
      process.stdout.write(
        `Language: ${profile.stack?.language || "unknown"}\n`,
      );
      process.stdout.write(
        `Framework: ${profile.stack?.framework || "none"}\n`,
      );
      process.stdout.write(
        `Build System: ${profile.stack?.buildSystem || "unknown"}\n`,
      );
      if (profile.toolchain) {
        process.stdout.write(
          `Toolchain: primary=${profile.toolchain.primary || "none"}, formatter=${profile.toolchain.formatter || "none"}, test=${profile.toolchain.test || "none"}\n`,
        );
      }
      process.stdout.write(`Layout: ${typeof profile.layout === 'string' ? profile.layout : JSON.stringify(profile.layout)}\n`);
    }
  });
