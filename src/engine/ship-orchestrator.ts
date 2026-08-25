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
import { getBuildCommand, getTestCommand, getTestExtension, getSourceExtension } from "../utils/toolchain-mapper.js";
import { appendFinding, findingsPath } from "./findings-ledger.js";
import { detectProfile } from "./profile-detector.js";
import { conditionPrompt } from "./prompt-conditioner.js";
import {
  type ShipRunConfig,
  ShipStage,
  type ShipState,
  type ShipStageResult,
} from "./ship-types.js";
import { activatePhaseTests } from "./test-activator.js";
import { getPhaseVerificationGate } from "../utils/gate-quality.js";
import { runTaskGate, runInlineGate, type TaskGateResult } from "../utils/gate-exec.js";
import { isIntegrationTestCommand, parseTestOutput } from "./test-runner.js";
import { extractFilePaths } from "../utils/file-extract.js";
import { discoverTestsForSources, listTestsTree } from "../utils/test-discovery.js";
import { startProgress } from "../utils/progress.js";

/**
 * Start the progress indicator shared by both spinner wrappers. Animates on a
 * terminal, heartbeats once a minute when stdout is redirected to a log.
 */
function startStageProgress(label: string) {
  return startProgress({
    label,
    write: (chunk) => process.stdout.write(chunk),
    isTTY: process.stdout.isTTY === true,
    indent: "    ",
    frameMs: 150,
    formatElapsed: (seconds) => `${seconds}s`,
  });
}

/**
 * Run a synchronous blocking operation with a visible spinner.
 * Clears the spinner line on completion and prints the result.
 */
function withSpinner<T>(label: string, fn: () => T): T {
  const start = Date.now();
  const progress = startStageProgress(label);
  const settle = (mark: string) => {
    progress.stop();
    const elapsed = Math.floor((Date.now() - start) / 1000);
    process.stdout.write(`    ${mark} ${label} (${elapsed}s)\n`);
  };

  try {
    const result = fn();
    settle("✓");
    return result;
  } catch (err) {
    settle("✗");
    throw err;
  }
}

/**
 * `withSpinner` for an awaited operation. Needed once the CI wait became async
 * to accommodate retry backoff — the sync version would resolve the promise
 * instantly and clear the spinner before the work finished.
 */
async function withSpinnerAsync<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  const progress = startStageProgress(label);
  const settle = (mark: string) => {
    progress.stop();
    const elapsed = Math.floor((Date.now() - start) / 1000);
    process.stdout.write(`    ${mark} ${label} (${elapsed}s)\n`);
  };

  try {
    const result = await fn();
    settle("✓");
    return result;
  } catch (err) {
    settle("✗");
    throw err;
  }
}

/**
 * One phase carried by a pull request, as recorded in its body marker.
 *
 * `gate`/`review` are absent for phases recovered from a pre-marker PR title,
 * where the verdicts were never written down. Absent means "not recorded" —
 * never "passed".
 */
interface PrPhaseRecord {
  id: string;
  gate?: "PASS" | "FAIL";
  review?: "GO" | "NO-GO";
}

/** Machine-readable span marker, invisible in rendered markdown. */
const PR_MARKER = /<!-- gwrk:pr (.*?) -->/;

/**
 * The marker a review agent appends to a task description to record a blocking
 * finding — `REVIEW FAIL (code): …` / `REVIEW FAIL (uat): …`, the format the
 * review PROMPT.md files ask for.
 */
const REVIEW_FAIL_MARKER = "REVIEW FAIL (";

/** How many `REVIEW FAIL (` blocks a description carries. */
function countReviewFailBlocks(description: string | undefined): number {
  if (!description) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = description.indexOf(REVIEW_FAIL_MARKER, from);
    if (at === -1) return count;
    count++;
    from = at + REVIEW_FAIL_MARKER.length;
  }
}

/**
 * What a review dispatch raised, and through which channel it raised it.
 *
 * `revertSourceMutations()` discards everything the agent wrote except
 * tasks.json, so tasks.json holds every channel the agent has. Two exist:
 *
 * - **status flip** (`reopened`) — `completed` → `open`. What the VERDICT
 *   CHANNEL block in the scope context asks for.
 * - **description-only** (`descriptionOnly`) — a `REVIEW FAIL (` block appended
 *   while the status stayed put. What all four missed NO-GOs actually did, and
 *   what a status-only detector reads as silence.
 *
 * The verdict consults `all` and does not care which channel carried it; the
 * split exists so the console line can name the mechanism, since "the agent
 * ignored the prompt" and "the agent followed it" are different bugs.
 */
export interface ReviewFindings {
  /** Tasks the agent moved `completed` → `open` during this dispatch. */
  reopened: Set<string>;
  /**
   * Tasks that gained a `REVIEW FAIL (` block during this dispatch while their
   * status stayed where it was. Disjoint from `reopened`.
   */
  descriptionOnly: Set<string>;
  /** The union of both channels. This is what a verdict reads. */
  all: Set<string>;
}

/** A dispatch that raised nothing — also the shape returned on a read failure. */
function noReviewFindings(): ReviewFindings {
  return {
    reopened: new Set<string>(),
    descriptionOnly: new Set<string>(),
    all: new Set<string>(),
  };
}

/**
 * Errors that are GitHub's problem, not a verdict about the code.
 *
 * Run #2631 finished everything — both reviews, the PR, CI green in 9s — then
 * exited 1 on GitHub's own 502-class GraphQL error. These are worth another
 * attempt; a CI verdict never is, because retrying it doubles the wait and can
 * mask a genuine red.
 */
