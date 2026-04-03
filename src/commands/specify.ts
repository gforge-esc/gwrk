import path from "node:path";
import { Command } from "commander";
import { finishRun, startRun } from "../db/runs.js";
// rewired to WorkflowRuntime via DefineOrchestrator
import { DefineOrchestrator } from "../engine/define-orchestrator.js";
import { loadConfig } from "../utils/config.js";
import { banner, blocked, fail, success } from "../utils/format.js";
import { readStdin } from "../utils/output.js";

import { CommandError, withSignal } from "../utils/signal.js";

export const specifyCommand = new Command("spec")
  .description("Create or refine a feature specification")
  .argument("<feature>", "Feature ID (e.g. 014-plugin-system)")
  .argument("[prompt]", "Rework instructions or new feature description")
  .option("--refs <path>", "Path to additional reference docs")
  .action(
    async (
      feature: string,
      prompt: string | undefined,
      opts: { refs?: string },
    ) => {
      await withSignal("define spec", async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const backend = config.agents.define;

        // If no prompt arg, try stdin
        if (!prompt && !process.stdin.isTTY) {
          const stdinContent = await readStdin();
          if (stdinContent.trim()) {
            prompt = stdinContent.trim();
          }
        }

        const runId = startRun({
          feature_id: feature,
          command: "define spec",
          agent_backend: backend,
          workflow: "specify",
        });

        banner("define spec", {
          Agent: backend,
          Feature: feature,
          ...(prompt
            ? {
                Prompt: `"${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}"`,
              }
            : {}),
          "Run ID": `${runId}`,
          ...(opts.refs ? { Refs: opts.refs } : {}),
        });

        const startTime = Date.now();
        const orchestrator = new DefineOrchestrator();

        try {
          const result = await orchestrator.executeSpecify(feature, prompt, {
            agent: backend,
            projectRoot: cwd,
            refs: opts.refs,
          });

          const durationS = Math.round((Date.now() - startTime) / 1000);
          finishRun(runId, { exit_code: 0, duration_s: durationS });
          success("define spec", durationS, runId, result.logPath);
        } catch (error: unknown) {
          const durationS = Math.round((Date.now() - startTime) / 1000);
          const err = error as { exitCode?: number; message?: string; logPath?: string };
          const exitCode = err.exitCode || 1;
          finishRun(runId, {
            exit_code: exitCode,
            duration_s: durationS,
          });
          if (err.message) {
            blocked(err.message);
          }
          fail("define spec", exitCode, durationS, runId, err.logPath);
          process.exitCode = exitCode;
        }
      });
    },
  );
