import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { dispatchAgent } from "../utils/agent.js";
import { loadConfig } from "../utils/config.js";

export const planCommand = new Command("plan")
  .description("Create an implementation plan for a feature")
  .argument("<feature>", "The feature directory under specs/")
  .action(async (feature) => {
    const projectRoot = process.cwd();
    const relativeFeatureDir = path.join("specs", feature);
    const featureDir = path.join(projectRoot, relativeFeatureDir);
    const specPath = path.join(featureDir, "spec.md");

    if (!fs.existsSync(specPath)) {
      console.error("spec.md not found");
      process.exit(1);
    }

    const config = loadConfig(projectRoot);
    const result = await dispatchAgent({
      backend: config.agents.define,
      workflowPath: ".agent/workflows/plan.md",
      featureDir: relativeFeatureDir,
    });

    if (result.exitCode !== 0) {
      if (result.stderr) console.error(result.stderr);
      process.exit(result.exitCode);
    }

    if (result.stdout) console.log(result.stdout);
  });
