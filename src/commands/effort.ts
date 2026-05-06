import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { computeEffort } from "../engine/effort.js";
import { writeEffortReport } from "../engine/report-writer.js";
import { resolveRoleMultipliers } from "../engine/roles.js";
import { extractStories } from "../engine/spec-parser.js";
import { loadConfig } from "../utils/config.js";

import { CommandError, withSignal } from "../utils/signal.js";
import { resolveFeature } from "../utils/resolve-feature.js";

export const effortCommand = new Command("effort")
  .description("Calculate deterministic effort estimation from spec stories")
  .argument(
    "<feature>",
    "The feature directory under specs/ (e.g. 001-cli-core)",
  )
  .option("--json", "Output structured JSON report to stdout")
  .action(async (featureInput, options) => {
    await withSignal("effort", async () => {
      const projectRoot = process.cwd();
      const feature = resolveFeature(featureInput, projectRoot);
      const featureDir = path.join(projectRoot, "specs", feature);

      if (!fs.existsSync(featureDir)) {
        throw new CommandError(
          `Feature directory not found: ${featureDir}. Run 'gwrk project specs' to list available features.`,
          1,
        );
      }

      const config = loadConfig(projectRoot);
      const roleMultipliers = resolveRoleMultipliers(config);

      const stories = extractStories(featureDir);

      const report = computeEffort(stories, roleMultipliers, 1.25);
      report.featureId = feature;

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        const outDir = path.join(projectRoot, "docs", "assessments");
        const filePath = writeEffortReport(report, outDir);
        console.log(
          `Effort report generated at: ${path.relative(projectRoot, filePath)}`,
        );
      }
    });
  });
