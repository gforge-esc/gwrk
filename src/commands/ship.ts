/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { finishRun, recordHistory, startRun } from "../db/runs.js";
import { PlanStore } from "../engine/plan-store.js";
import { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import type { ShipStage, ShipState } from "../engine/ship-types.js";

import { ShipBridge } from "../server/ship-bridge.js";
import { type TaskResult, dispatchToAgent } from "../utils/agent.js";
import { type AgentBackendId, loadConfig } from "../utils/config.js";
import { run } from "../utils/exec.js";
import {
  banner,
  blocked,
  color,
  dryRun as dryRunFmt,
  fail,
  success,
} from "../utils/format.js";
import {
  getCurrentBranch,
  getCurrentCommit,
  getDiffStats,
  isWorkingTreeClean,
} from "../utils/git.js";
import {
  assembleDigest,
  generateRunId,
  writeManifest,
} from "../utils/manifest.js";
import {
  type TaskState,
  loadTaskState,
  saveTaskState,
} from "../utils/state.js";

import { getBackendSelector } from "../server/index.js";
import { resolveFeature } from "../utils/resolve-feature.js";
import { resolveProjectId } from "../utils/project-id.js";
import {
  loadSetupState,
  isSetupComplete,
} from "../utils/setup-state.js";
import { CommandError, withSignal } from "../utils/signal.js";

const { GREEN, DIM, RESET, YELLOW, RED } = color;

/**
 * Ship a single phase through the full lifecycle.
 * Returns the exit code (0 = success, non-zero = failure).
 */
async function shipPhase(
  featureInput: string,
  phase: string,
  backend: AgentBackendId,
  opts: Record<string, string | boolean | undefined>,
  cwd: string,
  selectedModel?: string,
  selectedCommand?: string,
): Promise<number> {
  // Resolve prefix: "003" → "003-slack"
  const feature = resolveFeature(featureInput, cwd);
  const scriptPath = path.join(cwd, "scripts/dev/work-until-done.sh");
  // Normalize: accept "02", "2", or "phase-02" — scripts expect bare number
  const normalizedPhase = phase.replace(/^phase-/, "");
  const phaseId = `phase-${normalizedPhase.padStart(2, "0")}`;
  const featureDir = path.join(cwd, "specs", feature);

  // CRITICAL: Validate feature exists before ANY side effects.
  const specFile = path.join(featureDir, "spec.md");
  if (!fs.existsSync(specFile)) {
    const specsDir = path.join(cwd, "specs");
    const available = fs.existsSync(specsDir)
      ? fs
          .readdirSync(specsDir)
          .filter((d) => {
            const fp = path.join(specsDir, d);
            return (
              fs.statSync(fp).isDirectory() &&
              fs.existsSync(path.join(fp, "spec.md"))
            );
          })
          .map((d) => `    ${d}`)
          .join("\n")
      : "    (none)";
    console.error(
      `\n  Feature spec not found: specs/${feature}/spec.md\n  Available features:\n${available}\n`,
    );
    return 1;
  }

  // FR-008: Pre-flight check for test files
  let taskState: TaskState | undefined;
  try {
    taskState = loadTaskState(featureDir);
  } catch (err) {
    // If we can't load state, proceed (might be a new feature)
  }

  if (taskState) {
    const phaseData = taskState.phases.find((p) => p.id === phaseId);

    if (phaseData) {
      const files: string[] = [];
      for (const task of phaseData.tasks) {
        const text = `${task.title} ${task.description ?? ""}`;
        const matches = text.matchAll(
          /(?:src|tests|docs|scripts|packages)\/[^\s),]+/g,
        );
        for (const match of matches) {
          files.push(match[0].replace(/[,;.]$/, ""));
        }
      }

      const testFilesMentioned = files.filter(
        (f) => f.includes(".test.ts") || f.includes(".test.js"),
      );
      const sourceFiles = files.filter(
        (f) =>
          (f.endsWith(".ts") || f.endsWith(".js")) &&
          !f.includes(".test.") &&
          !f.includes(".d.ts"),
      );

      // Check filesystem for matching test files if not explicitly in tasks
      const matchingTestsOnDisk = sourceFiles
        .map((f) => f.replace(/\.(ts|js)$/, ".test.$1"))
        .filter((f) => fs.existsSync(path.join(cwd, f)));

      if (
        testFilesMentioned.length === 0 &&
        matchingTestsOnDisk.length === 0 &&
        sourceFiles.length > 0
      ) {
        blocked(`[BLOCKED] No test files found for ${phaseId}`);
        throw new CommandError(`No test files found for ${phaseId}`, 1);
      }
    }
  }

  const startedAt = new Date().toISOString();
  const startCommit = getCurrentCommit(cwd);

  const runId = startRun({
    feature_id: feature,
    phase_id: phaseId,
    command: "ship",
    agent_backend: backend,
    workflow: "work-until-done",
  });

  banner("ship", {
    Feature: feature,
    Phase: phase,
    Agent: backend,
    Model: selectedModel || "default",
    "Max Iter": opts.maxIterations as string,
    "CI Timeout": `${opts.ciTimeout}m`,
    "Run ID": `${runId}`,
    Orchestrator: opts.legacy ? "bash (legacy)" : "TypeScript",
  });

  const startTime = Date.now();
  let exitCode = 0;
  let orchestrator: ShipOrchestrator | undefined;

  try {
    if (opts.legacy) {
      await run(scriptPath, [feature, normalizedPhase], {
        cwd,
        env: {
          ...process.env,
          APPROVAL_MODE: "yolo",
          MAX_ITERATIONS: opts.maxIterations as string,
          CI_TIMEOUT: opts.ciTimeout as string,
          AGENT_BACKEND: backend,
          GEMINI_MODEL: selectedModel || process.env.GEMINI_MODEL,
        },
        stdio: "inherit",
      });
    } else {
      // FR-008: Crash recovery — load state if exists
      const statePath = path.join(cwd, ".runs", `${feature}_${phaseId}.state`);
      let existingState: ShipState | undefined;
      if (fs.existsSync(statePath)) {
        try {
          existingState = JSON.parse(fs.readFileSync(statePath, "utf-8"));
          // Iteration count is a circuit breaker for THIS invocation, not a
          // persistent counter. A new `gwrk ship` gets a fresh breaker.
          // Stage is preserved for crash recovery; iteration is not.
          existingState!.iteration = 1;
          console.log(`  🔄 Resuming from state: ${existingState?.stage}`);
        } catch (err) {
          console.warn(`  ⚠️ Corrupt state file — starting fresh: ${err}`);
        }
      }

      // Manual override for testing/emergency
      if (opts.resumeFrom && existingState) {
        existingState.stage = opts.resumeFrom as ShipStage;
      }

      const gwrkConfig = loadConfig(cwd);
      orchestrator = new ShipOrchestrator(
        {
          featureId: feature,
          phaseId: phaseId,
          backend,
          maxIterations: Number.parseInt(opts.maxIterations as string),
          ciTimeout: Number.parseInt(opts.ciTimeout as string),
          cwd,
          dryRun: !!opts.dryRun,
          selectedModel,
          selectedCommand,
          geminiModel: gwrkConfig.agents.gemini?.model,
          geminiFailbackModels: gwrkConfig.agents.gemini?.failbackModels,
        },
        existingState,
      );

      // Wire events to bridge for Slack notifications
      new ShipBridge(orchestrator, cwd);

      const planStore = new PlanStore(resolveProjectId(cwd));
      orchestrator.on("plan:ship:complete", (event) => {
        planStore.handleShipComplete(event);
      });

      exitCode = await orchestrator.run();
      if (exitCode !== 0) {
        throw new Error(`ShipOrchestrator failed with exit code ${exitCode}`);
      }

      // Write PR data + status back to DB for harvest to find
      const result = orchestrator.getResult();
      const durationS = Math.round((Date.now() - startTime) / 1000);
      const stats = getDiffStats(cwd, startCommit);
      finishRun(runId, {
        exit_code: 0,
        duration_s: durationS,
        status: "shipped",
        ...(result.prNumber ? { pr_number: result.prNumber } : {}),
        ...(result.prUrl ? { pr_url: result.prUrl } : {}),
        files_changed: stats.filesChanged,
        lines_added: stats.linesAdded,
        lines_deleted: stats.linesDeleted,
      });
      success("ship", durationS, runId);
    }

    // Legacy path success
    if (opts.legacy) {
      const durationS = Math.round((Date.now() - startTime) / 1000);
      const stats = getDiffStats(cwd, startCommit);
      finishRun(runId, {
        exit_code: 0,
        duration_s: durationS,
        status: "shipped",
        files_changed: stats.filesChanged,
        lines_added: stats.linesAdded,
        lines_deleted: stats.linesDeleted,
      });
      success("ship", durationS, runId);
    }
  } catch (err: unknown) {
    const durationS = Math.round((Date.now() - startTime) / 1000);
    const stats = getDiffStats(cwd, startCommit);
    exitCode =
      err instanceof Error &&
      "code" in err &&
      typeof (err as { code?: unknown }).code === "number"
        ? (err as { code: number }).code
        : 1;
    finishRun(runId, {
      exit_code: exitCode,
      duration_s: durationS,
      files_changed: stats.filesChanged,
      lines_added: stats.linesAdded,
      lines_deleted: stats.linesDeleted,
    });
    console.error(
      `\n  Error: ${err instanceof Error ? err.message : String(err)}`,
    );
    fail("ship", exitCode, durationS, runId);
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
    const result = orchestrator?.getResult();

    writeManifest(featureDir, {
      runId: manifestId,
      feature,
      phase: phaseId,
      command: "ship",
      agent: backend,
      model: selectedModel || "unknown",
      startedAt,
      finishedAt,
      durationS,
      exitCode,
      attempt: 1,
      gateResult: result?.gateResult,
      reviewVerdict: result?.reviewVerdict,
      filesChanged,
      linesAdded,
      linesDeleted,
      gitCommit,
      gitBranch,
      digest: assembleDigest(
        path.join(cwd, ".runs", `${feature}_p${normalizedPhase}.events`),
      ),
    });

    recordHistory({
      feature_id: feature,
      run_id: runId,
      from_status: "open",
      to_status: exitCode === 0 ? "completed" : "open",
      metadata: JSON.stringify({ command: "ship", manifestId }),
    });

    // Post-manifest commit: ensure working tree is clean before returning.
    try {
      const manifestDir = path.join(featureDir, ".gwrk", "runs");
      await run("git", ["add", manifestDir], { cwd });
      if (!isWorkingTreeClean(cwd)) {
        await run(
          "git",
          ["commit", "-m", `chore(${feature}): add execution manifest`],
          { cwd, env: { ...process.env, GWRK_SHIP: "1" } },
        );
        const currentBranch = getCurrentBranch(cwd);
        await run("git", ["push", "-u", "origin", currentBranch], { cwd });
      }
    } catch (pushErr) {
      console.warn(
        `Warning: Could not commit/push execution manifest: ${pushErr}`,
      );
    }
  } catch (manifestError) {
    console.warn(
      `Warning: Could not write execution manifest: ${manifestError}`,
    );
  }

  return exitCode;
}

