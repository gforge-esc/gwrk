import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { finishRun, startRun } from "../db/runs.js";
import { loadConfig } from "../utils/config.js";
import { run, runGate } from "../utils/exec.js";
import { banner, color, dryRun, fail, success } from "../utils/format.js";
import { appendHistory } from "../utils/history.js";
import {
  loadTaskState,
  markTaskComplete,
  saveTaskState,
} from "../utils/state.js";

import { resolveFeature } from "../utils/resolve-feature.js";
import { CommandError, withSignal } from "../utils/signal.js";

const { YELLOW, DIM, RESET, GREEN, RED } = color;

export const implementAction = async (
  featureInput: string,
  phase: string,
  opts: { dryRun?: boolean; agent?: string },
) => {
  await withSignal("implement", async () => {
    const cwd = process.cwd();
    const feature = resolveFeature(featureInput, cwd);
    const specDir = path.join(cwd, "specs", feature);
    const scriptPath = path.join(cwd, "scripts/dev/agent-run.sh");

    const config = loadConfig(cwd);
    const backend = opts.agent || config.agents.implement;

    const phaseId = `phase-${phase.padStart(2, "0")}`;
    const tasks = loadTaskState(specDir);
    const phaseData = tasks.phases.find((p) => p.id === phaseId);

    if (!phaseData) {
      throw new CommandError(`Phase ${phaseId} not found in tasks.json`, 1);
    }

    const runId = startRun({
      feature_id: feature,
      phase_id: phaseId,
      command: "implement",
      agent_backend: backend,
      workflow: "implement",
    });

    banner("implement", {
      Feature: feature,
      Phase: phase,
      Agent: backend,
      "Run ID": `${runId}`,
    });

    const startTime = Date.now();
    let exitCode = 0;

    try {
      for (const task of phaseData.tasks) {
        if (task.status === "completed") continue;
        if (task.status === "cancelled") continue;

        const gatePath = path.join(specDir, "gates", `${task.id}-gate.sh`);

        if (fs.existsSync(gatePath)) {
          const result = runGate(gatePath);
          if (result.exitCode === 0) {
            console.log(
              `${YELLOW}⚠${RESET} ${task.id} pre-flight PASS — gate already satisfied, skipping`,
            );
            const currentState = loadTaskState(specDir);
            const currentTask = currentState.phases
              .flatMap((p) => p.tasks)
              .find((t) => t.id === task.id);
            if (currentTask && currentTask.status !== "completed") {
              const newState = markTaskComplete(currentState, task.id);
              saveTaskState(specDir, newState);
              appendHistory({
                timestamp: new Date().toISOString(),
                featureId: feature,
                taskId: task.id,
                fromStatus: task.status,
                toStatus: "completed",
              });
            }
            continue;
          }
        }

        if (opts.dryRun) {
          dryRun(`${scriptPath} implement ${feature} ${phase} ${task.id}`);
          continue;
        }

        console.log(`${GREEN}▶${RESET} Implementing ${task.id}: ${task.title}`);
        await run(scriptPath, ["implement", feature, phase, task.id], {
          cwd,
          env: {
            ...process.env,
            APPROVAL_MODE: "yolo",
            AGENT_BACKEND: backend,
          },
          stdio: "inherit",
        });

        // Verify the gate after agent execution
        if (fs.existsSync(gatePath)) {
          console.log(`\n${DIM}Verifying gate for ${task.id}...${RESET}`);
          const postResult = runGate(gatePath);
          if (postResult.exitCode === 0) {
            console.log(
              `${GREEN}✓${RESET} ${task.id} gate passed. Marking completed.`,
            );
            const currentState = loadTaskState(specDir);
            const currentTask = currentState.phases
              .flatMap((p) => p.tasks)
              .find((t) => t.id === task.id);
            if (currentTask && currentTask.status !== "completed") {
              const newState = markTaskComplete(currentState, task.id);
              saveTaskState(specDir, newState);
              appendHistory({
                timestamp: new Date().toISOString(),
                featureId: feature,
                taskId: task.id,
                fromStatus: task.status,
                toStatus: "completed",
              });
            }
          } else {
            console.log(
              `${YELLOW}⚠${RESET} ${task.id} gate failed after implementation.`,
            );
            if (postResult.stdout) process.stdout.write(postResult.stdout);
            if (postResult.stderr) process.stderr.write(postResult.stderr);
            throw new Error(`Gate failed for ${task.id}`);
          }
        }
      }

      const durationS = Math.round((Date.now() - startTime) / 1000);
      finishRun(runId, { exit_code: 0, duration_s: durationS });
      success("implement", durationS, runId);
    } catch (err: unknown) {
      console.error(err);
      const durationS = Math.round((Date.now() - startTime) / 1000);
      exitCode =
        err instanceof Error && "code" in err
          ? (err as { code: number }).code
          : 1;
      finishRun(runId, { exit_code: exitCode, duration_s: durationS });
      fail("implement", exitCode, durationS, runId);
      process.exitCode = exitCode;
    }
  });
};

export const implementCommand = new Command("implement")
  .description("Implement a feature or fix")
  .argument("<feature>", "Feature ID")
  .argument("<phase>", "Phase number")
  .option("--dry-run", "Dry run mode")
  .option(
    "--agent <agent>",
    "Override the default agent (e.g., gemini, claude, codex)",
  )
  .action(implementAction);
