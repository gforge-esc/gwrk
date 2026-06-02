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
      process.stdout.write(
        `Language: ${profile.stack?.language || "unknown"}\n`,
      );
      process.stdout.write(
        `Framework: ${profile.stack?.framework || "none"}\n`,
      );
      process.stdout.write(
        `Build System: ${profile.stack?.buildSystem || "unknown"}\n`,
      );
      process.stdout.write(`Layout: ${profile.layout}\n`);
    }
  });
