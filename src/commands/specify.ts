import { Command } from "commander";
import { dispatchAgent } from "../utils/agent.js";
import { loadConfig } from "../utils/config.js";
import { startRun, finishRun } from "../db/runs.js";
import { banner, success, fail } from "../utils/format.js";

export const specifyCommand = new Command("spec")
  .description("Create or refine a feature specification")
  .argument("<prompt>", "The feature description or prompt")
  .option("--refs <path>", "Path to additional reference docs")
  .action(async (prompt, opts: { refs?: string }) => {
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    const backend = config.agents.define;

    const runId = startRun({
      feature_id: prompt,
      command: "define spec",
      agent_backend: backend,
      workflow: "specify",
    });

    banner("define spec", {
      Agent: backend,
      Prompt: `"${prompt}"`,
      "Run ID": `${runId}`,
      ...(opts.refs ? { Refs: opts.refs } : {}),
    });

    const startTime = Date.now();

    const result = await dispatchAgent({
      backend,
      workflowPath: ".agent/workflows/specify.md",
      prompt,
    });

    const durationS = Math.round((Date.now() - startTime) / 1000);

    if (result.exitCode !== 0) {
      finishRun(runId, { exit_code: result.exitCode, duration_s: durationS });
      fail("define spec", result.exitCode, durationS, runId, result.logPath);
      process.exit(result.exitCode);
    }

    finishRun(runId, { exit_code: 0, duration_s: durationS });
    success("define spec", durationS, runId, result.logPath);
  });