const TRANSIENT_GH_PATTERNS = [
  /Something went wrong while executing your query/i, // GraphQL 502-class
  /\bHTTP (50[0234])\b/, // 500/502/503/504
  /\b(Bad Gateway|Service Unavailable|Gateway Time-?out)\b/i,
  /secondary rate limit/i,
  /API rate limit exceeded/i,
  /\b(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE)\b/,
  /socket hang up/i,
  /\bserver error\b/i,
];

function isTransientGhError(message: string): boolean {
  return TRANSIENT_GH_PATTERNS.some((re) => re.test(message));
}

/**
 * `gh pr checks` exits 1 with this when the PR has no check runs at all. On a
 * PR created seconds ago that means "not registered yet", not "none exist".
 */
const CHECKS_ABSENT = /\bno checks reported\b/i;

/**
 * `gh pr checks --required` exits 1 with this when the base branch carries no
 * protection rule. A configuration fact, knowable immediately, never a race.
 */
const NO_REQUIRED_CHECKS = /\bno required checks reported\b/i;

/** How many times to re-query before accepting that a PR has no checks. */
const ABSENCE_POLL_ATTEMPTS = 8;

/** Delay between absence re-queries. Eight of these span two minutes. */
const ABSENCE_POLL_MS = 15_000;

/** `phase-04` → `4`. */
function phaseNumOf(phaseId: string): string {
  return phaseId.replace("phase-", "").replace(/^0+/, "") || "0";
}

/**
 * Name the phases a PR carries: `Phase 4`, `Phases 1–4` when contiguous,
 * `Phases 1, 3, 4` when a merge or a skip broke the run.
 */
function prPhaseLabel(phases: PrPhaseRecord[]): string {
  const nums = phases.map((p) => Number(phaseNumOf(p.id))).sort((a, b) => a - b);
  if (nums.length === 1) return `Phase ${nums[0]}`;
  const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  return contiguous
    ? `Phases ${nums[0]}–${nums[nums.length - 1]}`
    : `Phases ${nums.join(", ")}`;
}

/**
 * Recover a span from a PR body written before the marker existed, so
 * upgrading gwrk mid-feature extends that PR instead of restarting its count.
 */
