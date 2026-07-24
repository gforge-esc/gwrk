/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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
import { createBranch, getCurrentBranch, isDirty, syncBranch } from "../utils/git.js";
import { assembleDigest } from "../utils/manifest.js";
import {
  type Phase,
  type Task,
  loadTaskState,
  saveTaskState,
} from "../utils/state.js";
import { getTestCommand, getTestExtension, getSourceExtension } from "../utils/toolchain-mapper.js";
import { detectProfile } from "./profile-detector.js";
import { conditionPrompt } from "./prompt-conditioner.js";
import {
  type ShipRunConfig,
  ShipStage,
  type ShipState,
  type ShipStageResult,
} from "./ship-types.js";
import { activatePhaseTests } from "./test-activator.js";
import { isHollowGate } from "../utils/gate-quality.js";
import { parseTestOutput } from "./test-runner.js";
import { extractFilePaths } from "../utils/file-extract.js";
import { discoverTestsForSources, listTestsTree } from "../utils/test-discovery.js";

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

  /** The branch to ship on. Defaults to feat/<featureId>. */
  private branchName(): string {
    return this.config.branchName ?? `feat/${this.config.featureId}`;
  }

  private getStatePath(): string {
    // State lives under stateRoot (defaults to cwd) so a worktree ship can keep
    // crash-recovery state in the primary checkout, surviving worktree teardown.
    return path.join(
      this.config.stateRoot ?? this.config.cwd,
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

  /** Expose final state for DB write-back by CLI wrapper. */
  public getResult(): {
    prNumber?: number;
    prUrl?: string;
    stage: ShipStage;
    gateResult?: "PASS" | "FAIL";
    reviewVerdict?: "GO" | "NO-GO";
  } {
    return {
      prNumber: this.state.prNumber,
      prUrl: this.state.prUrl,
      stage: this.state.stage,
      gateResult: this.state.gateResult,
      reviewVerdict: this.state.reviewVerdict,
    };
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

    // Pre-flight branch verification for state resumptions
    if (
      this.state.stage !== ShipStage.BRANCH_SETUP &&
      this.state.stage !== ShipStage.DONE &&
      this.state.stage !== ShipStage.CIRCUIT_BREAK
    ) {
      const branchName = this.branchName();
      const currentBranch = getCurrentBranch(this.config.cwd);
      if (currentBranch !== branchName) {
        console.log(`  ⚠ Resuming from state but currently on ${currentBranch}. Checking out ${branchName}...`);
        try {
          execSync(`git checkout ${branchName}`, { cwd: this.config.cwd, stdio: "ignore" });
        } catch (err: unknown) {
          console.error(`  ✗ Failed to checkout ${branchName}. Please checkout manually and retry.`);
          return 1;
        }
      }
    }

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

      let result: ShipStageResult;
      // ... rest of switch ...
      switch (this.state.stage) {
        case ShipStage.BRANCH_SETUP:
          result = await this.stageBranchSetup();
          break;
        case ShipStage.ACTIVATE_TESTS:
          result = await this.stageActivateTests();
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
        case ShipStage.DIAGNOSE:
          result = await this.stageDiagnose();
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



      // State file exists for crash recovery during a run. Once complete,
      // it's stale — delete it so the next invocation starts fresh.
      try {
        fs.unlinkSync(this.getStatePath());
      } catch { /* already gone */ }

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
  ): Promise<ShipStageResult> {
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

      // Phase 13: Project-aware prompt conditioning
      const profile = await detectProfile(this.config.cwd);
      const conditionedPrompt = conditionPrompt(reviewPrompt, profile);

      const result = await this.dispatchWithFailback({
        prompt: conditionedPrompt,
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

      // 3. Discard review agent's source file mutations BEFORE reading verdict.
      //    Review agents in YOLO mode can modify source files (fixing imports,
      //    reformatting, etc.). These edits are often incomplete and can break
      //    the build. We revert first so gates run against the implementer's
      //    clean build, not a build contaminated by review agent edits.
      //    We preserve tasks.json (carries verdict state) but restore everything else.
      this.revertSourceMutations();

      // 4. Determine verdict from gates (not agent edits).
      //    Gates are truth, agent verdict is advisory. (ADR-007)
      const verdict = await this.readVerdict();
      this.state.reviewVerdict = verdict;
      console.log(
        `    ${workflowName}: ${verdict === "GO" ? "\x1b[32mGO\x1b[0m" : "\x1b[31mNO-GO\x1b[0m"}`,
      );

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
      ShipStage.ACTIVATE_TESTS,
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

  private async stageBranchSetup(): Promise<ShipStageResult> {
    console.log("  ▸ BRANCH_SETUP");
    // FR-002: Dirty tree fail fast
    if (await isDirty(this.config.cwd)) {
      return {
        success: false,
        exitCode: 1,
        error: "Dirty working tree — commit or stash before shipping",
      };
    }

    const branchName = this.branchName();
    const currentBranch = getCurrentBranch(this.config.cwd);

    // Already on the correct feature branch — no checkout or merge needed.
    // The develop merge happens at PR merge time, not during ship.
    if (currentBranch === branchName) {
      console.log(`  Branch ${branchName} — already checked out`);
      this.state.branchName = branchName;
      if (this.state.iteration === 1) await this.captureTestBaseline();
      return { success: true, exitCode: 0 };
    }

    try {
      await createBranch(this.config.cwd, branchName, "develop");
      this.state.branchName = branchName;
      if (this.state.iteration === 1) await this.captureTestBaseline();
      return { success: true, exitCode: 0 };
    } catch (err: unknown) {
      // Branch already exists — just check it out (no develop merge)
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        try {
          const { execFileSync } = await import("node:child_process");
          execFileSync("git", ["checkout", branchName], {
            cwd: this.config.cwd,
            stdio: ["ignore", "ignore", "pipe"],
          });
          this.state.branchName = branchName;
          console.log(`  Branch ${branchName} exists — checked out`);
          if (this.state.iteration === 1) await this.captureTestBaseline();
          return { success: true, exitCode: 0 };
        } catch (checkoutErr: unknown) {
          const checkoutMsg =
            checkoutErr instanceof Error ? checkoutErr.message : String(checkoutErr);
          return {
            success: false,
            exitCode: 1,
            error: `Failed to checkout existing branch: ${checkoutMsg}`,
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
   * ACTIVATE_TESTS: Un-skip phase-tagged tests before IMPLEMENT.
   * Tests generated by `define tests` for future phases use it.skip()
   * with a @phase N docblock. This stage activates tests for the
   * current phase so the agent sees them as RED (not skipped).
   */
  private async stageActivateTests(): Promise<ShipStageResult> {
    console.log("  ▸ ACTIVATE_TESTS");
    const testFiles = await this.getPhaseTestFiles();
    if (testFiles.length === 0) {
      console.log("  ⏭ no phase-scoped test files found");
      return { success: true, exitCode: 0 };
    }

    const { activated, files } = activatePhaseTests(
      this.config.cwd,
      this.config.phaseId,
      testFiles,
    );

    if (activated > 0) {
      console.log(`  ✓ activated ${activated} test file(s): ${files.join(", ")}`);
      try {
        execSync(
          `git add ${files.join(" ")} && git commit --author="$(git config user.name) <$(git config user.email)>" -m "chore: activate ${this.config.phaseId} tests"`,
          {
            cwd: this.config.cwd,
            stdio: "pipe",
            env: { ...process.env, GWRK_SHIP: "1" },
          },
        );
      } catch {
        // Not fatal — files may already be tracked or no changes
      }

      // RED evidence (ADR-005 §10.2.3): the tests just activated for this phase
      // MUST fail before IMPLEMENT — that's what proves they exercise the
      // not-yet-built behavior. Recorded here as the precondition for a
      // meaningful GREEN at TEST_GATE.
      const red = await this.runTestSuite(files);
      if (red.testsRun === 0) {
        // Liveness (ADR-005 §10.2.1): a test that never ran cannot be RED. A
        // suite that discovered nothing or all-cancelled must NO-GO here — not
        // pass vacuously — so the same hole TEST_GATE closes can't sneak in
        // through ACTIVATE_TESTS.
        console.log(
          "  ✗ ACTIVATE_TESTS: activated tests executed 0 tests — cannot establish RED (ADR-005 §10.2.1)",
        );
        return {
          success: false,
          exitCode: 1,
          error:
            "Activated phase tests ran 0 tests — RED cannot be established (a test that cannot run cannot verify)",
        };
      }
      if (red.testsRun > 0 && red.failCount === 0) {
        console.log(
          "  ✗ ACTIVATE_TESTS: activated tests PASS before implementation — not RED (ADR-005 §10.2.3)",
        );
        return {
          success: false,
          exitCode: 1,
          error:
            "Activated phase tests are not RED (they pass before implementation) — a test that cannot fail cannot verify",
        };
      }
      console.log(
        `  ✓ RED: ${red.failCount} failing test(s) before implementation (${red.testsRun} ran)`,
      );
    } else {
      console.log("  ⏭ all tests already active");
    }

    return { success: true, exitCode: 0 };
  }

  /**
   * Post-flight gate verification. Re-runs gates for all completed tasks
   * in the current phase. If any fail, re-opens the task and returns a
   * failure result. Returns null if all gates pass.
   */
  private async runPostFlightGates(featureDir: string): Promise<ShipStageResult | null> {
    const postFlightState = loadTaskState(featureDir);
    const postFlightPhase = postFlightState.phases.find(
      (p: Phase) => p.id === this.config.phaseId,
    );
    if (!postFlightPhase) return null;

    let reopenedCount = 0;
    for (const task of postFlightPhase.tasks) {
      if (task.status !== "completed" || !task.gateScript) continue;

      // Gate resolution: 3 strategies (must match gwrk gate CLI)
      // 1. Gate file in gates/ directory (canonical)
      const conventionPath = path.join(
        featureDir, "gates", `${task.id}-gate.sh`,
      );
      // 2. gateScript as file path relative to feature dir
      const scriptPath = path.join(featureDir, task.gateScript);

      let gateResult: { passed: boolean; output: string };
      let gateLabel: string;

      if (fs.existsSync(conventionPath)) {
        // Strategy 1: canonical gate file
        gateLabel = `gates/${task.id}-gate.sh`;
        const result = await runGate(conventionPath);
        gateResult = { passed: result.passed, output: result.output };
      } else if (fs.existsSync(scriptPath)) {
        // Strategy 2: gateScript as file path
        gateLabel = task.gateScript;
        const result = await runGate(scriptPath);
        gateResult = { passed: result.passed, output: result.output };
      } else {
        // Strategy 3: gateScript as inline shell command
        gateLabel = `(inline) ${task.gateScript.substring(0, 60)}`;
        if (isHollowGate(task.gateScript)) {
          // FR-001 (ADR-005 §10.2.5): file-existence-only gates aren't verification.
          gateResult = {
            passed: false,
            output:
              "FAIL: hollow gate (test -f only) — not a functional assertion (FR-001)",
          };
        } else {
          try {
            const output = execSync(task.gateScript, {
              cwd: this.config.cwd,
              stdio: "pipe",
              timeout: 30_000,
              encoding: "utf-8",
            });
            gateResult = { passed: true, output: output || "" };
          } catch (err: unknown) {
            const stderr = (err as { stderr?: string })?.stderr || "";
            gateResult = { passed: false, output: stderr || String(err) };
          }
        }
      }

      if (!gateResult.passed) {
        task.status = "open";
        task.completedAt = undefined;
        reopenedCount++;
        console.log(
          `  ✗ post-flight FAIL: ${task.id} — ${gateLabel}`,
        );
        const failNote = `\n\nPOST-FLIGHT GATE FAIL: ${gateLabel} exited non-zero.\n  OUTPUT: ${gateResult.output.slice(0, 200)}`;
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

  private async stageImplement(): Promise<ShipStageResult> {
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

      // Phase 13: Project-aware prompt conditioning
      const profile = await detectProfile(this.config.cwd);
      const conditionedPrompt = conditionPrompt(prompt, profile);

      const taskIds = tasksToDispatch.map((t) => t.id).join(", ");
      console.log(
        `  ▸ IMPLEMENT  ${isRetry ? `retry (${this.state.iteration}/${this.config.maxIterations})` : `${tasksToDispatch.length} task(s) (${taskIds})`}`,
      );

      const result = await this.dispatchWithFailback({
        agent: this.config.backend,
        workflow: "gwrk-implement",
        featureDir: `specs/${this.config.featureId}`,
        prompt: conditionedPrompt,
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
  /**
   * Resolve the project's build command, or null if it has no build to gate on.
   * Returns null when there is no package.json or no `build` script; otherwise
   * picks the package manager from the lockfile (pnpm/yarn/npm).
   */
  private resolveBuildCommand(): string | null {
    const pkgPath = path.join(this.config.cwd, "package.json");
    if (!fs.existsSync(pkgPath)) return null;
    let pkg: { scripts?: Record<string, string> };
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    } catch {
      return null;
    }
    if (!pkg.scripts?.build) return null;
    if (fs.existsSync(path.join(this.config.cwd, "pnpm-lock.yaml"))) {
      return "pnpm build";
    }
    if (fs.existsSync(path.join(this.config.cwd, "yarn.lock"))) {
      return "yarn build";
    }
    return "npm run build";
  }

  private async stageBuildCheck(): Promise<ShipStageResult> {
    console.log("  ▸ BUILD_CHECK");

    // Early phases of a cold-start project may have no build system yet (the
    // Node app is bootstrapped in a later phase). Only gate on a build when the
    // project actually has one, and use its package manager rather than
    // assuming pnpm.
    const buildCommand = this.resolveBuildCommand();
    if (!buildCommand) {
      console.log("  ⏭ no build script — skipping build gate");
      return { success: true, exitCode: 0, nextStage: ShipStage.TEST_GATE };
    }

    try {
      execSync(buildCommand, {
        cwd: this.config.cwd,
        stdio: "pipe",
        timeout: 60_000, // 60s — build should never take longer
      });
      console.log("  ✓ build passed");
      return { success: true, exitCode: 0, nextStage: ShipStage.TEST_GATE };
    } catch (err: unknown) {
      // Capture both streams — tools write build errors to stdout as often as
      // stderr, and an empty capture leaves DIAGNOSE with nothing to work with.
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      const combined = `${e.stdout?.toString() ?? ""}\n${e.stderr?.toString() ?? ""}`.trim();
      const lastLines =
        combined.split("\n").slice(-15).join("\n") || "(no build output captured)";
      console.log(`  ✗ build FAILED:\n${lastLines}`);

      // Re-open tasks so the retry agent has work to do
      const featureDir = path.join(this.config.cwd, "specs", this.config.featureId);
      const taskState = loadTaskState(featureDir);
      const phase = taskState.phases.find((p: Phase) => p.id === this.config.phaseId);
      if (phase) {
        for (const task of phase.tasks) {
          if (task.status === "completed") {
            task.status = "open";
            task.completedAt = undefined;
            task.description = `${task.description || ""}\n\nBUILD_CHECK FAILED:\n${lastLines}`.trim();
          }
        }
        saveTaskState(featureDir, taskState);
      }
      return this.handleNoGo("BUILD_CHECK");
    }
  }

  /**
   * TEST_GATE: Baseline comparison test verification.
   * Only triggers NO-GO if tests got WORSE than the baseline captured
   * at BRANCH_SETUP. Pre-existing RED tests don't block unrelated work.
   */
  private async stageTestGate(): Promise<ShipStageResult> {
    console.log("  ▸ TEST_GATE");
    const phaseTestFiles = await this.getPhaseTestFiles();

    // ADR-005 §10.2.1 — Liveness: when a phase maps to test files, those tests
    // MUST actually execute and pass. A suite that discovered nothing or whose
    // tests all cancelled (testsRun === 0) is a FAIL, never "no regression".
    if (phaseTestFiles.length > 0) {
      console.log(`    scoped to: ${phaseTestFiles.join(", ")}`);
      const r = await this.runTestSuite(phaseTestFiles);
      if (r.testsRun === 0) {
        console.log(
          "  ✗ TEST_GATE: phase tests executed 0 tests (none discovered / all cancelled) — not a pass",
        );
        return this.handleNoGo("TEST_GATE");
      }
      if (r.failCount > 0) {
        console.log(
          `  ✗ TEST_GATE: ${r.failCount} failing test(s) in phase suite (${r.testsRun} ran)`,
        );
        return this.handleNoGo("TEST_GATE");
      }
      console.log(
        `  ✓ tests: ${r.passed} passed, 0 failed (${r.testsRun} ran)`,
      );
      return { success: true, exitCode: 0, nextStage: ShipStage.CODE_REVIEW };
    }

    const { failCount, output } = await this.runTestSuite(phaseTestFiles);
    const baseline = this.state.testBaseline ?? 0;

    if (failCount === 0) {
      console.log("  ✓ tests passed (0 failures)");
      return { success: true, exitCode: 0, nextStage: ShipStage.CODE_REVIEW };
    }
    if (failCount <= baseline) {
      console.log(`  ✓ tests: ${failCount} failure(s) — baseline was ${baseline}, no regression`);
      return { success: true, exitCode: 0, nextStage: ShipStage.CODE_REVIEW };
    }

    const regressionCount = failCount - baseline;
    const lastLines = output.split("\n").slice(-20).join("\n");
    console.log(`  ✗ TEST_GATE: ${regressionCount} new failure(s) (${failCount} total, baseline ${baseline}):\n${lastLines}`);

    const featureDir = path.join(this.config.cwd, "specs", this.config.featureId);
    const taskState = loadTaskState(featureDir);
    const phase = taskState.phases.find((p: Phase) => p.id === this.config.phaseId);
    if (phase) {
      for (const task of phase.tasks) {
        if (task.status === "completed") {
          task.status = "open";
          task.completedAt = undefined;
          task.description = `${task.description || ""}\n\nTEST_GATE REGRESSION (${regressionCount} new):\n${lastLines}`.trim();
        }
      }
      saveTaskState(featureDir, taskState);
    }
    return this.handleNoGo("TEST_GATE");
  }

  /** Run test suite, return failure count and output.
   *  When phaseTestFiles are available, runs only those files instead of
   *  the full suite. This prevents cross-phase RED test contamination.
   */
  private async runTestSuite(
    phaseTestFiles?: string[],
  ): Promise<{ failCount: number; testsRun: number; passed: number; output: string }> {
    const profile = await detectProfile(this.config.cwd);

    // Resolve the profile's test command. `null` = project declares no test
    // toolchain → skip (ADR-005 §11); the TEST_GATE stage turns this into a
    // GO-with-message rather than a testsRun==0 failure (Phase 05).
    const scoped = phaseTestFiles && phaseTestFiles.length > 0;
    const resolved = scoped
      ? getTestCommand(profile, phaseTestFiles)
      : getTestCommand(profile, []);
    if (resolved === null) {
      return { failCount: 0, testsRun: 0, passed: 0, output: "(no test toolchain — skipped)" };
    }
    let command = resolved;
    if (!scoped) {
      // Whole-suite run: drop the empty file list the mapper leaves behind.
      if (command.includes("vitest run")) command = "pnpm vitest run";
      else if (command.includes("jest")) command = "npx jest";
    }

    let output: string;
    try {
      output = execSync(command, {
        cwd: this.config.cwd,
        stdio: "pipe",
        timeout: 120_000,
      }).toString();
    } catch (err: unknown) {
      const stdout = (err as { stdout?: Buffer })?.stdout?.toString().trim() || "";
      const stderr = (err as { stderr?: Buffer })?.stderr?.toString().trim() || "";
      output = `${stdout}\n${stderr}`.trim();
    }
    const { testsRun, passed, failed } = parseTestOutput(output);
    return { failCount: failed, testsRun, passed, output };
  }

  /**
   * Extract test file paths from the current phase's task descriptions.
   * Returns paths like "src/commands/research.test.ts" found in task
   * titles/descriptions. Falls back to filesystem convention (co-located .test.ts).
   */
  private async getPhaseTestFiles(): Promise<string[]> {
    try {
      const profile = await detectProfile(this.config.cwd);
      const testExt = getTestExtension(profile);
      const sourceExt = getSourceExtension(profile);

      const featureDir = path.join(this.config.cwd, "specs", this.config.featureId);
      const taskState = loadTaskState(featureDir);
      const phase = taskState.phases.find((p: Phase) => p.id === this.config.phaseId);
      if (!phase) return [];

      const mentionedTests: string[] = [];
      const sourceFiles: string[] = [];

      for (const task of phase.tasks) {
        const text = `${task.title} ${task.description ?? ""}`;
        for (const filePath of extractFilePaths(text)) {
          if (filePath.endsWith(testExt)) {
            mentionedTests.push(filePath);
          } else if (filePath.endsWith(sourceExt) || filePath.endsWith(".js") || filePath.endsWith(".ts")) {
            sourceFiles.push(filePath);
          }
        }
      }

      // Discover covering tests: existing mentions, co-located, AND out-of-tree
      // tests/ suites (matched by source basename) — so the liveness gate can
      // actually run tests that live outside the source tree.
      return discoverTestsForSources({
        sourceFiles,
        mentionedTests,
        testExt,
        fileExists: (rel) => fs.existsSync(path.join(this.config.cwd, rel)),
        testsTreeFiles: listTestsTree(this.config.cwd),
      });
    } catch {
      return [];
    }
  }

  /** Snapshot test failure count before IMPLEMENT touches anything. */
  private async captureTestBaseline(): Promise<void> {
    console.log("  ▸ capturing test baseline...");
    const phaseTestFiles = await this.getPhaseTestFiles();
    if (phaseTestFiles.length > 0) {
      console.log(`    scoped to: ${phaseTestFiles.join(", ")}`);
    }
    const { failCount } = await this.runTestSuite(phaseTestFiles);
    this.state.testBaseline = failCount;
    console.log(`  ✓ baseline: ${failCount} pre-existing failure(s)`);
  }

  private async stageCodeReview(): Promise<ShipStageResult> {
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

  private async stageUatReview(): Promise<ShipStageResult> {
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
        console.log(`    ⚠ Gate FAILED: ${task.id} (${gatePath})`);
        console.log(`      exit: ${gateResult.exitCode}`);
        console.log(`      output: ${gateResult.output.slice(0, 500)}`);
        task.status = "open";
        task.completedAt = undefined;
        // Inject gate output so DIAGNOSE can analyze the failure
        const gateSnippet = gateResult.output.slice(0, 500);
        task.description = `${task.description || ""}\n\nPOST-FLIGHT GATE FAIL (${task.id}, gate: ${task.gateScript}):\nexit: ${gateResult.exitCode}\n${gateSnippet}`.trim();
        failedCount++;
      }
    }

    // Persist reconciled state
    saveTaskState(featureDir, taskState);

    if (failedCount > 0) {
      this.state.gateResult = "FAIL";
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
    this.state.gateResult = "PASS";
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

  private async stagePrCi(): Promise<ShipStageResult> {
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
        this.state.prNumber = Number(prNumber);
        this.state.prUrl = "";
        try {
          this.state.prUrl = execSync(
            `gh pr view ${prNumber} --json url --jq '.url'`,
            { cwd: this.config.cwd, encoding: "utf-8" },
          ).trim();
        } catch { /* best-effort URL resolution */ }
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

  private handleNoGo(stage: string): ShipStageResult {
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

    // Route through DIAGNOSE before retrying IMPLEMENT.
    // DIAGNOSE uses a thinking model to analyze the error and produce
    // targeted fix instructions, preventing blind retry loops.
    console.log(
      `  ↻ NO-GO → DIAGNOSE → IMPLEMENT (${this.state.iteration}/${this.config.maxIterations})`,
    );
    return { success: true, exitCode: 0, nextStage: ShipStage.DIAGNOSE };
  }

  /**
   * DIAGNOSE: Thinking-model analysis of gate failures before retry.
   *
   * When BUILD_CHECK or TEST_GATE fails, the implement agent retries blind —
   * it sees the error text appended to task descriptions but lacks the analytical
   * capacity to reason about root causes (missing imports, type mismatches,
   * circular dependencies). This stage dispatches a thinking model to:
   *
   * 1. Read the error output from the failed gate
   * 2. Read the relevant source files mentioned in the errors
   * 3. Produce a targeted, actionable fix plan (not code — instructions)
   * 4. Inject those instructions into task descriptions for the retry
   *
   * The thinking model is NOT given tool access — it reasons only, it doesn't edit.
   * The implement agent then executes the fix with full tool access.
   */
  private async stageDiagnose(): Promise<ShipStageResult> {
    console.log("  ▸ DIAGNOSE");
    const featureDir = path.join(this.config.cwd, "specs", this.config.featureId);
    const taskState = loadTaskState(featureDir);
    const phase = taskState.phases.find((p: Phase) => p.id === this.config.phaseId);

    if (!phase) {
      // No phase data — skip diagnosis, proceed to implement
      return { success: true, exitCode: 0, nextStage: ShipStage.IMPLEMENT };
    }

    // Collect error context from open tasks (appended by BUILD_CHECK/TEST_GATE)
    const errorContext: string[] = [];
    for (const task of phase.tasks) {
      if (task.status === "open" && task.description) {
        const errorMatch = task.description.match(
          /(?:BUILD_CHECK FAILED|TEST_GATE REGRESSION|POST-FLIGHT GATE FAIL)[\s\S]*$/,
        );
        if (errorMatch) {
          errorContext.push(`Task ${task.id}: ${errorMatch[0]}`);
        }
      }
    }

    if (errorContext.length === 0) {
      console.log("    ⏭ no error context to diagnose");
      return { success: true, exitCode: 0, nextStage: ShipStage.IMPLEMENT };
    }

    // Run a fresh build/test to capture current error state
    let currentErrors = "";
    try {
      execSync("pnpm build", {
        cwd: this.config.cwd,
        stdio: "pipe",
        timeout: 60_000,
      });
      // Build passes now? Some iteration may have partially fixed things.
      // Still run diagnosis on test failures if any.
    } catch (err: unknown) {
      const stderr = (err as { stderr?: Buffer })?.stderr?.toString().trim() || "";
      currentErrors = stderr;
    }

    // Build the diagnosis prompt — concise, targeted, no agent narration
    const diagnosisPrompt = [
      "You are a TypeScript build diagnostician. Analyze these errors and produce SPECIFIC fix instructions.",
      "",
      "## Current Build/Test Errors",
      currentErrors || "(build passes — check test failures in task descriptions below)",
      "",
      "## Error Context from Failed Gates",
      ...errorContext,
      "",
      "## Instructions",
      "For each error, produce ONE line in this exact format:",
      "FIX: <file_path> — <what to do>",
      "",
      "Examples:",
      "FIX: src/commands/plugin.ts — Add missing import: `import { type PluginSummary } from '../plugins/loader.js'`",
      "FIX: src/utils/config.ts — Change `extensions` type from `string[]` to `Record<string, ExtensionConfig>`",
      "FIX: src/engine/profile-detector.ts — Remove duplicate export of `detectProfile`",
      "",
      "Be SPECIFIC. Name the exact file, the exact import, the exact type. Do NOT explain why.",
      "Do NOT produce code blocks. Just FIX: lines.",
    ].join("\n");

    try {
      // Dispatch to thinking model — no tool access, reasoning only
      const result = await dispatchToAgent({
        agent: this.config.backend,
        prompt: diagnosisPrompt,
        featureDir: `specs/${this.config.featureId}`,
        quiet: true,
        env: {
          // Force thinking model if available
          GEMINI_MODEL: "gemini-2.5-pro",
        },
      });

      if (result.exitCode === 0 && result.stdout) {
        // Extract FIX: lines from the diagnosis output
        const fixLines = result.stdout
          .split("\n")
          .filter((line: string) => line.trim().startsWith("FIX:"))
          .map((line: string) => line.trim());

        if (fixLines.length > 0) {
          const fixBlock = `\n\nDIAGNOSIS (iteration ${this.state.iteration}):\n${fixLines.join("\n")}`;
          console.log(`    ✓ diagnosis produced ${fixLines.length} fix instruction(s)`);

          // Inject fix instructions into open task descriptions
          for (const task of phase.tasks) {
            if (task.status === "open") {
              task.description = `${task.description || ""}${fixBlock}`.trim();
            }
          }
          saveTaskState(featureDir, taskState);
        } else {
          console.log("    ⚠ diagnosis produced no FIX: lines");
        }
      } else {
        console.log(`    ⚠ diagnosis dispatch failed (exit ${result.exitCode}), proceeding to IMPLEMENT anyway`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`    ⚠ diagnosis error: ${msg}, proceeding to IMPLEMENT anyway`);
    }

    // Always proceed to IMPLEMENT — diagnosis is advisory, not blocking
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

    // 2. Dispatch — run the agent in the ship working tree (cwd), not
    // process.cwd(). Identical for the primary checkout; under worktree-isolated
    // shipping this points the agent at the per-feature worktree.
    const workDir = task.workDir ?? this.config.cwd;
    const result = await dispatchToAgent({ ...task, model, env, workDir });

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
          workDir,
        });
        if (fbResult.exitCode === 0) return fbResult;
      }
    }

    return result;
  }
}
