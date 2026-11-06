/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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

export interface IterationTimelineEntry {
  iteration: number;
  stage: ShipStage;
  verdict: "GO" | "NO-GO";
  durationS: number;
}

export interface FailureContext {
  openTasks: string[];
  lastVerdict?: string;
  iterationTimeline: IterationTimelineEntry[];
  digest: string[];
}

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
  fullSuiteBaseline?: number;
  prNumber?: number;
  prUrl?: string;
  gateResult?: "PASS" | "FAIL";
  reviewVerdict?: "GO" | "NO-GO";
  reviewGateDivergence?: string[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  };
}

export interface ShipRunConfig {
  featureId: string;
  phaseId: string;
  backend: string;
  maxIterations: number;
  ciTimeout: number;
  cwd: string;
  stateRoot?: string;
  branchName?: string;
  dryRun?: boolean;
  selectedModel?: string;
  selectedCommand?: string;
}

export type ShipStageResult = {
  success: boolean;
  exitCode: number;
  error?: string;
  nextStage?: ShipStage;
};
