/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import { loadTaskState } from "../utils/state.js";
import { planToTasks } from "./plan-to-tasks.js";
import {
  generateFilesystemGates,
  generateRunner,
  generateVitestGates,
} from "../utils/gate-gen.js";
import {
  type DefineRunConfig,
  DefineStage,
  type DefineState,
  type StageResult,
} from "./define-types.js";
import { dryRun as dryRunFmt } from "../utils/format.js";

export class DefineOrchestrator extends EventEmitter {
  private config: DefineRunConfig;
  private state: DefineState;
  private runtime: WorkflowRuntime;

  constructor(
    config: DefineRunConfig,
    state?: DefineState,
    runtime?: WorkflowRuntime,
  ) {
    super();
    this.config = config;
    this.runtime = runtime || new WorkflowRuntime();
    
    // Attempt to load existing state if not provided
    if (state) {
      this.state = state;
    } else {
      const persisted = this.loadPersistedState();
      this.state = persisted || this.initializeState();
    }
  }

  private loadPersistedState(): DefineState | undefined {
    const statePath = this.getStatePath();
    if (fs.existsSync(statePath)) {
      try {
        const content = fs.readFileSync(statePath, "utf-8");
        return JSON.parse(content) as DefineState;
      } catch (err) {
        console.warn(`Warning: Could not load persisted state from ${statePath}: ${err}`);
      }
    }
    return undefined;
  }

  private initializeState(): DefineState {
    const featureDir = path.join(this.config.cwd, "specs", this.config.featureId);
    const specPath = path.join(featureDir, "spec.md");
    const planPath = path.join(featureDir, "plan.md");
    const tasksPath = path.join(featureDir, ".gwrk", "tasks.json");

    let initialStage = DefineStage.SPECIFY;

    // Progression: Spec -> Plan -> DefineTests -> Tasks -> Checklist -> Analyze -> Done
    if (fs.existsSync(specPath)) {
      initialStage = DefineStage.PLAN;
      // Check if spec has content (not just a stub)
      const specContent = fs.readFileSync(specPath, "utf-8");
      if (specContent.includes("{{FEATURE_NUMBER}}") || specContent.length < 100) {
        initialStage = DefineStage.SPECIFY;
      } else if (fs.existsSync(planPath)) {
        initialStage = DefineStage.DEFINE_TESTS;
        
        // ADR-005 §8.4: Define tests must run before tasks
        // FR-027: Detect test files OR gap-matrix.md
        const gapMatrixPath = path.join(featureDir, "gap-matrix.md");
        const hasTestFiles = (() => {
          try {
            const srcDir = path.join(this.config.cwd, "src");
            if (!fs.existsSync(srcDir)) return false;
            const allFiles = fs.readdirSync(srcDir);
            return allFiles.some(
              (f) => f.includes(this.config.featureId) && f.endsWith(".test.ts"),
            );
          } catch {
            return false;
          }
        })();

        if (fs.existsSync(gapMatrixPath) || hasTestFiles) {
          initialStage = DefineStage.PLAN_TO_TASKS;
          if (fs.existsSync(tasksPath)) {
            initialStage = DefineStage.CHECKLIST;
          }
        }
      }
    }

    return {
      stage: initialStage,
      featureId: this.config.featureId,
      startedAt: new Date().toISOString(),
      runId: `define-${this.config.featureId}-${Date.now()}`,
      backend: this.config.backend,
      refs: this.config.refs,
      reconcile: this.config.reconcile,
    };
  }

