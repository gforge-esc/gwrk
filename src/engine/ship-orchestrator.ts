import { execSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import {
  resolveReviewPlugin,
  validatePhaseScope,
} from "../plugins/review-plugin.js";

import {
  type TaskDispatch,
  type TaskResult,
  dispatchToAgent,
} from "../utils/agent.js";
import { runGate } from "../utils/gate-runner.js";
import { createBranch, isDirty, syncBranch } from "../utils/git.js";
import { assembleDigest } from "../utils/manifest.js";
import {
  type Phase,
  type Task,
  loadTaskState,
  saveTaskState,
} from "../utils/state.js";
import { harvestFeature } from "./harvest.js";
import {
  type ShipRunConfig,
  ShipStage,
  type ShipState,
  type StageResult,
} from "./ship-types.js";
import type { HarvestRecord } from "./types.js";

// ANSI helpers for progress output
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Run a synchronous blocking operation with a visible spinner.
 * Clears the spinner line on completion and prints the result.
 */
function withSpinner<T>(label: string, fn: () => T): T {
  let idx = 0;
  const start = Date.now();
  const interval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const frame = SPINNER[idx % SPINNER.length];
    idx++;
    process.stdout.write(
      `\r${DIM}    ${frame} ${label}... ${elapsed}s${RESET}  `,
    );
  }, 150);

  try {
    const result = fn();
    clearInterval(interval);
    const elapsed = Math.floor((Date.now() - start) / 1000);
    process.stdout.write(`\r\x1b[K    ✓ ${label} (${elapsed}s)\n`);
    return result;
  } catch (err) {
    clearInterval(interval);
    const elapsed = Math.floor((Date.now() - start) / 1000);
    process.stdout.write(`\r\x1b[K    ✗ ${label} (${elapsed}s)\n`);
    throw err;
  }
}

export class ShipOrchestrator extends EventEmitter {
  private config: ShipRunConfig;
  private state: ShipState;

  constructor(config: ShipRunConfig, state?: ShipState) {
    super();
    this.config = config;
    if (state) {
      this.state = state;
    } else {
      this.state = this.initializeState();
    }
  }

  private initializeState(): ShipState {
    return {
      stage: ShipStage.BRANCH_SETUP,
      iteration: 1,
      featureId: this.config.featureId,
      phaseId: this.config.phaseId,
      startedAt: new Date().toISOString(),
      runId: `ship-${this.config.featureId}-${Date.now()}`,
      backend: this.config.backend,
      failureContext: null,
    };
  }

  private getStatePath(): string {
    return path.join(
      this.config.cwd,
      ".runs",
      `${this.config.featureId}_${this.config.phaseId}.state`,
    );
  }

