import fs from "node:fs";
import path from "node:path";
import { type TaskDispatch, type TaskResult, dispatchToAgent } from "../utils/agent.js";
import { runGate } from "../utils/gate-runner.js";
import { createBranch, isDirty, syncBranch } from "../utils/git.js";
import { assembleDigest } from "../utils/manifest.js";
import {
  type Phase,
  type Task,
  loadTaskState,
  saveTaskState,
} from "../utils/state.js";
import {
  type ShipRunConfig,
  ShipStage,
  type ShipState,
  type StageResult,
} from "./ship-types.js";

export class ShipOrchestrator {
  private config: ShipRunConfig;
  private state: ShipState;

  constructor(config: ShipRunConfig, state?: ShipState) {
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
    console.log(`Starting/Resuming Ship Loop: ${this.state.stage}`);

    while (
      this.state.stage !== ShipStage.DONE &&
      this.state.stage !== ShipStage.CIRCUIT_BREAK
    ) {
      this.persistState();
      let result: StageResult;

      switch (this.state.stage) {
        case ShipStage.BRANCH_SETUP:
          result = await this.stageBranchSetup();
          break;
        case ShipStage.IMPLEMENT:
          result = await this.stageImplement();
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
        console.error(`Stage ${this.state.stage} failed: ${result.error}`);
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
    return this.state.stage === ShipStage.DONE ? 0 : 1;
  }

  private getNextStage(stage: ShipStage): ShipStage {
    const stages = [
      ShipStage.BRANCH_SETUP,
      ShipStage.IMPLEMENT,
      ShipStage.CODE_REVIEW,
      ShipStage.UAT_REVIEW,
      ShipStage.PR_CI,
      ShipStage.DONE,
    ];
    const currentIndex = stages.indexOf(stage);
    return stages[currentIndex + 1] || ShipStage.DONE;
  }

  private async stageBranchSetup(): Promise<StageResult> {
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
      return { success: true, exitCode: 0, nextStage: ShipStage.CODE_REVIEW };
    }

    // Check pre-flight gates
    const tasksToDispatch = [];
    for (const task of openTasks) {
      const gatePath = path.join(featureDir, task.gateScript);
      if (fs.existsSync(gatePath)) {
        const gateResult = await runGate(gatePath);
        if (gateResult.passed) {
          console.log(`  pre-flight PASS — gate already satisfied: ${task.id}`);
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
      return { success: true, exitCode: 0, nextStage: ShipStage.CODE_REVIEW };
    }

    // FR-019: dispatchToAgent
    try {
      const prompt = `Phase ${this.config.phaseId} Implementation\n\nTasks:\n${tasksToDispatch.map((t) => `- ${t.id}: ${t.title}\n  ${t.description}`).join("\n")}`;

      const result = await this.dispatchWithFailback({
        agent: this.config.backend,
        workflow: ".agents/workflows/gwrk-implement.md",
        featureDir: `specs/${this.config.featureId}`,
        prompt,
      });

      if (result.exitCode === 0) {
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

  private async stageCodeReview(): Promise<StageResult> {
    // FR-005: dispatch review
    try {
      const result = await this.dispatchWithFailback({
        agent: this.config.backend,
        workflow: ".agents/workflows/gwrk-review-code.md",
        featureDir: `specs/${this.config.featureId}`,
        prompt: `Phase ${this.config.phaseId} Code Review`,
      });

      if (result.exitCode !== 0) {
        return {
          success: false,
          exitCode: result.exitCode,
          error: `CODE_REVIEW agent exited non-zero: ${result.errorType || result.exitCode}`,
        };
      }

      // Determine verdict from task state — the review agent re-opens tasks on NO-GO.
      // This is the ground truth, not exit code (agents exit 0 on successful completion regardless of verdict).
      const verdict = this.readVerdict();
      console.log(`  CODE_REVIEW verdict: ${verdict}`);

      if (verdict === "GO") {
        return { success: true, exitCode: 0 };
      }
      return this.handleNoGo("CODE_REVIEW");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  CODE_REVIEW dispatch error: ${msg}`);
      return {
        success: false,
        exitCode: 1,
        error: `CODE_REVIEW dispatch failed: ${msg}`,
      };
    }
  }

  private async stageUatReview(): Promise<StageResult> {
    try {
      const result = await this.dispatchWithFailback({
        agent: this.config.backend,
        workflow: ".agents/workflows/gwrk-review-uat.md",
        featureDir: `specs/${this.config.featureId}`,
        prompt: `Phase ${this.config.phaseId} UAT Review`,
      });

      if (result.exitCode !== 0) {
        return {
          success: false,
          exitCode: result.exitCode,
          error: `UAT_REVIEW agent exited non-zero: ${result.errorType || result.exitCode}`,
        };
      }

      const verdict = this.readVerdict();
      console.log(`  UAT_REVIEW verdict: ${verdict}`);

      if (verdict === "GO") {
        return { success: true, exitCode: 0 };
      }
      return this.handleNoGo("UAT_REVIEW");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  UAT_REVIEW dispatch error: ${msg}`);
      return {
        success: false,
        exitCode: 1,
        error: `UAT_REVIEW dispatch failed: ${msg}`,
      };
    }
  }

  /**
   * Read the verdict from task state after a review dispatch.
   * If any tasks in the phase are "open", the review agent re-opened them → NO-GO.
   * Otherwise → GO.
   */
  private readVerdict(): "GO" | "NO-GO" {
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
    const openTasks = phase.tasks.filter((t: Task) => t.status === "open");
    if (openTasks.length > 0) {
      console.log(
        `  ${openTasks.length} task(s) re-opened: ${openTasks.map((t) => t.id).join(", ")}`,
      );
      return "NO-GO";
    }
    return "GO";
  }

  private async stagePrCi(): Promise<StageResult> {
    // FR-006: Create PR and poll CI
    // This would use 'gh pr create' and 'gh pr checks'
    console.log("Creating PR and awaiting CI...");
    // Mocking success for now
    return { success: true, exitCode: 0, nextStage: ShipStage.DONE };
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
      return {
        success: false,
        exitCode: 1,
        error: `Circuit breaker tripped after ${this.config.maxIterations} iterations`,
      };
    }

    console.log(
      `NO-GO in ${stage}, looping back to IMPLEMENT (Iteration ${this.state.iteration})`,
    );
    return { success: true, exitCode: 0, nextStage: ShipStage.IMPLEMENT };
  }

  /**
   * Dispatch with graceful model failback (stopgap until F005/F008).
   * Tries primary model, then falls back through the chain on non-zero exit.
   * Only applies when backend is "gemini" and failbackModels are configured.
   */
  private async dispatchWithFailback(task: TaskDispatch): Promise<TaskResult> {
    const isGemini = this.config.backend === "gemini";
    const primaryModel = this.config.geminiModel;
    const failbackModels = this.config.geminiFailbackModels ?? [];

    // Build the model chain: [primary, ...failbacks]
    const modelChain: (string | undefined)[] = isGemini
      ? [primaryModel, ...failbackModels]
      : [undefined]; // Non-gemini backends: single attempt, no model override

    let lastResult: TaskResult | undefined;

    for (const model of modelChain) {
      const env: Record<string, string> = { ...task.env };
      if (model) {
        env.GEMINI_MODEL = model;
        console.log(`  ▸ Dispatching with model: ${model}`);
      }

      lastResult = await dispatchToAgent({ ...task, env });

      if (lastResult.exitCode === 0) {
        return lastResult;
      }

      // Only failback if there are more models to try
      const currentIndex = modelChain.indexOf(model);
      if (currentIndex < modelChain.length - 1) {
        const nextModel = modelChain[currentIndex + 1];
        console.log(
          `  ⚠ Model ${model ?? "default"} failed (exit ${lastResult.exitCode}), failing back to ${nextModel}`,
        );
      }
    }

    return lastResult as TaskResult;
  }
}
