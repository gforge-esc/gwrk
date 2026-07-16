/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ship Loop Stage Definitions (FR-004)
 */
export enum ShipStage {
  BRANCH_SETUP = "BRANCH_SETUP",
  ACTIVATE_TESTS = "ACTIVATE_TESTS",
  IMPLEMENT = "IMPLEMENT",
  BUILD_CHECK = "BUILD_CHECK",
  TEST_GATE = "TEST_GATE",
  DIAGNOSE = "DIAGNOSE",
  CODE_REVIEW = "CODE_REVIEW",
  UAT_REVIEW = "UAT_REVIEW",
  PR_CI = "PR_CI",
  CIRCUIT_BREAK = "CIRCUIT_BREAK",
  DONE = "DONE",
}

/**
 * Iteration history entry for circuit breaker diagnostics (DM-001)
 */
interface IterationTimelineEntry {
  iteration: number;
  stage: ShipStage;
  verdict: "GO" | "NO-GO";
  durationS: number;
}

/**
 * Structured failure context for rip-cord bail (FR-018, DM-001)
 */
interface FailureContext {
  openTasks: string[];
  lastVerdict?: string;
  iterationTimeline: IterationTimelineEntry[];
  digest: string[];
}

/**
 * Machine-local crash recovery state (DM-001)
 * Persisted to .runs/<feature>_p<phase>.state
 */
export interface ShipState {
  stage: ShipStage;
  iteration: number;
  featureId: string;
  phaseId: string;
  startedAt: string;
  runId: string;
  backend: string;
  failureContext: FailureContext | null;
  branchName?: string;
  testBaseline?: number;
  prNumber?: number;
  prUrl?: string;
  gateResult?: "PASS" | "FAIL";
  reviewVerdict?: "GO" | "NO-GO";
}

/**
 * Orchestrator Runtime Configuration
 */
export interface ShipRunConfig {
  featureId: string;
  phaseId: string;
  backend: string;
  maxIterations: number;
  ciTimeout: number; // minutes
  /**
   * The working tree for all git/build/test ops AND agent execution. Today
   * this is the primary checkout (process.cwd()); under worktree-isolated
   * shipping it is the per-feature worktree path.
   */
  cwd: string;
  /**
   * Where crash-recovery state (`.runs/<feature>_<phase>.state`) is persisted.
   * Defaults to `cwd`. A worktree ship points this at the primary checkout so
   * resume survives worktree teardown. Never inside an ephemeral worktree.
   */
  stateRoot?: string;
  /**
   * Branch to ship on. Defaults to `feat/<featureId>`. Parameterized so a
   * worktree/parallel run can use a per-feature-phase branch.
   */
  branchName?: string;
  dryRun?: boolean;
  selectedModel?: string;
  selectedCommand?: string;
  geminiModel?: string;
  geminiFailbackModels?: string[];
}

/**
 * Result of an individual stage execution
 */
export type ShipStageResult = {
  success: boolean;
  exitCode: number;
  error?: string;
  nextStage?: ShipStage;
};
