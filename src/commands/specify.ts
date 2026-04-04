import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { finishRun, startRun } from "../db/runs.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import { loadConfig } from "../utils/config.js";
import { banner, fail, success } from "../utils/format.js";
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
        const runtime = new WorkflowRuntime();

        // Detect mode: rework (spec exists) vs new (spec doesn't exist)
        const specDir = path.join(cwd, "specs", feature);
        const specFile = path.join(specDir, "spec.md");
        const isRework = fs.existsSync(specFile);

        // If no prompt arg, try stdin
        let effectiveInput = prompt;
        if (!effectiveInput && !process.stdin.isTTY) {
          const stdinContent = await readStdin();
          if (stdinContent.trim()) {
            effectiveInput = stdinContent.trim();
          }
        }

        // Build the effective prompt
        let effectivePrompt: string;
        if (isRework) {
          const reworkInstructions =
            effectiveInput || "Review and refine this specification";
          effectivePrompt = `REWORK existing spec for feature ${feature}.\n\nExisting spec: specs/${feature}/spec.md\n\nRework instructions: ${reworkInstructions}`;
        } else {
          if (!effectiveInput) {
            throw new CommandError(
              `No spec found at specs/${feature}/spec.md and no prompt provided.\nFor new specs, provide a description:\n  gwrk define spec ${feature} "Description of the feature"`,
              1,
            );
          }
          effectivePrompt = `Create a NEW spec for feature ${feature}.\n\nDescription: ${effectiveInput}`;
        }

        // Append refs context if provided
        if (opts.refs && fs.existsSync(opts.refs)) {
          const refsContent = fs.readFileSync(opts.refs, "utf-8");
          effectivePrompt += `\n\nReference document (${opts.refs}):\n${refsContent}`;
        }

        const mode = isRework ? "rework" : "new";

        const runId = startRun({
          feature_id: feature,
          command: "define spec",
          agent_backend: backend,
          workflow: "specify",
        });

        banner("define spec", {
          Agent: backend,
          Feature: feature,
          Mode: mode,
          ...(prompt
            ? {
              Prompt: `"${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}"`,
            }
            : {}),
          "Run ID": `${runId}`,
          ...(opts.refs ? { Refs: opts.refs } : {}),
        });

        const startTime = Date.now();

        try {
          const result = await runtime.executeWorkflow(
            "gwrk-specify",
            effectivePrompt,
            {
              agent: backend,
              projectRoot: cwd,
            },
          );

          const durationS = Math.round((Date.now() - startTime) / 1000);
          finishRun(runId, { exit_code: 0, duration_s: durationS });
          success("define spec", durationS, runId);
        } catch (err: unknown) {
          const durationS = Math.round((Date.now() - startTime) / 1000);
          const msg = err instanceof Error ? err.message : String(err);
          finishRun(runId, {
            exit_code: 1,
            duration_s: durationS,
          });
          fail("define spec", 1, durationS, runId);
          console.error(msg);
          process.exitCode = 1;
        }
      });
    },
  );