  private getStatePath(): string {
    return path.join(
      this.config.cwd,
      ".runs",
      `${this.config.featureId}_define.state`,
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

  private getNextStage(stage: DefineStage): DefineStage {
    const stages = [
      DefineStage.SPECIFY,
      DefineStage.PLAN,
      DefineStage.DEFINE_TESTS,
      DefineStage.PLAN_TO_TASKS,
      DefineStage.CHECKLIST,
      DefineStage.ANALYZE,
      DefineStage.DONE,
    ];
    const currentIndex = stages.indexOf(stage);
    if (currentIndex === -1) return DefineStage.DONE;
    return stages[currentIndex + 1] || DefineStage.DONE;
  }

  /**
   * Primary entry point for the orchestrator (WorkflowRuntime contract).
   * @param initialInput - Optional input for the starting stage (e.g. rework instructions)
   * @param options - Execution options
   */
  public async runLoop(initialInput?: string, options: { stopAfterOne?: boolean } = {}): Promise<number> {
    if (!this.config.dryRun) {
      console.log(`Starting Define Loop for ${this.config.featureId} at stage: ${this.state.stage}`);
    }

    let currentInput = initialInput;

    while (this.state.stage !== DefineStage.DONE) {
      if (!this.config.dryRun) {
        this.persistState();
      }
      
      let result: StageResult;

      switch (this.state.stage) {
        case DefineStage.SPECIFY:
          result = await this.stageSpecify(currentInput);
          break;
        case DefineStage.PLAN:
          result = await this.stagePlan(currentInput);
          break;
        case DefineStage.DEFINE_TESTS:
          result = await this.stageDefineTests(currentInput);
          break;
        case DefineStage.PLAN_TO_TASKS:
          result = await this.stagePlanToTasks(currentInput);
          break;
        case DefineStage.CHECKLIST:
          result = await this.stageChecklist();
          break;
        case DefineStage.ANALYZE:
          result = await this.stageAnalyze();
          break;
        default:
          this.state.stage = DefineStage.DONE;
          continue;
      }

      // Input is only consumed by the first stage it hits
      currentInput = undefined;

      if (!result.success) {
        if (!this.config.dryRun) {
          console.error(`Stage ${this.state.stage} failed: ${result.error}`);
        }
        return result.exitCode;
      }

      const next = result.nextStage || this.getNextStage(this.state.stage);

      if (!this.config.dryRun) {
        // Auto-commit define artifacts after each successful stage
        try {
          execSync("git add -A", { cwd: this.config.cwd });
          const stageName = this.state.stage.toLowerCase().replace(/_/g, "-");
          execSync(
            `git commit --author="$(git config user.name) <$(git config user.email)>" -m "chore(${this.config.featureId}): define ${stageName}"`,
            {
              cwd: this.config.cwd,
              env: { ...process.env, GWRK_SHIP: "1" },
              stdio: "ignore",
            },
          );
        } catch {
          // Non-fatal — nothing to commit or git not available
        }

        console.log(`Transitioning: ${this.state.stage} -> ${next}`);
      }
      
      this.state.stage = next;

      if (options.stopAfterOne) {
        break;
      }
    }

    if (!this.config.dryRun) {
      this.persistState();
      // Clean up state on success if we reached DONE
      if (this.state.stage === DefineStage.DONE && fs.existsSync(this.getStatePath())) {
        fs.unlinkSync(this.getStatePath());
      }

      if (this.state.stage === DefineStage.DONE) {
        this.emit("plan:define:complete", {
          featureId: this.config.featureId,
          status: "DEFINED",
        });
      }
    }

    return 0;
  }

  /** Legacy run() for compatibility */
  public async run(): Promise<number> {
    return this.runLoop();
  }

  private getRefsContext(): string {
    if (!this.config.refs) return "";
    const resolvedRefs = path.resolve(this.config.refs);
    if (!fs.existsSync(resolvedRefs)) return "";

    try {
      const content = fs.readFileSync(resolvedRefs, "utf-8");
      return [
        `<reference_document source="${this.config.refs}" authority="primary">`,
        content,
        `</reference_document>`,
        "",
        "CRITICAL: Use the reference document above as the authoritative source.",
      ].join("\n");
    } catch (err) {
      console.warn(`Warning: Could not read refs file ${resolvedRefs}: ${err}`);
      return "";
    }
  }

  private async stageSpecify(input?: string): Promise<StageResult> {
    if (this.config.dryRun) {
      dryRunFmt("gwrk-specify", this.config.backend);
      return { success: true, exitCode: 0 };
    }

    console.log("Stage: SPECIFY");
    try {
      const refs = this.getRefsContext();
      const prompt = input || `Create a NEW spec for feature ${this.config.featureId}`;
      const effectiveInput = refs ? `${refs}\n\n${prompt}` : prompt;

      const result = await this.runtime.executeWorkflow("gwrk-specify", effectiveInput, {
        agent: this.config.backend,
        model: this.config.model,
        projectRoot: this.config.cwd,
        quiet: true,
      });

      console.log(`  ${result.summary}`);
      return { success: true, exitCode: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, exitCode: 1, error: msg };
    }
  }

  private async stagePlan(input?: string): Promise<StageResult> {
    if (this.config.dryRun) {
      dryRunFmt("gwrk-plan", this.config.backend);
      return { success: true, exitCode: 0 };
    }

    console.log("Stage: PLAN");
    try {
      const refs = this.getRefsContext();
      const prompt = input || `Plan implementation for feature ${this.config.featureId}`;
      const effectiveInput = refs ? `${refs}\n\n${prompt}` : prompt;

      const result = await this.runtime.executeWorkflow("gwrk-plan", effectiveInput, {
        agent: this.config.backend,
        model: this.config.model,
        projectRoot: this.config.cwd,
        quiet: true,
      });

      console.log(`  ${result.summary}`);
      return { success: true, exitCode: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, exitCode: 1, error: msg };
    }
  }

  private async stageDefineTests(input?: string): Promise<StageResult> {
    if (this.config.dryRun) {
      dryRunFmt("gwrk-define-tests", this.config.backend);
      return { success: true, exitCode: 0 };
    }

    console.log("Stage: DEFINE_TESTS");
    try {
      const refs = this.getRefsContext();
      const prompt = input || `Generate tests for feature ${this.config.featureId}`;
      const effectiveInput = refs ? `${refs}\n\n${prompt}` : prompt;

      const result = await this.runtime.executeWorkflow("gwrk-define-tests", effectiveInput, {
        agent: this.config.backend,
        model: this.config.model,
        projectRoot: this.config.cwd,
        quiet: true,
      });

      console.log(`  ${result.summary}`);
      return { success: true, exitCode: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, exitCode: 1, error: msg };
    }
  }

  private async stagePlanToTasks(_input?: string): Promise<StageResult> {
    if (this.config.dryRun) {
      dryRunFmt("plan-to-tasks (deterministic)", "local");
      return { success: true, exitCode: 0 };
    }

    console.log("Stage: PLAN_TO_TASKS");
    try {
      const featureDir = path.join(this.config.cwd, "specs", this.config.featureId);
      const state = planToTasks(featureDir, this.config.featureId, {
        reconcile: this.state.reconcile,
      });
      const taskCount = state.phases.reduce((sum, p) => sum + p.tasks.length, 0);
      console.log(`  ✓ Generated ${state.phases.length} phase(s), ${taskCount} task(s) from plan.md (deterministic)`);

      // ── Invalidate stale ship orchestrator state files ──
      try {
        const runsDir = path.join(this.config.cwd, ".runs");
        if (fs.existsSync(runsDir)) {
          const stateFiles = fs.readdirSync(runsDir)
            .filter(f => f.startsWith(`${this.config.featureId}_phase-`) && f.endsWith(".state"));
          
          let cleaned = 0;
          for (const stateFile of stateFiles) {
            const stateFilePath = path.join(runsDir, stateFile);
            try {
              const savedState = JSON.parse(fs.readFileSync(stateFilePath, "utf-8"));
              if (savedState.stage === "DONE") {
                const phaseId = savedState.phaseId;
                const phaseData = state.phases.find(p => p.id === phaseId);
                if (phaseData && phaseData.tasks.some(t => t.status === "open")) {
                  fs.unlinkSync(stateFilePath);
                  cleaned++;
                }
              }
            } catch {
              fs.unlinkSync(stateFilePath);
              cleaned++;
            }
          }
          if (cleaned > 0) console.log(`  ✓ cleaned ${cleaned} stale ship state file(s)`);
        }
      } catch (cleanupErr) {
        console.warn(`  ⚠ state cleanup failed: ${cleanupErr}`);
      }

      // ── Deterministic gate generation ──
      try {
        const gapMatrixPath = path.join(featureDir, "gap-matrix.md");
        let gateResult: { generated: number; skipped: number };
        
        if (fs.existsSync(gapMatrixPath)) {
          console.log("  ▸ generating vitest gates from gap-matrix.md");
          gateResult = generateVitestGates(featureDir, gapMatrixPath, state.phases);
        } else {
          console.log("  ▸ generating vitest gates from filesystem convention");
          gateResult = generateFilesystemGates(featureDir, state.phases);
        }

        const gatesDir = path.join(featureDir, "gates");
        if (fs.existsSync(gatesDir)) generateRunner(gatesDir);
        
        console.log(`  ✓ gates: ${gateResult.generated} generated, ${gateResult.skipped} skipped`);
      } catch (gateError) {
        console.warn(`  ⚠ gate generation failed: ${gateError}`);
      }

      return { success: true, exitCode: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, exitCode: 1, error: msg };
    }
  }

  private async stageChecklist(): Promise<StageResult> {
    if (this.config.dryRun) {
      dryRunFmt("gwrk-checklist", this.config.backend);
      return { success: true, exitCode: 0 };
    }

    console.log("Stage: CHECKLIST");
    try {
      const result = await this.runtime.executeWorkflow("gwrk-checklist", `Generate checklist for feature ${this.config.featureId}`, {
        agent: this.config.backend,
        model: this.config.model,
        projectRoot: this.config.cwd,
        quiet: true,
      });

      console.log(`  ${result.summary}`);
      return { success: true, exitCode: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Warning: CHECKLIST stage skipped or failed: ${msg}`);
      return { success: true, exitCode: 0 };
    }
  }

  private async stageAnalyze(): Promise<StageResult> {
    if (this.config.dryRun) {
      dryRunFmt("gwrk-analyze", this.config.backend);
      return { success: true, exitCode: 0 };
    }

    console.log("Stage: ANALYZE");
    try {
      const result = await this.runtime.executeWorkflow("gwrk-analyze", `Analyze consistency for feature ${this.config.featureId}`, {
        agent: this.config.backend,
        model: this.config.model,
        projectRoot: this.config.cwd,
        quiet: true,
      });

      console.log(`  ${result.summary}`);
      return { success: true, exitCode: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Warning: ANALYZE stage skipped or failed: ${msg}`);
      return { success: true, exitCode: 0 };
    }
  }
}
