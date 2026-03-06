import { Command } from "commander";
import path from "node:path";
import fs from "node:fs";
import { startRun, finishRun } from "../db/runs.js";
import { run, runGate } from "../utils/exec.js";
import { loadConfig } from "../utils/config.js";
import { loadTaskState } from "../utils/state.js";
import { banner, success, fail, dryRun, color } from "../utils/format.js";

const { YELLOW, DIM, RESET, GREEN, RED } = color;

export const implementCommand = new Command("implement")
  .description("Implement a feature or fix")
  .argument("<feature>", "Feature ID")
  .argument("<phase>", "Phase number")
  .option("--dry-run", "Dry run mode")
  .action(async (feature: string, phase: string, opts: { dryRun?: boolean }) => {
    const cwd = process.cwd();
    const specDir = path.join(cwd, "specs", feature);
    const scriptPath = path.join(cwd, "scripts/dev/agent-run.sh");

    const config = loadConfig(cwd);
    const backend = config.agents.implement;

    const phaseId = `phase-${phase.padStart(2, "0")}`;
    const tasks = loadTaskState(specDir);
    const phaseData = tasks.phases.find(p => p.id === phaseId);

    if (!phaseData) {
      console.error(`${RED}✗${RESET} Phase ${phaseId} not found in tasks.json`);
      process.exit(1);
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
            console.log(`${YELLOW}⚠${RESET} ${task.id} pre-flight PASS — gate already satisfied, skipping`);
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
          env: { ...process.env, APPROVAL_MODE: "yolo" },
          stdio: "inherit",
        });
      }

      const durationS = Math.round((Date.now() - startTime) / 1000);
      finishRun(runId, { exit_code: 0, duration_s: durationS });
      success("implement", durationS, runId);
    } catch (err: unknown) {
      const durationS = Math.round((Date.now() - startTime) / 1000);
      exitCode = err instanceof Error && "code" in err ? (err as { code: number }).code : 1;
      finishRun(runId, { exit_code: exitCode, duration_s: durationS });
      fail("implement", exitCode, durationS, runId);
      process.exit(exitCode);
    }
  });