function inferSpanFromBody(body: string): PrPhaseRecord[] {
  const range = body.match(/Phases\s+(\d+)\s*[–-]\s*(\d+)/);
  if (range) {
    const [from, to] = [Number(range[1]), Number(range[2])];
    return Array.from({ length: to - from + 1 }, (_, i) => ({
      id: `phase-${String(from + i).padStart(2, "0")}`,
    }));
  }
  const list = body.match(/Phases\s+([\d,\s]+)/);
  if (list) {
    return list[1]
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => ({ id: `phase-${n.padStart(2, "0")}` }));
  }
  const single = body.match(/Phase\s+(\d+)/);
  return single
    ? [{ id: `phase-${single[1].padStart(2, "0")}` }]
    : [];
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
      //    Gate authority is one-way (ADR-007 + 028 correction): a green gate
      //    closes a task the reviewer raised no finding against, and never a task
      //    it reproduced a defect on.
      //
      //    Advisory is not the same as discarded. Source mutations were just
      //    reverted, so tasks.json is the review agent's only surviving
      //    channel — through either door: a task it moved completed → open, or
      //    a `REVIEW FAIL (` block it appended and left on a completed task.
      //    Compute both before readVerdict, which rewrites the same file.
      const reviewFindings = this.detectReviewReopens(featureDir, beforeState);
      // Record every finding in the append-only ledger BEFORE readVerdict runs.
      // Ordering is load-bearing at both ends: after the revert, so this
      // dispatch's entries cannot be thrown away by it; before readVerdict, so
      // they are on disk even if gate execution later throws.
      this.recordFindings(featureDir, workflowName, reviewFindings);
      const verdict = await this.readVerdict(reviewFindings);
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

  /**
   * Refuse to start work that PR_CI could not push.
   *
   * PR_CI pushes at the very end, so a stale remote branch used to surface only
   * after the implement, code-review and UAT agents had all run — a rejected
   * `git push` discarding ~20 minutes of work. Every input is known now.
   *
   * Behind-only is recoverable and recovered here (fast-forward). Diverged is
   * not: choosing between the two histories is the operator's call, so stop and
   * say exactly what to run.
   *
   * @returns a failing stage result to abort with, or null to continue.
   */
  private ensurePushable(branchName: string): ShipStageResult | null {
    const remoteRef = `refs/remotes/origin/${branchName}`;
    const git = (cmd: string) =>
      execSync(cmd, { cwd: this.config.cwd, encoding: "utf-8" }).trim();

    try {
      // Refresh the remote-tracking ref explicitly; the ambient one may predate
      // another machine's push. A missing remote branch is the normal
      // first-ship case, so a failure here is not fatal.
      try {
        git(
          `git fetch origin +refs/heads/${branchName}:${remoteRef} --quiet`,
        );
      } catch {
        /* no such remote branch, or offline — fall through to the check */
      }

      try {
        git(`git rev-parse --verify --quiet ${remoteRef}`);
      } catch {
        return null; // No remote counterpart: the first push creates it.
      }

      const behind = Number(
        git(`git rev-list --count ${branchName}..origin/${branchName}`) || "0",
      );
      if (behind === 0) return null;

      const ahead = Number(
        git(`git rev-list --count origin/${branchName}..${branchName}`) || "0",
      );

      if (ahead === 0) {
        console.log(
          `  Branch ${branchName} is ${behind} commit(s) behind origin — fast-forwarding`,
        );
        git(`git merge --ff-only origin/${branchName}`);
        return null;
      }

      return {
        success: false,
        exitCode: 1,
        error:
          `Branch ${branchName} has diverged from origin/${branchName} ` +
          `(${ahead} local, ${behind} remote). PR_CI could not push, so the run is stopping ` +
          "now instead of after the agents have run.\n" +
          "  Reconcile first, then re-run:\n" +
          `    git merge origin/${branchName}        # keep both histories\n` +
          `    git push origin --delete ${branchName} # or discard the stale remote branch`,
      };
    } catch (err: unknown) {
      // The check itself failing must not block a ship — PR_CI still guards the
      // push. Say so rather than proceeding silently.
      console.warn(
        `  ⚠ Could not compare ${branchName} with origin: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
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
      const pushable = this.ensurePushable(branchName);
      if (pushable) return pushable;
      this.state.branchName = branchName;
      if (this.state.iteration === 1) await this.captureTestBaseline();
      return { success: true, exitCode: 0 };
    }

    try {
      await createBranch(this.config.cwd, branchName, "develop");
      // A fresh branch off develop plus a stale remote of the same name is
      // exactly the 005 case — check before any agent runs, not at PR_CI.
      const pushable = this.ensurePushable(branchName);
      if (pushable) return pushable;
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
          console.log(`  Branch ${branchName} exists — checked out`);
          const pushable = this.ensurePushable(branchName);
          if (pushable) return pushable;
          this.state.branchName = branchName;
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
    // 026: a fenced Done-When compiles the same gateScript onto every task in a
    // phase — run each distinct gate once.
    const gateCache = new Map<string, TaskGateResult>();
    for (const task of postFlightPhase.tasks) {
      if (task.status !== "completed" || !task.gateScript) continue;

      // 026: one shared runner (convention file → gateScript-as-path → inline
      // `set -e`; hollow/unauthored rejected), identical to `gwrk gate`.
      let result = gateCache.get(task.gateScript);
      if (!result) {
        result = await runTaskGate(task, {
          featureDir,
          cwd: this.config.cwd,
        });
        gateCache.set(task.gateScript, result);
      }
      const gateResult = { passed: result.passed, output: result.output };
      const gateLabel = result.gatePath;

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
        const gateResult = await runGate(gatePath, { cwd: this.config.cwd });
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
  private async stageBuildCheck(): Promise<ShipStageResult> {
    console.log("  ▸ BUILD_CHECK");

    // Resolve the project's build command from its profile/toolchain (ADR-005
    // §11 / 004 FR-022). null = no build toolchain (cold-start Node phase, or an
    // explicit toolchain.build:null) → skip the gate rather than assume pnpm.
    const profile = await detectProfile(this.config.cwd);
    const buildCommand = getBuildCommand(profile, this.config.cwd);
    if (!buildCommand) {
      console.log("  ✓ build skipped (no build toolchain)");
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

    // ADR-005 §10.4 — a phase's integration Done-When targets (e.g. `make
    // test:auth`) run here under liveness, before the file-mapped suite.
    const integrationNoGo = await this.runIntegrationGate();
    if (integrationNoGo) return integrationNoGo;

    const phaseTestFiles = await this.getPhaseTestFiles();

    // ADR-005 §10.2.1 — Liveness: when a phase maps to test files, those tests
    // MUST actually execute and pass. A suite that discovered nothing or whose
    // tests all cancelled (testsRun === 0) is a FAIL, never "no regression".
    if (phaseTestFiles.length > 0) {
      console.log(`    scoped to: ${phaseTestFiles.join(", ")}`);
      const r = await this.runTestSuite(phaseTestFiles);
      if (r.skipped) {
        console.log("  ✓ tests skipped (no test toolchain)");
        return { success: true, exitCode: 0, nextStage: ShipStage.CODE_REVIEW };
      }
      if (r.testsRun === 0) {
        // The profile runner found no tests. Before NO-Going on liveness, check
        // whether the phase has an authored Done-When gate. A phase can map a
        // test file whose real runner is NOT the profile default — e.g. a
        // node:test suite run in Docker via `make test:db`, which `pnpm vitest
        // run` reports as 0 tests. The gate carries the correct runner, so run
        // it (parity with `gwrk gate`) rather than false-NO-Going a green phase.
        // If there is no authored gate, 0 tests is a genuine liveness fail.
        const phaseGate = this.getPhaseGate();
        if (phaseGate) {
          const gate = this.runGateScript(phaseGate);
          if (gate.passed) {
            console.log(
              `  ✓ TEST_GATE: Done-When gate passed (${this.config.phaseId}) — profile runner found 0 tests; verified via the phase gate`,
            );
            return { success: true, exitCode: 0, nextStage: ShipStage.CODE_REVIEW };
          }
          console.log(
            `  ✗ TEST_GATE: Done-When gate failed for ${this.config.phaseId} ('${gate.offendingLine}')`,
          );
          return this.handleNoGo("TEST_GATE");
        }
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

    // 025 Fix B (FR-004) — a test-less phase is a gate-only phase (schema /
    // migration / config): its verification IS its Done-When gate, not a test
    // runner. The canonical `#### Done When` fenced block compiles onto
    // task.gateScript (NOT phase.doneWhen, which is empty for the fenced form),
    // so read the phase's real gate from the compiled task state. Run it under
    // `set -e` (gate.ts:276 shape) and pass iff exit 0 — an honest verification
    // that replaces the weak no-regression baseline for gate-only phases.
    // Liveness (testsRun > 0) is NOT applied: a config gate asserts by exit code,
    // not test count. A test-less phase with NO real gate keeps the baseline pass
    // below (strengthen, never weaken).
    const phaseGate = this.getPhaseGate();
    if (phaseGate) {
      const gate = this.runGateScript(phaseGate);
      if (gate.passed) {
        console.log(`  ✓ TEST_GATE: Done-When gate passed (${this.config.phaseId})`);
        return { success: true, exitCode: 0, nextStage: ShipStage.CODE_REVIEW };
      }
      console.log(
        `  ✗ TEST_GATE: Done-When gate failed for ${this.config.phaseId} ('${gate.offendingLine}')`,
      );
      return this.handleNoGo("TEST_GATE");
    }

    const wholeSuite = await this.runTestSuite(phaseTestFiles);
    if (wholeSuite.skipped) {
      console.log("  ✓ tests skipped (no test toolchain)");
      return { success: true, exitCode: 0, nextStage: ShipStage.CODE_REVIEW };
    }
    const { failCount, output } = wholeSuite;
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

  /**
   * Run a phase's integration Done-When targets (e.g. `make test:auth`) as
   * executional gates under liveness (ADR-005 §10.4). A target that fails or
   * executes 0 tests is a NO-GO — an opaque wrapper that hides its structured
   * counts honest-fails rather than false-passing. Returns null when there are
   * no such targets or all pass.
   */
  private async runIntegrationGate(): Promise<ShipStageResult | null> {
    let doneWhen: string[] = [];
    try {
      const featureDir = path.join(this.config.cwd, "specs", this.config.featureId);
      const taskState = loadTaskState(featureDir);
      const phase = taskState.phases.find((p: Phase) => p.id === this.config.phaseId);
      doneWhen = phase?.doneWhen ?? [];
    } catch {
      return null;
    }
    const commands = doneWhen.filter(isIntegrationTestCommand);
    if (commands.length === 0) return null;

    for (const cmd of commands) {
      console.log(`    integration: ${cmd}`);
      let output: string;
      try {
        output = execSync(cmd, {
          cwd: this.config.cwd,
          stdio: "pipe",
          timeout: 300_000,
        }).toString();
      } catch (err: unknown) {
        const e = err as { stdout?: Buffer; stderr?: Buffer };
        output = `${e.stdout?.toString() ?? ""}\n${e.stderr?.toString() ?? ""}`.trim();
      }
      const { testsRun, passed, failed } = parseTestOutput(output);
      if (testsRun === 0) {
        console.log(
          `  ✗ TEST_GATE: integration target ran 0 tests (\`${cmd}\`) — liveness fail (ADR-005 §10.2.1)`,
        );
        return this.handleNoGo("TEST_GATE");
      }
      if (failed > 0) {
        console.log(
          `  ✗ TEST_GATE: ${failed} failing in integration target \`${cmd}\` (${testsRun} ran)`,
        );
        return this.handleNoGo("TEST_GATE");
      }
      console.log(`  ✓ integration: ${cmd} — ${passed} passed (${testsRun} ran)`);
    }
    return null;
  }

  /** The current phase's executable verification gate, or null (see
   * {@link getPhaseVerificationGate}). Reads the compiled task state: the real
   * gate lives in task.gateScript (the fenced `#### Done When`), with a fallback
   * to prose-bullet phase.doneWhen. Null on any load failure. */
  private getPhaseGate(): string | null {
    try {
      const featureDir = path.join(this.config.cwd, "specs", this.config.featureId);
      const taskState = loadTaskState(featureDir);
      const phase = taskState.phases.find((p: Phase) => p.id === this.config.phaseId);
      return phase ? getPhaseVerificationGate(phase) : null;
    } catch {
      return null;
    }
  }

  /**
   * 025 Fix B — run a test-less phase's gate as one `set -e` script (the same
   * execution shape as `gate.ts:276`; the script is already multi-line, so
   * inter-line shell state like `cd` is preserved). Passes iff it exits 0. On
   * failure, names the offending line so a NO-GO reads as navigation (ADR-004).
   */
  private runGateScript(script: string): {
    passed: boolean;
    offendingLine: string;
    output: string;
  } {
    // 026: delegate to the one shared inline executor (gate-exec) so TEST_GATE's
    // phase-gate path runs a gate identically to `gwrk gate`, post-flight, and
    // harvest.
    const r = runInlineGate(script, this.config.cwd);
    return {
      passed: r.passed,
      offendingLine: r.offendingLine ?? "",
      output: r.output,
    };
  }

  /** Run test suite, return failure count and output.
   *  When phaseTestFiles are available, runs only those files instead of
   *  the full suite. This prevents cross-phase RED test contamination.
   */
  private async runTestSuite(
    phaseTestFiles?: string[],
  ): Promise<{ failCount: number; testsRun: number; passed: number; output: string; skipped?: boolean }> {
    const profile = await detectProfile(this.config.cwd);

    // Resolve the profile's test command. `null` = project declares no test
    // toolchain → skip (ADR-005 §11); the TEST_GATE stage turns this into a
    // GO-with-message rather than a testsRun==0 failure (Phase 05).
    const scoped = phaseTestFiles && phaseTestFiles.length > 0;
    const resolved = scoped
      ? getTestCommand(profile, phaseTestFiles)
      : getTestCommand(profile, []);
    if (resolved === null) {
      return { failCount: 0, testsRun: 0, passed: 0, output: "(no test toolchain — skipped)", skipped: true };
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
        declaredTargets: phase.testTargets ?? [],
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
      `SCOPE CONSTRAINT: Only evaluate code changes made for THIS phase's tasks (${this.config.phaseId}).`,
      "Do NOT touch tasks belonging to any OTHER phase — not their status, not their descriptions.",
      "For a task in an earlier phase with issues: note it in your summary only, and leave its status alone.",
      "",
      // The verdict channel, stated where the agent cannot miss it. This block is
      // appended after PROMPT.md, so it is the last thing the agent reads — which is
      // why its predecessor ("note them in your summary but do NOT change its
      // status", unqualified by phase) silently disabled code review as a gate.
      // Every task in the current phase is `completed` by the time review runs, so
      // that sentence read as "never re-open anything" and four blocking findings
      // across runs #2727/#2728 were written down, committed, and discarded.
      `VERDICT CHANNEL: when you find a blocking defect in a task of THIS phase (${this.config.phaseId}),`,
      'set that task\'s status to "open" in tasks.json and append a REVIEW FAIL note.',
      "That status flip IS your NO-GO. The orchestrator reads it — not your prose, not your commit",
      "subject, not the verdict field of your JSON. A finding left on a completed task is discarded and",
      "the phase advances to UAT as if you had approved it.",
      "This holds even when the task's gate passes: a green gate over a defect you reproduced is a gate",
      "coverage hole, and re-opening the task is how you report it.",
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
   * Findings the review agent registered during this run, by channel.
   *
   * `revertSourceMutations()` throws away everything the agent wrote except
   * tasks.json, so tasks.json is where a review agent registers a defect. Two
   * channels are read, and both are diffed against the pre-dispatch snapshot
   * rather than trusting the current file alone:
   *
   * - a task moved `completed` → `open` (a task already open before review
   *   carries no verdict — nobody may have implemented it yet);
   * - a `REVIEW FAIL (` block newly appended to a task's description (one
   *   already on disk belongs to an earlier iteration and must not re-fire).
   *
   * The description diff is **count-based, not presence-based**. Presence would
   * re-fire on the earlier iteration's block forever; a count also fires
   * correctly when a second finding lands on a description that already carried
   * one, which is the ordinary shape of iteration 2 of a NO-GO loop.
   */
  private detectReviewReopens(
    featureDir: string,
    beforeState: { phases: Phase[] },
  ): ReviewFindings {
    try {
      const after = loadTaskState(featureDir);
      const before = beforeState.phases.find(
        (p: Phase) => p.id === this.config.phaseId,
      );
      const now = after.phases.find(
        (p: Phase) => p.id === this.config.phaseId,
      );
      if (!before || !now) return noReviewFindings();

      const wasById = new Map<string, Task>(
        before.tasks.map((t: Task) => [t.id, t] as [string, Task]),
      );

      const findings = noReviewFindings();
      for (const task of now.tasks) {
        const was = wasById.get(task.id);
        if (task.status === "open" && was?.status === "completed") {
          findings.reopened.add(task.id);
        } else if (
          countReviewFailBlocks(task.description) >
          countReviewFailBlocks(was?.description)
        ) {
          // The agent wrote the defect down and left the status alone — the
          // exact shape of the four findings that reached GO anyway.
          findings.descriptionOnly.add(task.id);
        }
      }
      findings.all = new Set([
        ...findings.reopened,
        ...findings.descriptionOnly,
      ]);
      return findings;
    } catch {
      // An unreadable tasks.json is readVerdict's problem to report, not ours.
      return noReviewFindings();
    }
  }

  /**
   * Write every finding this dispatch raised into the append-only ledger.
   *
   * tasks.json is the channel the agent has; it is not a store of record. Its
   * `description` is rewritten wholesale by every later agent, and twice that
   * rewrite deleted a live finding outright (`48c3ea6`, `5b29881`). The ledger
   * is the copy that a later rewrite cannot reach — see
   * {@link appendFinding}.
   *
   * `text` is the description as it stands after the dispatch, which is where
   * the agent's own `REVIEW FAIL (` block lives. A status-flip finding on a
   * task with an empty description gets a synthesised line instead: an empty
   * `text` fails `FindingSchema`, and refusing to record a real finding because
   * the agent left the description blank would be the exact silence this
   * feature exists to remove.
   */
  private recordFindings(
    featureDir: string,
    workflowName: string,
    findings: ReviewFindings,
  ): void {
    if (findings.all.size === 0) return;

    const taskState = loadTaskState(featureDir);
    const phase = taskState.phases.find(
      (p: Phase) => p.id === this.config.phaseId,
    );
    const byId = new Map<string, Task>(
      (phase?.tasks ?? []).map((t: Task) => [t.id, t] as [string, Task]),
    );
    const stage = workflowName.includes("uat") ? "uat-review" : "code-review";
    const recordedAt = new Date().toISOString();

    for (const taskId of findings.all) {
      const description = byId.get(taskId)?.description?.trim();
      appendFinding(featureDir, {
        taskId,
        phaseId: this.config.phaseId,
        stage,
        text:
          description ||
          `REVIEW FINDING (${taskId}): raised by ${workflowName} with no description recorded.`,
        recordedAt,
      });
    }
  }

  /**
   * Read the verdict from task state after a review dispatch.
   *
   * NOT "any open task → NO-GO", which this comment used to claim and the code
   * has never done — a task can be open because nobody has implemented it yet.
   * The verdict comes from what this run can establish: each task's gate, and
   * the tasks the review agent re-opened. NO-GO if a gate fails, if a re-opened
   * task's gate passes anyway (a coverage hole), or if a re-opened task has no
   * gate at all. Otherwise GO.
   *
   * "Re-opened" is read through {@link ReviewFindings}, which carries both
   * channels a review agent has: the status flip the prompt asks for, and a
   * `REVIEW FAIL (` block appended to a description with the status left alone.
   * Every branch below consults `findings.all`; the `reopened`/`descriptionOnly`
   * split only decides which mechanism the console line names.
   */
  private async readVerdict(
    findings: ReviewFindings = noReviewFindings(),
  ): Promise<"GO" | "NO-GO"> {
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

    if (findings.descriptionOnly.size > 0) {
      console.log(
        `    ⚠ ${findings.descriptionOnly.size} finding(s) arrived as a REVIEW FAIL block with the task status left unchanged: ${[...findings.descriptionOnly].join(", ")}`,
      );
    }

    // Gate-driven verdict: run gates directly, don't trust agent edits.
    // Gate authority is one-way — see the "one-way" callout in
    // src/plugins/builtins/reviews/review-code-{cli,webapp}/PROMPT.md Step 2.
    // (The old citation here, "gates are truth, tasks.json status is bookkeeping",
    // was the doctrine that let a green gate close a reproduced defect.)
    // 026: run each task's gate through the shared runner. An INLINE gateScript
    // now actually executes — previously it was `join`ed to a path that never
    // exists and skipped, so the verdict was a vacuous GO for every real phase.
    // A shared phase gate runs once.
    let failedCount = 0;
    const divergentTasks: string[] = [];
    const ungatedFindings: string[] = [];
    const gateCache = new Map<string, TaskGateResult>();
    for (const task of phase.tasks) {
      // Read before anything can `continue` past it. The gateless skip below
      // used to sit ABOVE this read, so a finding on a task with no gate — the
      // one case where review is the only verdict there will ever be — fell
      // into a vacuous GO.
      const hasFinding = findings.all.has(task.id);
      const mechanism = findings.descriptionOnly.has(task.id)
        ? "REVIEW FAIL block appended, status left unchanged"
        : "re-opened by review";

      if (!task.gateScript) {
        // No gate means no mechanical baseline, so the reviewer's judgement is
        // the only verdict this task will ever get. Skipping the task outright
        // — as this loop used to — threw that judgement away and returned a
        // vacuous GO. Common whenever a phase expresses Done-When as fenced
        // prose instead of per-task gates.
        if (hasFinding) {
          console.log(
            `    ⚠ REVIEW FINDING: ${task.id} — ${mechanism}, and no gate covers it`,
          );
          ungatedFindings.push(task.id);
          // Materialise the finding as a status the rest of the loop can see:
          // DIAGNOSE only collects error context from OPEN tasks, so a
          // description-only finding left `completed` would be a NO-GO whose
          // cause the next stage never reads.
          task.status = "open";
          task.completedAt = undefined;
          task.description =
            `${task.description || ""}\n\nREVIEW FINDING (${task.id}, no gate, ${mechanism}):\nThe review agent raised a finding on this task and it has no gateScript, so nothing mechanical can confirm or refute the finding. Read the REVIEW FAIL note above, fix it, and add a gate that would catch it before completing.`.trim();
        }
        continue;
      }

      let gateResult = gateCache.get(task.gateScript);
      if (!gateResult) {
        gateResult = await runTaskGate(task, {
          featureDir,
          cwd: this.config.cwd,
        });
        gateCache.set(task.gateScript, gateResult);
      }
      if (gateResult.passed) {
        if (hasFinding) {
          // Green gate over a defect the reviewer reproduced. Completing the
          // task here is exactly what shipped 005 Phase 1 with a live bug while
          // the console read GO. Keep the finding: a passing gate covering a
          // review finding means the GATE has a coverage hole, and this is the
          // only moment the system can know that.
          console.log(
            `    ⚠ REVIEW/GATE DIVERGENCE: ${task.id} — gate PASSES but review raised a finding (${mechanism})`,
          );
          divergentTasks.push(task.id);
          // Same reason as the gateless branch: the finding has to be visible
          // to DIAGNOSE, and a green gate must never close a task a reviewer
          // reproduced a defect on (ADR-007, one-way).
          task.status = "open";
          task.completedAt = undefined;
          task.description = `${task.description || ""}\n\nREVIEW/GATE DIVERGENCE (${task.id}, gate: ${task.gateScript}, ${mechanism}):\nThe review agent raised a finding on this task and its gate still passes, so the gate does not cover what review found. Add a test that fails on it, then fix, before completing.`.trim();
        } else if (task.status !== "completed") {
          task.status = "completed";
          task.completedAt = new Date().toISOString();
        }
      } else {
        console.log(`    ⚠ Gate FAILED: ${task.id} (${gateResult.gatePath})`);
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

    if (divergentTasks.length > 0) {
      this.state.reviewGateDivergence = divergentTasks;
      console.log(
        `    ✗ ${divergentTasks.length} task(s) pass their gate but carry a review finding: ${divergentTasks.join(", ")}`,
      );
      console.log(
        "      Treating as NO-GO. A green gate over a review finding is a gate coverage hole, not a cleared finding.",
      );
      return "NO-GO";
    }

    if (ungatedFindings.length > 0) {
      console.log(
        `    ✗ ${ungatedFindings.length} task(s) carry a review finding with no gate to check them: ${ungatedFindings.join(", ")}`,
      );
      console.log(
        "      Treating as NO-GO. An ungated task's review IS its verdict — there is nothing else to consult.",
      );
      return "NO-GO";
    }

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
    const ledgerPath = findingsPath(featureDir);

    // Snapshot tasks.json — this carries the review verdict and must be preserved
    let tasksJsonContent: string | null = null;
    try {
      tasksJsonContent = fs.readFileSync(tasksJsonPath, "utf-8");
    } catch {
      // No tasks.json to preserve — proceed with full restore
    }

    // Snapshot the findings ledger for the same reason, through the same
    // mechanism. `.gwrk/findings.jsonl` is not git-ignored, so while untracked
    // it is precisely what the `git clean -fd` below deletes — and the entries
    // at risk are EARLIER iterations', already on disk when this dispatch
    // reverts. Losing them would reintroduce D3 through a different door.
    let ledgerContent: string | null = null;
    try {
      ledgerContent = fs.readFileSync(ledgerPath, "utf-8");
    } catch {
      // No ledger yet — nothing recorded on this feature so far
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

    // Restore the ledger. `git clean -fd` can take the whole `.gwrk/` directory
    // when nothing tracked remains in it, so recreate the parent before writing.
    if (ledgerContent) {
      fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
      fs.writeFileSync(ledgerPath, ledgerContent, "utf-8");
    }
  }

  /**
   * Render the PR body for every phase the PR carries, and append the span
   * marker the next phase reads back.
   *
   * Task checkboxes come from tasks.json, and each phase reports the verdicts
   * actually recorded for it — a phase recovered from a pre-marker PR says so
   * rather than borrowing this phase's GO.
   */
  private buildPrBody(
    title: string,
    carried: PrPhaseRecord[],
    taskState: { phases: Phase[] },
  ): string {
    const sections = carried
      .map((rec) => {
        const phase = taskState.phases.find((p: Phase) => p.id === rec.id);
        const tasks =
          phase?.tasks
            .map(
              (t: Task) =>
                `- [${t.status === "completed" ? "x" : " "}] ${t.title}`,
            )
            .join("\n") || "- See tasks.json for task list";
        const heading = phase?.title
          ? `### Phase ${phaseNumOf(rec.id)} — ${phase.title}`
          : `### Phase ${phaseNumOf(rec.id)}`;
        return `${heading}\n${tasks}\n\nGates: ${rec.gate ?? "not recorded"} · Review: ${rec.review ?? "not recorded"}`;
      })
      .join("\n\n");

    const preamble =
      carried.length > 1
        ? `Shipped by one \`gwrk ship\` run. Each phase below landed on this branch in sequence; this PR carries all ${carried.length}.`
        : "Shipped by `gwrk ship`.";

    const marker = `<!-- gwrk:pr ${JSON.stringify({ phases: carried })} -->`;

    return `## ${title}

${preamble}

${sections}

---
_Generated by gwrk ship_
${marker}`;
  }

  /** Overridable in tests so the backoff does not slow the suite. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Run a `gh pr checks` query, retrying only GitHub's own transient failures.
   *
   * Backoff is short because the caller is `--watch`, which already blocks for
   * minutes; the point is to survive a blip, not to wait out an outage.
   */
  private async checksWithRetry(
    prNumber: string,
    required: boolean,
  ): Promise<string> {
    const delays = [3000, 10000, 30000];
    let attempt = 0;

    for (;;) {
      try {
        return execSync(
          `gh pr checks "${prNumber}" --watch${required ? " --required" : ""} --interval 30`,
          {
            cwd: this.config.cwd,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isTransientGhError(msg) || attempt >= delays.length) throw err;
        const wait = delays[attempt];
        attempt++;
        console.log(
          `    ⚠ GitHub returned a transient error — retrying in ${wait / 1000}s (${attempt}/${delays.length})`,
        );
        await this.sleep(wait);
      }
    }
  }

  /**
   * Block until the PR's CI is green, distinguishing three failures `gh pr
   * checks` reports through the same exit code:
   *
   *   absence      no check runs exist yet        → re-query
   *   none required  base branch is unprotected   → wait on ALL checks
   *   red          a check reported failure       → throw
   *
   *   required → absent? → re-query → none required? → ALL → none at all? → skip
   *
   * Absence is a race, not a verdict. PR_CI queries seconds after creating the
   * PR, before GitHub has registered the first run, and `--watch` exits rather
   * than waiting for one to appear. Only the last rung skips, and it says so.
   *
   * Widening a guard to treat absence as skippable would be worse than failing:
   * gwrk would green-light every PR whose checks are slow to register, which is
   * the vacuous-green class 026/027 exist to close.
   */
  private async waitForChecks(prNumber: string): Promise<void> {
    const check = (required: boolean) => this.checksWithRetry(prNumber, required);

    for (let attempt = 1; ; attempt++) {
      try {
        await withSpinnerAsync("waiting for required CI", () => check(true));
        return;
      } catch (requiredErr: unknown) {
        const msg =
          requiredErr instanceof Error
            ? requiredErr.message
            : String(requiredErr);

        if (NO_REQUIRED_CHECKS.test(msg)) {
          console.log(
            "    No required checks on the base branch — waiting on all checks instead.",
          );
          console.log(
            "      (Add branch protection to make the required-check gate meaningful.)",
          );
          break;
        }

        // Anything else that is not absence is a real verdict.
        if (!CHECKS_ABSENT.test(msg)) throw requiredErr;

        if (attempt >= ABSENCE_POLL_ATTEMPTS) {
          console.log(
            `    Still no check runs after ${attempt} queries — waiting on all checks instead.`,
          );
          break;
        }

        console.log(
          `    No check runs registered yet — re-querying in ${ABSENCE_POLL_MS / 1000}s (${attempt}/${ABSENCE_POLL_ATTEMPTS}).`,
        );
        await this.sleep(ABSENCE_POLL_MS);
      }
    }

    try {
      await withSpinnerAsync("waiting for CI", () => check(false));
    } catch (anyErr: unknown) {
      const msg = anyErr instanceof Error ? anyErr.message : String(anyErr);
      if (CHECKS_ABSENT.test(msg)) {
        console.log("  No CI checks configured — skipping CI wait.");
        return;
      }
      throw anyErr; // Re-throw real CI failures
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

      // ── PR identity ──
      // `gwrk ship <feature>` ships every open phase on one branch (FR-013)
      // and runs PR_CI per phase, so phases 2..N land on the PR phase 1 opened.
      // The contract scopes the PR to the RUN (contracts/pr.md), so reusing it
      // is right — but its title and body must name every phase it carries,
      // not just whichever phase created it.
      //
      // The span lives in a body marker rather than ShipState: state is
      // per-phase (.runs/<feature>_<phase>.state) and cannot cross phases, and
      // reading it back off the PR also survives crash-resume and the
      // re-minting that follows a mid-feature merge closing the previous PR.
      const featureDir = path.join(
        this.config.cwd,
        "specs",
        this.config.featureId,
      );
      const taskState = loadTaskState(featureDir);
      const formattedSpec = specName.replace(/^\d+-/, "");

      // PR_CI is only reached once the gate passed and both reviews returned
      // GO, and both fields are overwritten on every attempt — so these are
      // this phase's real, current verdicts.
      const thisPhase: PrPhaseRecord = {
        id: this.config.phaseId,
        gate: this.state.gateResult ?? "PASS",
        review: this.state.reviewVerdict ?? "GO",
      };

      let carried: PrPhaseRecord[] = [];
      if (prNumber) {
        let existingBody = "";
        try {
          existingBody = execSync(
            `gh pr view ${prNumber} --json body --jq '.body'`,
            { cwd: this.config.cwd, encoding: "utf-8" },
          ).trim();
        } catch {
          /* best-effort — an unreadable body just restarts the span */
        }
        const marker = existingBody.match(PR_MARKER);
        if (marker) {
          try {
            carried = JSON.parse(marker[1]).phases ?? [];
          } catch {
            /* corrupt marker — fall back to the title */
          }
        }
        if (carried.length === 0) carried = inferSpanFromBody(existingBody);
      }
      // Re-shipping a phase updates its record rather than double-listing it.
      carried = carried.filter((p) => p.id !== thisPhase.id);
      carried.push(thisPhase);
      carried.sort((a, b) => Number(phaseNumOf(a.id)) - Number(phaseNumOf(b.id)));

      const prTitle = `feat(${formattedSpec}): ${prPhaseLabel(carried)}`;
      const prBody = this.buildPrBody(prTitle, carried, taskState);
      const prBodyPath = path.join("/tmp", `gwrk-pr-body-${Date.now()}.md`);
      fs.writeFileSync(prBodyPath, prBody, "utf-8");

      if (prNumber) {
        // Keep the PR honest about its contents as each phase lands.
        try {
          withSpinner(`updating PR #${prNumber} → ${prPhaseLabel(carried)}`, () =>
            execSync(
              `gh pr edit ${prNumber} --title "${prTitle}" --body-file "${prBodyPath}"`,
              { cwd: this.config.cwd, encoding: "utf-8" },
            ),
          );
        } catch (editErr: unknown) {
          // A stale title is not worth failing a green phase over.
          const editMsg =
            editErr instanceof Error ? editErr.message : String(editErr);
          console.warn(`    ⚠ Could not update PR #${prNumber}: ${editMsg}`);
        }
      }

      if (!prNumber) {
        let createOutput: string;
        try {
          createOutput = withSpinner("creating PR", () =>
            execSync(
              `gh pr create --title "${prTitle}" --body-file "${prBodyPath}" --base develop`,
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
        await this.waitForChecks(prNumber);
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
      "4. After ALL changes, run the project's build and fix any compilation errors (BUILD_CHECK enforces this).",
      "5. Run the project's test command on the relevant test files to verify your changes (TEST_GATE enforces this).",
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
        // Review findings count as context too. On the review path BUILD_CHECK
        // and TEST_GATE have both passed — that is the entire point of the
        // divergence warning — so matching only build/test failures meant
        // DIAGNOSE printed "no error context" on every review-driven NO-GO and
        // spent a stage contributing nothing.
        const errorMatch = task.description.match(
          /(?:BUILD_CHECK FAILED|TEST_GATE REGRESSION|POST-FLIGHT GATE FAIL|REVIEW\/GATE DIVERGENCE|REVIEW FINDING|REVIEW FAIL)[\s\S]*$/,
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

    // A review-driven NO-GO reaches here with the build green — the finding is
    // something no gate covers. Say so, or the diagnostician looks for compiler
    // errors that do not exist and returns nothing.
    const reviewDriven = errorContext.some((c) =>
      /REVIEW\/GATE DIVERGENCE|REVIEW FINDING|REVIEW FAIL/.test(c),
    );

    // Build the diagnosis prompt — concise, targeted, no agent narration
    const diagnosisPrompt = [
      "You are a build and code-review diagnostician. Analyze the findings below and produce SPECIFIC fix instructions.",
      "",
      "## Current Build/Test Errors",
      currentErrors || "(build passes — the findings below are what failed)",
      "",
      reviewDriven ? "## Review Findings (build and gates are GREEN)" : "## Error Context from Failed Gates",
      ...(reviewDriven
        ? [
            "A reviewer reproduced these defects while every gate passed, so no gate covers them.",
            "Each FIX must repair the defect the reviewer named. Where a gate or test would have caught",
            "it, add one — a finding that survives its own fix is a finding that will recur.",
            "",
          ]
        : []),
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
   * Dispatch with the Router-selected model when provided; otherwise the backend
   * runs with its own default model.
   */
  private async dispatchWithFailback(task: TaskDispatch): Promise<TaskResult> {
    const env: Record<string, string> = { ...task.env };
    const model = this.config.selectedModel;

    // 1. Use Router-selected model if available (FR-008/009)
    if (model) {
      if (this.config.backend === "claude") env.CLAUDE_MODEL = model;
      if (this.config.backend === "codex") env.CODEX_MODEL = model;
      console.log(`    🤖 Router model: ${model}`);
    }

    // 2. Dispatch — run the agent in the ship working tree (cwd), not
    // process.cwd(). Identical for the primary checkout; under worktree-isolated
    // shipping this points the agent at the per-feature worktree.
    const workDir = task.workDir ?? this.config.cwd;
    const result = await dispatchToAgent({ ...task, model, env, workDir });

    return result;
  }
}
