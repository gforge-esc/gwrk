import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { dispatchAgent } from "../utils/agent.js";
import { loadConfig } from "../utils/config.js";
import { startRun, finishRun } from "../db/runs.js";
import { banner, success, fail, blocked } from "../utils/format.js";

export const analyzeCommand = new Command("analyze")
  .description("Analyze a feature for potential issues and gaps")
  .argument("<feature>", "The feature directory under specs/")
  .action(async (feature) => {
    const projectRoot = process.cwd();
    const relativeFeatureDir = path.join("specs", feature);
    const specPath = path.join(projectRoot, relativeFeatureDir, "spec.md");

    if (fs.existsSync(specPath)) {
      const specContent = fs.readFileSync(specPath, "utf-8");
      if (/^>?\s*\*\*Status:\*\*\s*Stub/im.test(specContent)) {
        blocked(`Spec ${feature} is marked as a Stub. Run 'gwrk run specify ${feature}' first.`);
        process.exit(1);
      }
    }

    const config = loadConfig(projectRoot);
    const backend = config.agents.define;

    const runId = startRun({
      feature_id: feature,
      command: "analyze",
      agent_backend: backend,
      workflow: "analyze",
    });

    banner("define analyze", {
      Feature: feature,
      Agent: backend,
      "Run ID": `${runId}`,
    });

    const startTime = Date.now();

    const result = await dispatchAgent({
      backend,
      workflowPath: ".agent/workflows/analyze.md",
      featureDir: relativeFeatureDir,
    });

    const durationS = Math.round((Date.now() - startTime) / 1000);

    if (result.exitCode !== 0) {
      finishRun(runId, { exit_code: result.exitCode, duration_s: durationS });
      fail("define analyze", result.exitCode, durationS, runId, result.logPath);
      process.exit(result.exitCode);
    }

    finishRun(runId, { exit_code: 0, duration_s: durationS });
    success("define analyze", durationS, runId, result.logPath);
  });
