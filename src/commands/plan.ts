import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { dispatchAgent } from "../utils/agent.js";
import { loadConfig } from "../utils/config.js";
import { startRun, finishRun } from "../db/runs.js";
import { banner, success, fail, blocked } from "../utils/format.js";

export const planCommand = new Command("plan")
  .description("Create an implementation plan for a feature")
  .argument("<feature>", "The feature directory under specs/")
  .option("--refs <path>", "Path to additional reference docs")
  .action(async (feature, opts: { refs?: string }) => {
    const projectRoot = process.cwd();
    const relativeFeatureDir = path.join("specs", feature);
    const featureDir = path.join(projectRoot, relativeFeatureDir);
    const specPath = path.join(featureDir, "spec.md");

    if (!fs.existsSync(specPath)) {
      blocked("spec.md not found");
      process.exit(1);
    }

    const specContent = fs.readFileSync(specPath, "utf-8");
    if (/^>?\s*\*\*Status:\*\*\s*Stub/im.test(specContent)) {
      blocked(`Spec ${feature} is marked as a Stub. Run 'gwrk define spec ${feature}' first.`);
      process.exit(1);
    }

    const config = loadConfig(projectRoot);
    const backend = config.agents.define;

    const runId = startRun({
      feature_id: feature,
      command: "define plan",
      agent_backend: backend,
      workflow: "plan",
    });

    banner("define plan", {
      Feature: feature,
      Agent: backend,
      "Run ID": `${runId}`,
      ...(opts.refs ? { Refs: opts.refs } : {}),
    });

    const startTime = Date.now();

    const result = await dispatchAgent({
      backend,
      workflowPath: ".agent/workflows/plan.md",
      featureDir: relativeFeatureDir,
    });

    const durationS = Math.round((Date.now() - startTime) / 1000);

    if (result.exitCode !== 0) {
      finishRun(runId, { exit_code: result.exitCode, duration_s: durationS });
      fail("define plan", result.exitCode, durationS, runId, result.logPath);
      process.exit(result.exitCode);
    }

    finishRun(runId, { exit_code: 0, duration_s: durationS });
    success("define plan", durationS, runId, result.logPath);
  });
