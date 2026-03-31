import fs from "node:fs";
import path from "node:path";
import { 
  ShipStage, 
  type ShipState, 
  type ShipRunConfig, 
  type StageResult 
} from "./ship-types.js";
import { runGate } from "../utils/gate-runner.js";
import { dispatchToAgent } from "../utils/agent.js";
import { assembleDigest } from "../utils/manifest.js";
import { loadTaskState, saveTaskState, type Phase, type Task } from "../utils/state.js";
import { 
  createBranch, 
  isDirty 
} from "../utils/git.js";

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
    return path.join(this.config.cwd, ".runs", `${this.config.featureId}_${this.config.phaseId}.state`);
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
    
    while (this.state.stage !== ShipStage.DONE && this.state.stage !== ShipStage.CIRCUIT_BREAK) {
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
        error: "Dirty working tree — commit or stash before shipping" 
      };
    }

    const branchName = `feat/${this.config.featureId}`;
    try {
      await createBranch(this.config.cwd, branchName, "develop");
      this.state.branchName = branchName;
      return { success: true, exitCode: 0 };
    } catch (err: any) {
      return { 
        success: false, 
        exitCode: 1, 
        error: `Failed to create feature branch: ${err.message}` 
      };
    }
  }

  private async stageImplement(): Promise<StageResult> {
    // FR-003: Pre-flight gate check
    const featureDir = path.join(this.config.cwd, "specs", this.config.featureId);
    const taskState = loadTaskState(featureDir);
    const phase = taskState.phases.find((p: Phase) => p.id === this.config.phaseId);

    if (!phase) {
      return { success: false, exitCode: 1, error: `Phase ${this.config.phaseId} not found` };
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
    const prompt = `Phase ${this.config.phaseId} Implementation\n\nTasks:\n` + 
      tasksToDispatch.map(t => `- ${t.id}: ${t.title}\n  ${t.description}`).join("\n");

    const result = await dispatchToAgent({
      agent: this.config.backend,
      workflow: "implement",
      featureDir: `specs/${this.config.featureId}`,
      prompt,
    });

    if (result.exitCode === 0) {
      return { success: true, exitCode: 0 };
    } else {
      return { 
        success: false, 
        exitCode: result.exitCode, 
        error: `Agent implementation failed: ${result.errorType || 'unknown'}` 
      };
    }
  }

  private async stageCodeReview(): Promise<StageResult> {
    // FR-005: dispatch review
    const result = await dispatchToAgent({
      agent: this.config.backend,
      workflow: "review-code",
      featureDir: `specs/${this.config.featureId}`,
      prompt: `Phase ${this.config.phaseId} Code Review`,
    });

    // In a real implementation, we would parse the verdict from the output.
    // For now, let's assume GO if exitCode is 0.
    const verdict = result.exitCode === 0 ? "GO" : "NO-GO";

    if (verdict === "GO") {
      return { success: true, exitCode: 0 };
    } else {
      return this.handleNoGo("CODE_REVIEW");
    }
  }

  private async stageUatReview(): Promise<StageResult> {
    const result = await dispatchToAgent({
      agent: this.config.backend,
      workflow: "review-uat",
      featureDir: `specs/${this.config.featureId}`,
      prompt: `Phase ${this.config.phaseId} UAT Review`,
    });

    const verdict = result.exitCode === 0 ? "GO" : "NO-GO";

    if (verdict === "GO") {
      return { success: true, exitCode: 0 };
    } else {
      return this.handleNoGo("UAT_REVIEW");
    }
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
        digest: assembleDigest(path.join(this.config.cwd, ".runs", `${this.config.featureId}_p${this.config.phaseId.replace("phase-", "")}.events`)),
      };
      return { 
        success: false, 
        exitCode: 1, 
        error: `Circuit breaker tripped after ${this.config.maxIterations} iterations` 
      };
    }

    console.log(`NO-GO in ${stage}, looping back to IMPLEMENT (Iteration ${this.state.iteration})`);
    return { success: true, exitCode: 0, nextStage: ShipStage.IMPLEMENT };
  }
}
