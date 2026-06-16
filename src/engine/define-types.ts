/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Define Loop Stage Definitions (FR-L25-004)
 */
export enum DefineStage {
  SPECIFY = "SPECIFY",
  PLAN = "PLAN",
  DEFINE_TESTS = "DEFINE_TESTS",
  PLAN_TO_TASKS = "PLAN_TO_TASKS",
  ANALYZE = "ANALYZE",
  DONE = "DONE",
}

/**
 * Machine-local crash recovery state
 * Persisted to .runs/<feature>_define.state
 */
export interface DefineState {
  stage: DefineStage;
  featureId: string;
  startedAt: string;
  runId: string;
  backend: string;
  refs?: string;
}

/**
 * Orchestrator Runtime Configuration
 */
export interface DefineRunConfig {
  featureId: string;
  backend: string;
  /** Resolved model name from tier-aware selection (e.g. "gemini-3.1-pro-preview") */
  model?: string;
  cwd: string;
  refs?: string;
  dryRun?: boolean;
}

/**
 * Result of an individual stage execution
 */
export type StageResult = {
  success: boolean;
  exitCode: number;
  error?: string;
  nextStage?: DefineStage;
};