/**
 * FR-014: Check if a phase should be skipped because all tasks are terminal.
 * Terminal statuses: "completed" or "cancelled".
 */
function isPhaseComplete(phaseData: TaskState["phases"][number]): boolean {
  return phaseData.tasks.every(
    (t) => t.status === "completed" || t.status === "cancelled",
  );
}

/**
 * FR-019: Direct agent dispatch via plugin facade (ADR-006).
 * Used when WUD orchestrator is not needed (e.g., single-task dispatch, testing).
 */
export async function dispatchPhaseWork(
  feature: string,
  phase: string,
  backend: AgentBackendId,
  workflow: string,
): Promise<TaskResult> {
  return dispatchToAgent({
    agent: backend,
    workflow,
    featureDir: `specs/${feature}`,
    prompt: `Phase ${phase}`,
  });
}

/**
 * gwrk ship — The Shipping Pillar (Throughput)
 *
 * Full autonomous lifecycle: branch → implement → review → PR → CI → done.
 * Phase is optional — when omitted, ships all phases of the feature sequentially.
 */
export const shipCommand = new Command("ship")
  .description("Ship: autonomous branch→implement→review→PR→CI loop")
  .addHelpText(
    "after",
    `
Type: mutator
Mutates: git branches, task state, execution manifests
Format: use gwrk --format json for structured output
Exit codes:
  0: All phases shipped successfully
  1: Phase failed or feature not found
  2: Usage error

Examples:
  gwrk ship 001 1
  gwrk ship 001-cli-core --dry-run
  gwrk ship 001 --agent gemini
`,
  )
  .argument("<feature>", "Feature ID")
  .argument("[phase]", "Phase number (omit to ship all phases)")
  .option("--dry-run", "Dry run mode")
  .option("--max-iterations <n>", "Max implement→review cycles", "3")
  .option("--ci-timeout <n>", "CI wait timeout in minutes", "30")
  .option(
    "--agent <agent>",
    "Override the default agent (e.g., gemini, claude, codex)",
  )
  .option("--format <format>", "Output format (json)")

  .option("--legacy", "Use legacy bash ship loop (work-until-done.sh)")
  .option(
    "--resume-from <stage>",
    "Resume from a specific stage (BRANCH_SETUP, IMPLEMENT, etc.)",
  )
  .option("--force", "Force ship even if phase is already complete")
  .action(
    async (
      featureArg: string,
      phase: string | undefined,
      opts: Record<string, string | boolean | undefined>,
    ) => {
      await withSignal("ship", async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);

        // Resolve webhook for cloud fallback (Phase 3 / T012)
        const webhookUrl =
          process.env.SLACK_WEBHOOK_URL || config.project.slack?.webhookUrl;
        if (webhookUrl) {
          // Webhook configured, will be used by ShipBridge via notifySlack
        }

        // Resolve prefix (e.g. "011" → "011-harvest")
        let feature: string;
        try {
          feature = resolveFeature(featureArg, cwd);
        } catch {
          console.error(`Feature not found: specs/${featureArg}`);
          throw new CommandError(
            `Feature not found: specs/${featureArg}. Run 'gwrk project specs' to list available features.`,
            1,
          );
        }

        // Validate feature exists before any work
        const featureSpecDir = path.join(cwd, "specs", feature);
        if (
          !fs.existsSync(featureSpecDir) ||
          !fs.existsSync(path.join(featureSpecDir, "spec.md"))
        ) {
          console.error(`Feature not found: specs/${feature}`);
          throw new CommandError(
            `Feature not found: specs/${feature}. Run 'gwrk project specs' to list available features.`,
            1,
          );
        }

        // FR-022: Workstation setup pre-flight check
        const setupState = loadSetupState();
        if (!isSetupComplete(setupState)) {
          blocked("Run gwrk init first");
          throw new CommandError("Run gwrk init first", 1);
        }



        // Determine which phases to ship
        let phases: string[];
        const specDir = path.join(cwd, "specs", feature);
        const taskState = loadTaskState(specDir);

        if (phase) {
          const phaseId = `phase-${phase.padStart(2, "0")}`;
          const phaseData = taskState.phases.find((p) => p.id === phaseId);

          // --force: always clear stale orchestrator state, regardless of task status
          if (opts.force) {
            const statePath = path.join(
              cwd,
              ".runs",
              `${feature}_${phaseId}.state`,
            );
            if (fs.existsSync(statePath)) {
              fs.unlinkSync(statePath);
            }
          }

          if (phaseData && isPhaseComplete(phaseData)) {
            if (!opts.force) {
              console.error(
                `${YELLOW}⚠${RESET} Phase ${phase} is already complete. Use --force to re-ship.`,
              );
              process.exitCode = 1;
              return;
            }
            // Reopen tasks
            for (const t of phaseData.tasks) {
              t.status = "open";
            }
            saveTaskState(specDir, taskState);
            // Commit the reset so the orchestrator sees a clean working tree
            execSync(
              `git add ${specDir}/.gwrk/tasks.json && git commit -m "chore(${feature}): reset phase ${phase} tasks for re-ship"`,
              {
                cwd,
                env: { ...process.env, GWRK_SHIP: "1" },
                stdio: "pipe",
              },
            );
            console.log(
              `${YELLOW}⚠${RESET} Force mode: resetting Phase ${phase} tasks to open`,
            );
          }
          phases = [phase];
        } else {
          const allPhases = taskState.phases.map((p) =>
            p.id.replace("phase-", ""),
          );

          // FR-014: Skip phases where all tasks are terminal (completed or cancelled)
          phases = allPhases.filter((phaseNum) => {
            const phaseId = `phase-${phaseNum.padStart(2, "0")}`;
            const phaseData = taskState.phases.find((p) => p.id === phaseId);
            if (!phaseData) return true;
            if (isPhaseComplete(phaseData)) {
              if (opts.force) {
                const statePath = path.join(
                  cwd,
                  ".runs",
                  `${feature}_${phaseId}.state`,
                );
                if (fs.existsSync(statePath)) {
                  fs.unlinkSync(statePath);
                }
                for (const t of phaseData.tasks) {
                  t.status = "open";
                }
                saveTaskState(specDir, taskState);
                // Commit the reset so the orchestrator sees a clean working tree
                execSync(
                  `git add ${specDir}/.gwrk/tasks.json && git commit -m "chore(${feature}): reset phase ${phaseNum} tasks for re-ship"`,
                  {
                    cwd,
                    env: { ...process.env, GWRK_SHIP: "1" },
                    stdio: "pipe",
                  },
                );
                console.log(
                  `${YELLOW}⚠${RESET} Force mode: resetting Phase ${phaseNum} tasks to open`,
                );
                return true;
              }
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
        const shipStartTime = Date.now();
        let finalExitCode = 0;
        for (const p of phases) {
          let currentBackend = opts.agent as string as AgentBackendId;
          let selectedModel: string | undefined;
          let selectedCommand: string | undefined;

          if (!currentBackend) {
            const selector = getBackendSelector(cwd);
            const selection = await selector.selectBackend({
              runId: `ship-${feature}-${Date.now()}`,
              feature,
              phase: `phase-${p.padStart(2, "0")}`,
              taskType: "implement",
              language: "typescript",
              taskSP: 1, // Default for orchestrator
            });
            currentBackend = selection.backend as AgentBackendId;
            selectedModel = selection.model;
            selectedCommand = selection.command;
            console.log(
              `  🤖 Router selected backend: ${selection.backend} (${selection.reason})`,
            );
          }

          const exitCode = await shipPhase(
            feature,
            p,
            currentBackend,
            opts,
            cwd,
            selectedModel,
            selectedCommand,
          );
          if (exitCode !== 0) {
            finalExitCode = exitCode;
            break;
          }
        }

        const totalDurationS = Math.round((Date.now() - shipStartTime) / 1000);

        // FR-015/T008: Agent-Native exit wrapper on stderr
        process.stderr.write(`[exit:${finalExitCode} | ${totalDurationS}s]\n`);

        // FR-015/T009: JSON output mode
        if (opts.format === "json") {
          const output = {
            feature,
            phase: phase || "all",
            exitCode: finalExitCode,
            durationS: totalDurationS,
            runId: `ship-${feature}`,
          };
          process.stdout.write(`${JSON.stringify(output)}\n`);
        }

        if (finalExitCode !== 0) {
          process.exitCode = finalExitCode;
        }
      });
    },
  );
