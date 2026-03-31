import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { finishRun, startRun } from "../db/runs.js";
import { dispatchAgent } from "../utils/agent.js";
import { loadConfig } from "../utils/config.js";
import { banner, fail, success } from "../utils/format.js";
import { readStdin } from "../utils/output.js";

import { CommandError, withSignal } from "../utils/signal.js";

export const specifyCommand = new Command("spec")
  .description("Create or refine a feature specification")
  .argument("<feature>", "Feature ID (e.g. 014-plugin-system)")
  .argument("[prompt]", "Rework instructions or new feature description")
  .option("--refs <path>", "Path to additional reference docs")
  .action(async (feature: string, prompt: string | undefined, opts: { refs?: string }) => {
    await withSignal("define spec", async () => {
      const cwd = process.cwd();
      const config = loadConfig(cwd);
      const backend = config.agents.define;

      // Detect mode: rework (spec exists) vs new (spec doesn't exist)
      const specDir = path.join(cwd, "specs", feature);
      const specFile = path.join(specDir, "spec.md");
      const isRework = fs.existsSync(specFile);

      // If no prompt arg, try stdin
      if (!prompt && !process.stdin.isTTY) {
        const stdinContent = await readStdin();
        if (stdinContent.trim()) {
          prompt = stdinContent.trim();
        }
      }

      // Build the effective prompt
      let effectivePrompt: string;
      if (isRework) {
        const reworkInstructions = prompt || "Review and refine this specification";
        effectivePrompt = `REWORK existing spec for feature ${feature}.\n\nExisting spec: specs/${feature}/spec.md\n\nRework instructions: ${reworkInstructions}`;
      } else {
        if (!prompt) {
          throw new CommandError(
            `No spec found at specs/${feature}/spec.md and no prompt provided.\n` +
            `For new specs, provide a description:\n` +
            `  gwrk define spec ${feature} "Description of the feature"`,
            1,
          );
        }
        effectivePrompt = `Create a NEW spec for feature ${feature}.\n\nDescription: ${prompt}`;
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
        ...(prompt ? { Prompt: `"${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}"` } : {}),
        "Run ID": `${runId}`,
        ...(opts.refs ? { Refs: opts.refs } : {}),
      });

      const startTime = Date.now();

      const result = await dispatchAgent({
        backend,
        workflowPath: ".agents/workflows/gwrk-specify.md",
        featureDir: specDir,
        prompt: effectivePrompt,
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
