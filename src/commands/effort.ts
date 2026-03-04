import path from "node:path";
import { Command } from "commander";
import { dispatchAgent } from "../utils/agent.js";
import { loadConfig } from "../utils/config.js";

export const effortCommand = new Command("effort")
  .description("Estimate the development effort for a feature")
  .argument("<feature>", "The feature directory under specs/")
  .action(async (feature) => {
    const projectRoot = process.cwd();
    const relativeFeatureDir = path.join("specs", feature);
    const config = loadConfig(projectRoot);
    const result = await dispatchAgent({
      backend: config.agents.define,
      workflowPath: ".agent/workflows/effort.md",
      featureDir: relativeFeatureDir,
    });

    if (result.exitCode !== 0) {
      if (result.stderr) console.error(result.stderr);
      process.exit(result.exitCode);
    }

    if (result.stdout) console.log(result.stdout);
  });
