import { Command } from "commander";
import { finishRun, startRun } from "../db/runs.js";
import { dispatchAgent } from "../utils/agent.js";
import { loadConfig } from "../utils/config.js";
import { banner, fail, success } from "../utils/format.js";

import { CommandError, withSignal } from "../utils/signal.js";

export const specifyCommand = new Command("spec")
  .description("Create or refine a feature specification")
  .argument("<prompt>", "The feature description or prompt")
  .option("--refs <path>", "Path to additional reference docs")
  .action(async (prompt, opts: { refs?: string }) => {
    await withSignal("define spec", async () => {
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
        workflowPath: ".agents/workflows/specify.md",
        prompt,
      });

      const durationS = Math.round((Date.now() - startTime) / 1000);

      if (result.exitCode !== 0) {
        finishRun(runId, { exit_code: result.exitCode, duration_s: durationS });
        fail("define spec", result.exitCode, durationS, runId, result.logPath);
        process.exitCode = result.exitCode;
        return;
      }

      finishRun(runId, { exit_code: 0, duration_s: durationS });
      success("define spec", durationS, runId, result.logPath);
    });
  });