  private persistState(): void {
    const statePath = this.getStatePath();
    const runsDir = path.dirname(statePath);
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }
    fs.writeFileSync(statePath, JSON.stringify(this.state, null, 2), "utf-8");
  }

  public async run(): Promise<number> {
    const phaseNum = this.config.phaseId
      .replace("phase-", "")
      .replace(/^0+/, "");
    console.log(
      `\n▸ ship ${this.config.featureId} Phase ${phaseNum} (Iteration ${this.state.iteration}/${this.config.maxIterations})`,
    );

    this.emit("ship:start", {
      featureId: this.config.featureId,
      phaseId: this.config.phaseId,
      runId: this.state.runId,
      backend: this.config.backend,
    });

    while (
      this.state.stage !== ShipStage.DONE &&
      this.state.stage !== ShipStage.CIRCUIT_BREAK
    ) {
      this.persistState();

      this.emit("ship:stage", {
        featureId: this.config.featureId,
        phaseId: this.config.phaseId,
        stage: this.state.stage,
        iteration: this.state.iteration,
      });

      let result: StageResult;
      // ... rest of switch ...
      switch (this.state.stage) {
        case ShipStage.BRANCH_SETUP:
          result = await this.stageBranchSetup();
          break;
        case ShipStage.IMPLEMENT:
          result = await this.stageImplement();
          break;
        case ShipStage.BUILD_CHECK:
          result = await this.stageBuildCheck();
          break;
        case ShipStage.TEST_GATE:
          result = await this.stageTestGate();
          break;
        case ShipStage.CODE_REVIEW:
          result = await this.stageCodeReview();
          break;
        case ShipStage.UAT_REVIEW:
          result = await this.stageUatReview();
          break;
        case ShipStage.PR_CI:
          result = await this.stagePrCi();
          break;
        default:
          throw new Error(`Unknown stage: ${this.state.stage}`);
      }

      if (!result.success) {
        console.log(`  \x1b[31m✗ ${this.state.stage}\x1b[0m — ${result.error}`);
        this.emit("ship:failed", {
          featureId: this.config.featureId,
          phaseId: this.config.phaseId,
          stage: this.state.stage,
          error: result.error,
        });
        return result.exitCode;
      }

      if (result.nextStage) {
        this.state.stage = result.nextStage;
      } else {
        // Linear progression by default
        this.state.stage = this.getNextStage(this.state.stage);
      }
    }

    this.persistState();

    if (this.state.stage === ShipStage.DONE) {
      const sp_actual = this.calculateSpActual();
      const duration_ms = Date.now() - new Date(this.state.startedAt).getTime();

      const eventData = {
        featureId: this.config.featureId,
        phaseId: this.config.phaseId,
        sp_actual,
        duration_ms,
        evidence: `Completed via gwrk ship (Run ID: ${this.state.runId})`,
      };

      this.emit("plan:ship:complete", eventData);
      this.emit("ship:complete", eventData);

      // Close the loop: harvest finalizes logs, DB, gates, tasks, compression, Slack
      try {
        const record: HarvestRecord = {
          featureId: this.config.featureId,
          phaseId: this.config.phaseId,
          prNumber: 0,
          prUrl: "",
          mergeCommitSha: "local-ship",
          mergedAt: new Date().toISOString(),
          mergedBy: "gwrk-ship",
          status: "merged",
        };
        await harvestFeature(this.config.cwd, record);
      } catch (err) {
        console.warn(`Harvest failed (non-fatal): ${err}`);
      }

      return 0;
    }

    return 1;
  }

  private calculateSpActual(): number {
    try {
      const featureDir = path.join(
        this.config.cwd,
        "specs",
        this.config.featureId,
      );
      const taskState = loadTaskState(featureDir);
      const phase = taskState.phases.find((p) => p.id === this.config.phaseId);
      if (!phase) return 0;
      return phase.tasks
        .filter((t) => t.status === "completed")
        .reduce((sum, t) => sum + (t.sp || 0), 0);
    } catch (e) {
      return 0;
    }
  }

  private async executeReviewWorkflow(
    workflowName: string,
    prompt: string,
  ): Promise<StageResult> {
    const featureDir = path.join(
      this.config.cwd,
      "specs",
      this.config.featureId,
    );

    // 1. Snapshot tasks.json before review
    const beforeState = loadTaskState(featureDir);

    try {
      // ADR-007: Resolve review prompt from plugin system (PROMPT.md),
      // then dispatch with raw tool access. Review agents need native
      // tool access (pnpm build, pnpm lint, gate scripts, jq, git)
      // which WorkflowRuntime's WRITE_FILE guard blocks. The plugin
      // system provides the full prompt; raw dispatch provides tool access.
      let reviewPrompt = prompt;
      try {
        const { PluginLoader } = await import("../plugins/loader.js");
        const loader = new PluginLoader({ projectDir: this.config.cwd });
        const plugin = await loader.resolvePlugin(workflowName);
        const promptPath = path.join(plugin.path, "PROMPT.md");
        if (fs.existsSync(promptPath)) {
          const basePrompt = fs.readFileSync(promptPath, "utf-8");
          reviewPrompt = `${basePrompt}\n\n---\n\n## Scope Context\n\n${prompt}`;
        }
      } catch {
        // Plugin resolution failed — fall through with the inline prompt.
        // This is not fatal: the inline scope context is still useful.
        console.warn(
          `    ⚠ Could not resolve PROMPT.md for ${workflowName}, using inline prompt`,
        );
      }

      const result = await this.dispatchWithFailback({
        prompt: reviewPrompt,
        featureDir: `specs/${this.config.featureId}`,
        agent: this.config.backend,
        env: {},
        quiet: true,
      });

      if (result.exitCode !== 0) {
        return {
          success: false,
          exitCode: result.exitCode,
          error: `${workflowName} agent exited ${result.exitCode}`,
        };
      }

      // 2. Post-dispatch validation (Snapshot-Diff-Revert)
      validatePhaseScope(
        this.config.cwd,
        this.config.featureId,
        this.config.phaseId,
        beforeState,
      );

      // 3. Determine verdict from gates (not agent edits).
      //    Gates are truth, agent verdict is advisory. (ADR-007)
      const verdict = await this.readVerdict();
      console.log(
        `    ${workflowName}: ${verdict === "GO" ? "\x1b[32mGO\x1b[0m" : "\x1b[31mNO-GO\x1b[0m"}`,
      );

      // 4. Discard review agent's source file mutations.
      //    Review agents in YOLO mode can modify source files (fixing imports,
      //    reformatting, etc.). These edits are often incomplete and can break
      //    the build. The review's value is the verdict + task feedback, not code edits.
      //    We preserve tasks.json (carries verdict state) but restore everything else.
      this.revertSourceMutations();

      if (verdict === "GO") {
        return { success: true, exitCode: 0 };
      }
      return this.handleNoGo(workflowName);
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const msg = rawMsg.length > 300 ? `${rawMsg.substring(0, 300)}…` : rawMsg;
      console.error(`  ${workflowName} dispatch error: ${msg}`);
      return {
        success: false,
        exitCode: 1,
        error: `${workflowName} dispatch failed: ${msg}`,
      };
    }
  }

  private getNextStage(stage: ShipStage): ShipStage {
    const stages = [
      ShipStage.BRANCH_SETUP,
      ShipStage.IMPLEMENT,
      ShipStage.BUILD_CHECK,
      ShipStage.TEST_GATE,
      ShipStage.CODE_REVIEW,
      ShipStage.UAT_REVIEW,
      ShipStage.PR_CI,
      ShipStage.DONE,
    ];
    const currentIndex = stages.indexOf(stage);
    return stages[currentIndex + 1] || ShipStage.DONE;
  }

  private async stageBranchSetup(): Promise<StageResult> {
    console.log("  ▸ BRANCH_SETUP");
    // FR-002: Dirty tree fail fast
    if (await isDirty(this.config.cwd)) {
      return {
        success: false,
        exitCode: 1,
        error: "Dirty working tree — commit or stash before shipping",
      };
    }

    const branchName = `feat/${this.config.featureId}`;
    try {
      await createBranch(this.config.cwd, branchName, "develop");
      this.state.branchName = branchName;
      return { success: true, exitCode: 0 };
    } catch (err: unknown) {
      // Branch already exists — just check it out and sync with develop
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        try {
          const { execFileSync } = await import("node:child_process");
          execFileSync("git", ["checkout", branchName], {
            cwd: this.config.cwd,
            stdio: ["ignore", "ignore", "pipe"],
          });
          // Sync with latest develop
          await syncBranch(this.config.cwd, "develop");
          this.state.branchName = branchName;
          console.log(`  Branch ${branchName} exists — checked out and synced`);
          return { success: true, exitCode: 0 };
        } catch (syncErr: unknown) {
          const syncMsg =
            syncErr instanceof Error ? syncErr.message : String(syncErr);
          return {
            success: false,
            exitCode: 1,
            error: `Failed to checkout existing branch: ${syncMsg}`,
          };
        }
      }
      const execErr = err as { status?: unknown };
      return {
        success: false,
        exitCode: typeof execErr.status === "number" ? execErr.status : 1,
        error: `Failed to create feature branch: ${msg}`,
      };
    }
  }

  /**
   * Post-flight gate verification. Re-runs gates for all completed tasks
   * in the current phase. If any fail, re-opens the task and returns a
   * failure result. Returns null if all gates pass.
   */
  private async runPostFlightGates(featureDir: string): Promise<StageResult | null> {
    const postFlightState = loadTaskState(featureDir);
    const postFlightPhase = postFlightState.phases.find(
      (p: Phase) => p.id === this.config.phaseId,
    );
    if (!postFlightPhase) return null;

    let reopenedCount = 0;
    for (const task of postFlightPhase.tasks) {
      if (task.status !== "completed" || !task.gateScript) continue;
      const gatePath = path.join(featureDir, task.gateScript);
      if (!fs.existsSync(gatePath)) continue;
      const gateResult = await runGate(gatePath);
      if (!gateResult.passed) {
        task.status = "open";
        delete task.completedAt;
        reopenedCount++;
        console.log(
          `  ✗ post-flight FAIL: ${task.id} — gate ${task.gateScript}`,
        );
        const failNote = `\n\nPOST-FLIGHT GATE FAIL: ${task.gateScript} exited non-zero.\n  OUTPUT: ${gateResult.output.slice(0, 200)}`;
        task.description = (task.description || "") + failNote;
      } else {
        console.log(`  ✓ post-flight PASS: ${task.id}`);
      }
    }
    if (reopenedCount > 0) {
      saveTaskState(featureDir, postFlightState);
      console.log(
        `  ⚠ ${reopenedCount} task(s) failed post-flight gates — will retry`,
      );
      return {
        success: false,
        exitCode: 1,
        error: `Post-flight gate verification failed: ${reopenedCount} task(s) re-opened`,
      };
    }
    return null;
  }

  private async stageImplement(): Promise<StageResult> {
    // FR-003: Pre-flight gate check
    const featureDir = path.join(
      this.config.cwd,
      "specs",
      this.config.featureId,
    );
    const taskState = loadTaskState(featureDir);
    const phase = taskState.phases.find(
      (p: Phase) => p.id === this.config.phaseId,
    );

    if (!phase) {
      return {
        success: false,
        exitCode: 1,
        error: `Phase ${this.config.phaseId} not found`,
      };
    }

    const openTasks = phase.tasks.filter((t: Task) => t.status === "open");
    if (openTasks.length === 0) {
      return { success: true, exitCode: 0, nextStage: ShipStage.BUILD_CHECK };
    }

    // Check pre-flight gates
    const tasksToDispatch = [];
    for (const task of openTasks) {
      const gatePath = path.join(featureDir, task.gateScript);
      if (fs.existsSync(gatePath)) {
        const gateResult = await runGate(gatePath);
        if (gateResult.passed) {
          console.log(`  ✓ pre-flight PASS: ${task.id}`);
          // Mark task as completed in state
          task.status = "completed";
          task.completedAt = new Date().toISOString();
        } else {
          tasksToDispatch.push(task);
        }
      } else {
        tasksToDispatch.push(task);
      }
    }

    if (tasksToDispatch.length === 0) {
      saveTaskState(featureDir, taskState);

      // POST-FLIGHT on pre-flight auto-complete path.
      // Pre-flight gates may be hollow (test -f) and auto-complete tasks
      // that haven't been implemented. Re-verify with full gate execution.
      const postFlightResult = await this.runPostFlightGates(featureDir);
      if (postFlightResult) return postFlightResult;

      return { success: true, exitCode: 0, nextStage: ShipStage.BUILD_CHECK };
    }

    // FR-019: dispatchToAgent
    try {
      const isRetry = this.state.iteration > 1;
      const prompt = isRetry
        ? this.buildRetryPrompt(tasksToDispatch)
        : this.buildInitialPrompt(tasksToDispatch);

      const taskIds = tasksToDispatch.map((t) => t.id).join(", ");
      console.log(
        `  ▸ IMPLEMENT  ${isRetry ? `retry (${this.state.iteration}/${this.config.maxIterations})` : `${tasksToDispatch.length} task(s) (${taskIds})`}`,
      );

      const result = await this.dispatchWithFailback({
        agent: this.config.backend,
        workflow: "gwrk-implement",
        featureDir: `specs/${this.config.featureId}`,
        prompt,
        quiet: true,
      });

      if (result.exitCode === 0) {
        // Checkpoint: commit implementation work BEFORE code review.
        // revertSourceMutations() does `git checkout -- .` to undo review
        // agent edits. Without this commit, it wipes the implementation too.
        try {
          const porcelain = execSync("git status --porcelain", {
            cwd: this.config.cwd,
            encoding: "utf-8",
          }).trim();
          if (porcelain) {
            const phaseNum = this.config.phaseId
              .replace("phase-", "")
              .replace(/^0+/, "");
            execSync("git add -A", { cwd: this.config.cwd });
            execSync(
              `git commit --author="$(git config user.name) <$(git config user.email)>" -m "feat(${this.config.featureId}): implement Phase ${phaseNum}"`,
              {
                cwd: this.config.cwd,
                env: { ...process.env, GWRK_SHIP: "1" },
                stdio: ["ignore", "pipe", "pipe"],
              },
            );
            console.log("    ✓ implementation committed");
          }
        } catch (commitErr: unknown) {
          console.warn(
            `    ⚠ Could not commit implementation: ${commitErr instanceof Error ? commitErr.message : commitErr}`,
          );
          // Non-fatal: proceed to code review with uncommitted changes
        }

        // POST-FLIGHT GATE VERIFICATION
        const postFlightResult = await this.runPostFlightGates(featureDir);
        if (postFlightResult) {
          // Post-flight failure → retry via same path as review NO-GO
          return this.handleNoGo("IMPLEMENT");
        }

        return { success: true, exitCode: 0 };
      }
      return {
        success: false,
        exitCode: result.exitCode,
        error: `Agent implementation failed: ${result.errorType || "unknown"}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  IMPLEMENT dispatch error: ${msg}`);
      return {
        success: false,
        exitCode: 1,
        error: `IMPLEMENT dispatch failed: ${msg}`,
      };
    }
  }

  /**
   * BUILD_CHECK: Hard gate that verifies TypeScript compilation.
   * Runs after IMPLEMENT and before TEST_GATE. If `pnpm build` fails,
   * the iteration retries — preventing broken builds from reaching review.
   */
  private async stageBuildCheck(): Promise<StageResult> {
    console.log("  ▸ BUILD_CHECK");
    try {
      execSync("pnpm build", {
        cwd: this.config.cwd,
        stdio: "pipe",
        timeout: 60_000, // 60s — build should never take longer
      });
      console.log("  ✓ build passed");
      return { success: true, exitCode: 0, nextStage: ShipStage.TEST_GATE };
    } catch (err: unknown) {
      const stderr =
        (err as { stderr?: Buffer })?.stderr?.toString().trim() || "";
      const lastLines = stderr.split("\n").slice(-10).join("\n");
      console.log(`  ✗ build FAILED:\n${lastLines}`);
      return {
        success: false,
        exitCode: 1,
        error: `TypeScript build failed:\n${lastLines}`,
      };
    }
  }

  /**
   * TEST_GATE: Mechanical test verification.
   * Runs after BUILD_CHECK and before CODE_REVIEW. If `pnpm test` fails,
   * the iteration retries via handleNoGo — feeding test failure output
   * back to the implement agent as retry context.
   *
   * This is the verification that prevents ship from closing ✅
   * when tests are RED. Without this, the only checks are:
   * - pnpm build (types compile ≠ tests pass)
   * - LLM review agents (unreliable, can 429)
   */
  private async stageTestGate(): Promise<StageResult> {
    console.log("  ▸ TEST_GATE");
    try {
      execSync("pnpm test", {
        cwd: this.config.cwd,
        stdio: "pipe",
        timeout: 120_000, // 2min — test suite is ~14s today, generous buffer
      });
      console.log("  ✓ tests passed");
      return { success: true, exitCode: 0, nextStage: ShipStage.CODE_REVIEW };
    } catch (err: unknown) {
      const stdout =
        (err as { stdout?: Buffer })?.stdout?.toString().trim() || "";
      const stderr =
        (err as { stderr?: Buffer })?.stderr?.toString().trim() || "";
      const combined = `${stdout}\n${stderr}`.trim();
      const lastLines = combined.split("\n").slice(-20).join("\n");
      console.log(`  ✗ tests FAILED:\n${lastLines}`);

      // Feed failure back to implement via NO-GO retry loop.
      // Re-open tasks so the implement agent sees what needs fixing.
      const featureDir = path.join(
        this.config.cwd,
        "specs",
        this.config.featureId,
      );
      const taskState = loadTaskState(featureDir);
      const phase = taskState.phases.find(
        (p: Phase) => p.id === this.config.phaseId,
      );
      if (phase) {
        for (const task of phase.tasks) {
          if (task.status === "completed") {
            task.status = "open";
            delete task.completedAt;
            task.description =
              `${task.description || ""}\n\nTEST_GATE FAILURE:\n${lastLines}`.trim();
          }
        }
        saveTaskState(featureDir, taskState);
      }

      return this.handleNoGo("TEST_GATE");
    }
  }

  private async stageCodeReview(): Promise<StageResult> {
    console.log("  ▸ CODE_REVIEW");
    const plugin = await resolveReviewPlugin(this.config.cwd);

    // Scope code review to THIS phase's tasks only.
    // Without this, the review agent evaluates ALL code in the feature,
    // re-opens completed tasks from earlier phases, and creates an infinite
    // loop: pre-flight passes → no implement → review re-opens → circuit break.
    const featureDir = path.join(
      this.config.cwd,
      "specs",
      this.config.featureId,
    );
    const taskState = loadTaskState(featureDir);
    const phase = taskState.phases.find(
      (p: Phase) => p.id === this.config.phaseId,
    );
    const phaseTasks =
      phase?.tasks
        .map((t: Task) => `${t.id}: ${t.title} [${t.status}]`)
        .join("\n- ") || "No tasks";

    const steps = plugin.steps.code
      .filter((s) => !s.skip)
      .map((s) => `- ${s.title}: ${s.description}`)
      .join("\n");

    const scopedPrompt = [
      `Phase ${this.config.phaseId} Code Review`,
      "",
      "SCOPE CONSTRAINT: Only evaluate code changes made for THIS phase's tasks.",
      "Do NOT re-open tasks from earlier phases that are already completed.",
      "If a completed task's implementation has issues, note them in your summary but do NOT change its status.",
      "",
      "Review Steps:",
      steps,
      "",
      "Phase tasks:",
      `- ${phaseTasks}`,
    ].join("\n");

    return this.executeReviewWorkflow(plugin.codeReviewWorkflow, scopedPrompt);
  }

  private async stageUatReview(): Promise<StageResult> {
    console.log("  ▸ UAT_REVIEW");
    const plugin = await resolveReviewPlugin(this.config.cwd);

    // Scope UAT prompt to phase-specific user stories.
    const featureDir = path.join(
      this.config.cwd,
      "specs",
      this.config.featureId,
    );
    const taskState = loadTaskState(featureDir);
    const phase = taskState.phases.find(
      (p: Phase) => p.id === this.config.phaseId,
    );
    const doneWhen = phase?.doneWhen?.join("\n- ") || "All tasks pass gates";

    const steps = plugin.steps.uat
      .filter((s) => !s.skip)
      .map((s) => `- ${s.title}: ${s.description}`)
      .join("\n");

    const scopedPrompt = [
      `Phase ${this.config.phaseId} UAT Review`,
      "",
      "SCOPE CONSTRAINT: Only evaluate user stories and requirements addressed by THIS phase.",
      "",
      "Review Steps:",
      steps,
      "",
      "Done When:",
      `- ${doneWhen}`,
    ].join("\n");

    return this.executeReviewWorkflow(plugin.uatReviewWorkflow, scopedPrompt);
  }

  /**
   * Read the verdict from task state after a review dispatch.
   * If any tasks in the phase are "open", the review agent re-opened them → NO-GO.
   * Otherwise → GO.
   */
  private async readVerdict(): Promise<"GO" | "NO-GO"> {
    const featureDir = path.join(
      this.config.cwd,
      "specs",
      this.config.featureId,
    );
    const taskState = loadTaskState(featureDir);
    const phase = taskState.phases.find(
      (p: Phase) => p.id === this.config.phaseId,
    );
    if (!phase) return "NO-GO";

    // Gate-driven verdict: run gates directly, don't trust agent edits.
    // "Gates are truth, tasks.json status is bookkeeping." (gwrk-review-code.md L59)
    let failedCount = 0;
    for (const task of phase.tasks) {
      if (!task.gateScript) continue;
      const gatePath = path.join(featureDir, task.gateScript);
      if (!fs.existsSync(gatePath)) continue;

      const gateResult = await runGate(gatePath);
      if (gateResult.passed) {
        if (task.status !== "completed") {
          task.status = "completed";
          task.completedAt = new Date().toISOString();
        }
      } else {
        task.status = "open";
        delete task.completedAt;
        failedCount++;
      }
    }

    // Persist reconciled state
    saveTaskState(featureDir, taskState);

    if (failedCount > 0) {
      const openTasks = phase.tasks.filter((t: Task) => t.status === "open");
      console.log(
        `    ${openTasks.length} task(s) re-opened: ${openTasks.map((t) => t.id).join(", ")}`,
      );
      for (const task of openTasks) {
        if (task.description) {
          const firstLine = task.description.split("\n")[0].trim();
          console.log(`      ${task.id}: ${firstLine}`);
        }
      }
      return "NO-GO";
    }
    return "GO";
  }

  /**
   * Discard source file mutations left by review agents.
   *
   * Review agents in YOLO mode can modify source files during review
   * (fixing imports, reformatting, removing non-null assertions, etc.).
   * These edits are often incomplete and can break the build.
   *
   * Strategy: `git checkout -- .` restores all tracked files to HEAD,
   * then re-apply tasks.json from disk (it was already saved by
   * validatePhaseScope and carries the verdict state we need).
   */
  private revertSourceMutations(): void {
    const featureDir = path.join(
      this.config.cwd,
      "specs",
      this.config.featureId,
    );
    const tasksJsonPath = path.join(featureDir, ".gwrk", "tasks.json");

    // Snapshot tasks.json — this carries the review verdict and must be preserved
    let tasksJsonContent: string | null = null;
    try {
      tasksJsonContent = fs.readFileSync(tasksJsonPath, "utf-8");
    } catch {
      // No tasks.json to preserve — proceed with full restore
    }

    try {
      // Restore all tracked files to HEAD state
      execSync("git checkout -- .", {
        cwd: this.config.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Remove any untracked files the review agent created
      execSync("git clean -fd --exclude=.runs/", {
        cwd: this.config.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      // Non-fatal: if git restore fails, the pre-commit hook will catch issues
      console.warn(
        `    ⚠ Could not revert review mutations: ${err instanceof Error ? err.message : err}`,
      );
      return;
    }

    // Restore tasks.json with review verdict state
    if (tasksJsonContent) {
      fs.writeFileSync(tasksJsonPath, tasksJsonContent, "utf-8");
    }
  }

  private async stagePrCi(): Promise<StageResult> {
    console.log("  ▸ PR_CI");
    const branchName = this.state.branchName;
    const specName = this.config.featureId;

    // ── Git housekeeping: commit any uncommitted changes and push ──
    // Review agents may modify files via native tools without committing.
    // The orchestrator must own this boundary deterministically.
    try {
      const porcelain = execSync("git status --porcelain", {
        cwd: this.config.cwd,
        encoding: "utf-8",
      }).trim();

      if (porcelain) {
        const changeCount = porcelain.split("\n").length;
        console.log(`    committing ${changeCount} change(s)`);
        execSync("git add -A", { cwd: this.config.cwd });
        const phaseNum = this.config.phaseId
          .replace("phase-", "")
          .replace(/^0+/, "");
        withSpinner("running pre-commit checks", () =>
          execSync(
            `git commit -m "chore(${this.config.featureId}): pre-PR cleanup (Phase ${phaseNum})"`,
            {
              cwd: this.config.cwd,
              env: { ...process.env, GWRK_SHIP: "1" },
              stdio: ["ignore", "pipe", "pipe"],
            },
          ),
        );
      }

      // Always push — branch may not be on remote yet, or have unpushed commits
      withSpinner(`pushing ${branchName}`, () =>
        execSync(`git push -u origin ${branchName}`, {
          cwd: this.config.cwd,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
    } catch (gitErr: unknown) {
      const msg = gitErr instanceof Error ? gitErr.message : String(gitErr);
      return {
        success: false,
        exitCode: 1,
        error: `Pre-PR git housekeeping failed: ${msg}`,
      };
    }

    try {
      // Check for existing PR
      const prListRaw = withSpinner("checking for existing PR", () =>
        execSync(
          `gh pr list --head "${branchName}" --base develop --json number --jq '.[0].number'`,
          { cwd: this.config.cwd, encoding: "utf-8" },
        ).trim(),
      );

      let prNumber =
        prListRaw !== "null" && prListRaw !== "" ? prListRaw : null;

      if (!prNumber) {
        // Read tasks.json to build PR body
        const featureDir = path.join(
          this.config.cwd,
          "specs",
          this.config.featureId,
        );
        const taskState = loadTaskState(featureDir);
        const phase = taskState.phases.find(
          (p: Phase) => p.id === this.config.phaseId,
        );

        const tasksList =
          phase?.tasks
            .map(
              (t: Task) =>
                `- [${t.status === "completed" ? "x" : " "}] ${t.title}`,
            )
            .join("\n") || "- See tasks.json for task list";
        const phaseNum = this.config.phaseId
          .replace("phase-", "")
          .replace(/^0+/, "");
        const formattedSpec = specName.replace(/^\d+-/, "");

        const prBody = `## feat(${formattedSpec}): Phase ${phaseNum}

### Tasks Completed
${tasksList}

### Verification
- [x] All tasks verified via Hard Gates
- [x] Code review: GO
- [x] UAT: GO

---
_Generated by gwrk ship_`;

        const prBodyPath = path.join("/tmp", `gwrk-pr-body-${Date.now()}.md`);
        fs.writeFileSync(prBodyPath, prBody, "utf-8");

        let createOutput: string;
        try {
          createOutput = withSpinner("creating PR", () =>
            execSync(
              `gh pr create --title "feat(${formattedSpec}): Phase ${phaseNum}" --body-file "${prBodyPath}" --base develop`,
              { cwd: this.config.cwd, encoding: "utf-8" },
            ),
          );
        } catch (createErr: unknown) {
          const createMsg =
            createErr instanceof Error ? createErr.message : String(createErr);
          if (
            createMsg.includes("No commits between") ||
            createMsg.includes("same as base branch")
          ) {
            // Code is already on develop — nothing to PR. This is success.
            console.log(
              "    ✓ No diff between branches — code already on develop. Merging branch.",
            );
            try {
              execSync(
                `git checkout develop && git merge ${branchName} && git push`,
                {
                  cwd: this.config.cwd,
                  env: { ...process.env, GWRK_SHIP: "1" },
                  stdio: ["ignore", "pipe", "pipe"],
                },
              );
            } catch {
              /* best-effort merge */
            }
            return { success: true, exitCode: 0, nextStage: ShipStage.DONE };
          }
          throw createErr;
        }

        const match = createOutput.match(/pull\/(\d+)/);
        if (match) {
          prNumber = match[1];
        }
      }

      if (prNumber) {
        console.log(`    PR #${prNumber} ready`);
        // gh pr checks blocks until finished, returning non-zero if failed.
        // If no required checks are configured, treat as pass.
        try {
          withSpinner("waiting for CI", () =>
            execSync(
              `gh pr checks "${prNumber}" --watch --required --interval 30`,
              {
                cwd: this.config.cwd,
                encoding: "utf-8",
                stdio: ["ignore", "pipe", "pipe"],
              },
            ),
          );
        } catch (ciErr: unknown) {
          const ciMsg = ciErr instanceof Error ? ciErr.message : String(ciErr);
          if (ciMsg.includes("no checks reported")) {
            console.log("  No CI checks configured — skipping CI wait.");
          } else {
            throw ciErr; // Re-throw real CI failures
          }
        }
        return { success: true, exitCode: 0, nextStage: ShipStage.DONE };
      }

      return {
        success: false,
        exitCode: 1,
        error: "Could not determine PR number.",
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        exitCode: 1,
        error: `PR/CI step failed: ${msg}`,
      };
    }
  }

  /**
   * Build the prompt for a first-attempt implementation.
   */
  private buildInitialPrompt(tasks: Task[]): string {
    const featureDir = path.join(
      this.config.cwd,
      "specs",
      this.config.featureId,
    );
    const planPath = path.join(featureDir, "plan.md");
    let planContext = "";

    if (fs.existsSync(planPath)) {
      try {
        const plan = fs.readFileSync(planPath, "utf-8");
        if (plan) {
          const phaseNum = this.config.phaseId
            .replace("phase-", "")
            .replace(/^0+/, "");
          const phaseRegex = new RegExp(
            `### Phase ${phaseNum}[:\\s].*?(?=### Phase|$)`,
            "s",
          );
          const phaseSection = plan.match(phaseRegex)?.[0] || "";
          if (phaseSection) {
            planContext = `\n\nIMPLEMENTATION PLAN (from plan.md):\n${phaseSection}`;
          }
        }
      } catch {
        // plan.md unreadable — proceed without plan context
      }
    }

    const taskList = tasks
      .map((t) => `- ${t.id}: ${t.title}\n  ${t.description}`)
      .join("\n");

    return [
      `Phase ${this.config.phaseId} Implementation`,
      "",
      "CRITICAL CONSTRAINTS:",
      "1. ONLY modify files explicitly listed in the plan below as (Modify) or (New).",
      "2. For (Modify) files: ADD to the existing code. Do NOT delete or rewrite existing exports, functions, or imports.",
      "3. For (New) files: Create the file from scratch.",
      "4. After ALL changes, run `pnpm build` and fix any TypeScript compilation errors.",
      "5. Run `pnpm vitest run` on the relevant test files to verify your changes.",
      "",
      `Tasks:\n${taskList}`,
      planContext,
    ].join("\n");
  }

  /**
   * Build a targeted prompt for retry after NO-GO review.
   * Extracts structured feedback (WHERE/FIX) from task descriptions
   * and constrains the agent to edit only those specific files.
   */
  private buildRetryPrompt(tasks: Task[]): string {
    const fixes: string[] = [];

    for (const task of tasks) {
      const desc = task.description || "";

      // Extract WHERE field — the file the review flagged
      const whereMatch = desc.match(/WHERE:\s*(\S+)/);
      const fixMatch = desc.match(/FIX:\s*(.+?)(?:\n|$)/);

      if (whereMatch) {
        fixes.push(
          `## ${task.id}: ${task.title}\n**FILE TO EDIT:** ${whereMatch[1]}\n${fixMatch ? `**WHAT TO FIX:** ${fixMatch[1].trim()}\n` : ""}**FULL REVIEW FEEDBACK:**\n${desc}`,
        );
      } else {
        // No structured WHERE — pass through with constraint reminder
        fixes.push(
          `## ${task.id}: ${task.title}\n` + `**REVIEW FEEDBACK:**\n${desc}`,
        );
      }
    }

    return [
      `Phase ${this.config.phaseId} — RETRY (Iteration ${this.state.iteration}/${this.config.maxIterations})`,
      "",
      "CONSTRAINT: This is a RETRY after code review returned NO-GO.",
      "Do NOT re-implement files from scratch. Only edit the SPECIFIC files",
      "mentioned in the review feedback below. If the review says a TEST file",
      "is broken, fix the TEST file — do not rewrite the source file.",
      "",
      ...fixes,
    ].join("\n");
  }

  private handleNoGo(stage: string): StageResult {
    this.state.iteration++;
    if (this.state.iteration > this.config.maxIterations) {
      // FR-007: Circuit breaker
      this.state.stage = ShipStage.CIRCUIT_BREAK;
      this.state.failureContext = {
        openTasks: [], // Should populate from state
        lastVerdict: "NO-GO",
        iterationTimeline: [], // Should populate
        digest: assembleDigest(
          path.join(
            this.config.cwd,
            ".runs",
            `${this.config.featureId}_p${this.config.phaseId.replace("phase-", "")}.events`,
          ),
        ),
      };
      this.emit("ship:blocked", {
        featureId: this.config.featureId,
        phaseId: this.config.phaseId,
        reason: `Circuit breaker tripped after ${this.config.maxIterations} iterations`,
      });
      return {
        success: false,
        exitCode: 1,
        error: `Circuit breaker tripped after ${this.config.maxIterations} iterations`,
      };
    }

    console.log(
      `  ↻ NO-GO → retry IMPLEMENT (${this.state.iteration}/${this.config.maxIterations})`,
    );
    return { success: true, exitCode: 0, nextStage: ShipStage.IMPLEMENT };
  }

  /**
   * Dispatch with graceful model failback.
   * If a selected model/command is provided in config, use it.
   * Otherwise, fall back to gemini-specific failback logic (legacy).
   */
  private async dispatchWithFailback(task: TaskDispatch): Promise<TaskResult> {
    const env: Record<string, string> = { ...task.env };
    const model = this.config.selectedModel;

    // 1. Use Router-selected model if available (FR-008/009)
    if (model) {
      if (this.config.backend === "gemini") env.GEMINI_MODEL = model;
      if (this.config.backend === "claude") env.CLAUDE_MODEL = model;
      if (this.config.backend === "codex") env.CODEX_MODEL = model;
      console.log(`    🤖 Router model: ${model}`);
    }

    // 2. Dispatch
    const result = await dispatchToAgent({ ...task, model, env });

    // 3. Legacy Gemini-specific failback if router didn't provide a selection
    //    and the primary attempt failed.
    if (result.exitCode !== 0 && this.config.backend === "gemini" && !model) {
      const failbackModels = this.config.geminiFailbackModels ?? [];
      for (const fbModel of failbackModels) {
        console.log(
          `    ⚠ Primary model failed (exit ${result.exitCode}), failing back to ${fbModel}`,
        );
        const fbResult = await dispatchToAgent({
          ...task,
          model: fbModel,
          env: { ...env, GEMINI_MODEL: fbModel },
        });
        if (fbResult.exitCode === 0) return fbResult;
      }
    }

    return result;
  }
}
