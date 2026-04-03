import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { finishRun, startRun } from "../db/runs.js";
import { DefineOrchestrator } from "../engine/define-orchestrator.js";
import { loadConfig } from "../utils/config.js";
import { banner, blocked, fail, success } from "../utils/format.js";
import { readStdin } from "../utils/output.js";

import { CommandError, withSignal } from "../utils/signal.js";

export const planCommand = new Command("plan")
  .description("Create an implementation plan for a feature")
  .argument("<feature>", "The feature directory under specs/")
  .option("--refs <path>", "Path to additional reference docs")
  .action(async (feature, opts: { refs?: string }) => {
    await withSignal("define plan", async () => {
      const projectRoot = process.cwd();
      const config = loadConfig(projectRoot);
      const backend = config.agents.define;

      // TC-007: Read stdin if piped (discovery JSON)
      let contextPath: string | undefined;
      if (!process.stdin.isTTY) {
        const stdinContent = await readStdin();

        if (stdinContent.trim()) {
          try {
            // Verify valid JSON
            JSON.parse(stdinContent);
            const hash = Date.now();
            contextPath = `/tmp/gwrk-discovery-${hash}.json`;
            fs.writeFileSync(contextPath, stdinContent);
          } catch (e) {
            // Ignore if not valid JSON
          }
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
        ...(contextPath ? { Context: contextPath } : {}),
      });

      const startTime = Date.now();
      const orchestrator = new DefineOrchestrator();

      try {
        const result = await orchestrator.executePlan(feature, {
          agent: backend,
          projectRoot,
          refs: opts.refs,
        });

        const durationS = Math.round((Date.now() - startTime) / 1000);
        finishRun(runId, { exit_code: 0, duration_s: durationS });
        success("define plan", durationS, runId, result.logPath);
      } catch (error: unknown) {
        const durationS = Math.round((Date.now() - startTime) / 1000);
        const err = error as {
          exitCode?: number;
          message?: string;
          logPath?: string;
        };
        const exitCode = err.exitCode || 1;
        finishRun(runId, { exit_code: exitCode, duration_s: durationS });
        if (err.message) {
          blocked(err.message);
        }
        fail("define plan", exitCode, durationS, runId, err.logPath);
        process.exitCode = exitCode;
      }
    });
  });
