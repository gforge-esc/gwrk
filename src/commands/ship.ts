import path from "node:path";
import { Command } from "commander";
import { finishRun, recordHistory, startRun } from "../db/runs.js";
import { loadConfig } from "../utils/config.js";
import { MessageBuilder } from "../server/slack-messages.js";
import { notifySlack } from "../server/slack-notify.js";
import type { SlackEvent } from "../server/slack-presence.js";
import type { DispatchRecord } from "../server/types.js";
import { run } from "../utils/exec.js";
import {
  banner,
  color,
  dryRun as dryRunFmt,
  fail,
  success,
} from "../utils/format.js";
import {
  getCurrentBranch,
  getCurrentCommit,
  getDiffStats,
} from "../utils/git.js";
import { generateRunId, writeManifest } from "../utils/manifest.js";
import { loadTaskState } from "../utils/state.js";

const { GREEN, DIM, RESET } = color;

/**
 * Ship a single phase through the full lifecycle.
 * Returns the exit code (0 = success, non-zero = failure).
 */
async function shipPhase(
  feature: string,
  phase: string,
  backend: string,
  opts: Record<string, string | boolean | undefined>,
  cwd: string,
): Promise<number> {
  const scriptPath = path.join(cwd, "scripts/dev/work-until-done.sh");
  const phaseId = `phase-${phase.padStart(2, "0")}`;
  const startedAt = new Date().toISOString();

  const runId = startRun({
    feature_id: feature,
    phase_id: phaseId,
    command: "ship",
    agent_backend: backend,
    workflow: "work-until-done",
  });

  const record: DispatchRecord = {
    id: `ship-${runId}`,
    featureId: feature,
    phaseId: phaseId,
    backend: backend as any,
    status: "running",
    branchName: getCurrentBranch(cwd),
    attempts: [{ attemptNumber: 1, backend: backend as any, startedAt }],
    createdAt: startedAt,
  };

  await notifySlack(MessageBuilder.phaseStart(record), {
    type: "phase_start",
    feature: record.featureId,
    phase: record.phaseId,
    payload: record as unknown as Record<string, unknown>,
    timestamp: new Date().toISOString(),
  });

  banner("ship", {
    Feature: feature,
    Phase: phase,
    Agent: backend,
    "Max Iter": opts.maxIterations as string,
    "CI Timeout": `${opts.ciTimeout}m`,
    "Run ID": `${runId}`,
  });

  const startTime = Date.now();
  let exitCode = 0;

  try {
    await run(scriptPath, [feature, phase], {
      cwd,
      env: {
        ...process.env,
        APPROVAL_MODE: "yolo",
        MAX_ITERATIONS: opts.maxIterations as string,
        CI_TIMEOUT: opts.ciTimeout as string,
        AGENT_BACKEND: backend,
      },
      stdio: "inherit",
    });

    const durationS = Math.round((Date.now() - startTime) / 1000);
    finishRun(runId, { exit_code: 0, duration_s: durationS });
    success("ship", durationS, runId);

    record.status = "completed";
    await notifySlack(MessageBuilder.phaseComplete(record), {
      type: "phase_complete",
      feature: record.featureId,
      phase: record.phaseId,
      payload: record as unknown as Record<string, unknown>,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const durationS = Math.round((Date.now() - startTime) / 1000);
    exitCode =
      err instanceof Error && "code" in err
        ? (err as { code: number }).code
        : 1;
    finishRun(runId, { exit_code: exitCode, duration_s: durationS });
    fail("ship", exitCode, durationS, runId);

    record.status = "failed";
    await notifySlack(
      MessageBuilder.phaseFail(
        record,
        err instanceof Error ? err.message : String(err),
      ),
      {
        type: "phase_fail",
        feature: record.featureId,
        phase: record.phaseId,
        payload: { ...record, error: err instanceof Error ? err.message : String(err) } as unknown as Record<string, unknown>,
        timestamp: new Date().toISOString(),
      },
    );
  }

  // Write Execution Manifest (ADR-003)
  try {
    const finishedAt = new Date().toISOString();
    const durationS = Math.round((Date.now() - startTime) / 1000);
    const gitCommit = getCurrentCommit(cwd);
    const gitBranch = getCurrentBranch(cwd);
    const { filesChanged, linesAdded, linesDeleted } = getDiffStats(
      cwd,
      `${gitCommit}~1`,
    );

    const manifestId = generateRunId(startedAt, "ship", phaseId);
    const featureDir = path.join(cwd, "specs", feature);

    writeManifest(featureDir, {
      runId: manifestId,
      feature,
      phase: phaseId,
      command: "ship",
      agent: backend,
      model: "unknown",
      startedAt,
      finishedAt,
      durationS,
      exitCode,
      attempt: 1,
      filesChanged,
      linesAdded,
      linesDeleted,
      gitCommit,
      gitBranch,
    });

    recordHistory({
      feature_id: feature,
      run_id: runId,
      from_status: "open",
      to_status: exitCode === 0 ? "completed" : "open",
      metadata: JSON.stringify({ command: "ship", manifestId }),
    });
  } catch (manifestError) {
    console.warn(
      `Warning: Could not write execution manifest: ${manifestError}`,
    );
  }

  return exitCode;
}

/**
 * gwrk ship — The Shipping Pillar (Throughput)
 *
 * Full autonomous lifecycle: branch → implement → review → PR → CI → done.
 * Phase is optional — when omitted, ships all phases of the feature sequentially.
 */
export const shipCommand = new Command("ship")
  .description("Ship: autonomous branch→implement→review→PR→CI loop")
  .argument("<feature>", "Feature ID")
  .argument("[phase]", "Phase number (omit to ship all phases)")
  .option("--dry-run", "Dry run mode")
  .option("--max-iterations <n>", "Max implement→review cycles", "3")
  .option("--ci-timeout <n>", "CI wait timeout in minutes", "30")
  .option(
    "--agent <agent>",
    "Override the default agent (e.g., gemini, claude, codex)",
  )
  .action(
    async (
      feature: string,
      phase: string | undefined,
      opts: Record<string, string | boolean | undefined>,
    ) => {
      const cwd = process.cwd();
      const config = loadConfig(cwd);
      const backend = (opts.agent as string) || config.agents.implement;

      // Determine which phases to ship
      let phases: string[];
      if (phase) {
        phases = [phase];
      } else {
        const specDir = path.join(cwd, "specs", feature);
        const taskState = loadTaskState(specDir);
        const allPhases = taskState.phases.map((p) =>
          p.id.replace("phase-", ""),
        );

        // FR-014: Skip phases where all tasks are already completed
        phases = allPhases.filter((phaseNum) => {
          const phaseData = taskState.phases.find(
            (p) => p.id === `phase-${phaseNum.padStart(2, "0")}`,
          );
          if (!phaseData) return true;
          const allComplete = phaseData.tasks.every(
            (t) => t.status === "completed",
          );
          if (allComplete) {
            console.log(
              `  ⏭  Phase ${phaseNum}: all tasks complete — skipping`,
            );
            return false;
          }
          return true;
        });

        if (phases.length === 0) {
          console.log(
            `${GREEN}✓${RESET} All phases complete for ${feature} — nothing to ship`,
          );
          return;
        }

        console.log(
          `${GREEN}▶${RESET} Shipping feature ${feature}: ${phases.length} phases${DIM} (${phases.map((p) => `P${p}`).join(", ")})${RESET}`,
        );
      }

      if (opts.dryRun) {
        const scriptPath = path.join(cwd, "scripts/dev/work-until-done.sh");
        for (const p of phases) {
          dryRunFmt(`${scriptPath} ${feature} ${p}`);
        }
        return;
      }

      // Ship each phase sequentially — stop on first failure
      for (const p of phases) {
        const exitCode = await shipPhase(feature, p, backend, opts, cwd);
        if (exitCode !== 0) {
          process.exit(exitCode);
        }
      }
    },
  );
