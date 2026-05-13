import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { finishRun, startRun } from "../db/runs.js";
import { PlanStore } from "../engine/plan-store.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import { loadConfig } from "../utils/config.js";
import { banner, blocked, fail, success } from "../utils/format.js";
import { readStdin } from "../utils/output.js";

import { resolveFeature } from "../utils/resolve-feature.js";
import { CommandError, withSignal } from "../utils/signal.js";

export const planCommand = new Command("plan")
  .description("Create an implementation plan for a feature")
  .addHelpText(
    "after",
    `
Examples:
  gwrk define plan 001
  gwrk define plan 001-cli-core --refs docs/reference/
  cat discovery.json | gwrk define plan 001
`,
  )
  .argument("<feature>", "The feature directory under specs/")
  .option("--refs <path>", "Path to additional reference docs")
  .action(async (featureArg, opts: { refs?: string }) => {
    await withSignal("define plan", async () => {
      const projectRoot = process.cwd();
      const feature = resolveFeature(featureArg, projectRoot);
      const relativeFeatureDir = path.join("specs", feature);
      const featureDir = path.join(projectRoot, relativeFeatureDir);
      const specPath = path.join(featureDir, "spec.md");

      if (!fs.existsSync(specPath)) {
        blocked("spec.md not found");
        throw new CommandError(
          "spec.md not found. Run 'gwrk define spec <feature>' to create. See 'gwrk project specs' for available features.",
          1,
        );
      }

      const specContent = fs.readFileSync(specPath, "utf-8");
      if (/^>?\s*\*\*Status:\*\*\s*Stub/im.test(specContent)) {
        const msg = `Spec ${feature} is marked as a Stub. Run 'gwrk define spec ${feature}' first.`;
        blocked(msg);
        throw new CommandError(msg, 1);
      }

      const config = loadConfig(projectRoot);
      const backend = config.agents.define;
      const runtime = new WorkflowRuntime();

      // TC-007: Read stdin if piped (discovery JSON)
      let contextContent: string | undefined;
      if (!process.stdin.isTTY) {
        const stdinContent = await readStdin();
        if (stdinContent.trim()) {
          contextContent = stdinContent.trim();
        }
      }

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

      try {
        const input = `Plan implementation for feature ${feature}${contextContent ? `\n\nContext:\n${contextContent}` : ""}${opts.refs ? `\n\nReference: ${opts.refs}` : ""}`;
        const result = await runtime.executeWorkflow("gwrk-plan", input, {
          agent: backend,
          projectRoot,
        });

        const durationS = Math.round((Date.now() - startTime) / 1000);
        finishRun(runId, { exit_code: 0, duration_s: durationS });
        success("define plan", durationS, runId);

        const planStore = new PlanStore();
        planStore.handleDefineComplete({
          featureId: feature,
          status: "DEFINED",
        });
      } catch (err: unknown) {
        const durationS = Math.round((Date.now() - startTime) / 1000);
        const msg = err instanceof Error ? err.message : String(err);
        finishRun(runId, { exit_code: 1, duration_s: durationS });
        fail("define plan", 1, durationS, runId);
        console.error(msg);
        process.exitCode = 1;
      }
    });
  });
