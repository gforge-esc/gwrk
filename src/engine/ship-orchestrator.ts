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
      // 2. Dispatch the review agent directly.
      //    The review agent modifies tasks.json via tool calls (re-opening
      //    failed tasks). We don't need its JSON output — readVerdict()
      //    determines GO/NO-GO by diffing tasks.json.
      const result = await this.dispatchWithFailback({
        prompt,
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

      // 3. Post-dispatch validation (Snapshot-Diff-Revert)
      validatePhaseScope(
        this.config.cwd,
        this.config.featureId,
        this.config.phaseId,
        beforeState,
      );

      // 4. Determine verdict from task state diff
      const verdict = this.readVerdict();
      console.log(
        `    ${workflowName}: ${verdict === "GO" ? "\x1b[32mGO\x1b[0m" : "\x1b[31mNO-GO\x1b[0m"}`,
      );

      // 5. Discard review agent's source file mutations.
      //    Review agents in YOLO mode can modify source files (fixing imports,
      //    reformatting, etc.). These edits are often incomplete and can break
      //    the build (e.g., removing non-null assertions without adding guards).
      //    The review's value is the verdict + task feedback, not code edits.
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
      return { success: true, exitCode: 0, nextStage: ShipStage.CODE_REVIEW };
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
        // The implement agent (or pre-flight) may have marked tasks "completed"
        // but gates must pass AFTER implementation, not just before.
        // This is the mechanical enforcement — agents cannot self-certify.
        const postFlightState = loadTaskState(featureDir);
        const postFlightPhase = postFlightState.phases.find(
          (p: Phase) => p.id === this.config.phaseId,
        );
        if (postFlightPhase) {
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
              // Append gate failure to description for next implement attempt
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
          }
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

  private async stageCodeReview(): Promise<StageResult> {
    console.log("  ▸ CODE_REVIEW");
    const plugin = await resolveReviewPlugin(this.config.cwd);
    const prompt = `Phase ${this.config.phaseId} Code Review`;
    return this.executeReviewWorkflow(plugin.codeReviewWorkflow, prompt);
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

    const scopedPrompt = [
      `Phase ${this.config.phaseId} UAT Review`,
      "",
      "SCOPE CONSTRAINT: Only evaluate user stories and requirements addressed by THIS phase.",
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
        `    ${openTasks.length} task(s) re-opened: ${openTasks.map((t) => t.id).join(", ")}`,
      );
      // Show review feedback summary for each re-opened task
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
    return `Phase ${this.config.phaseId} Implementation\n\nTasks:\n${tasks.map((t) => `- ${t.id}: ${t.title}\n  ${t.description}`).join("\n")}`;
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
