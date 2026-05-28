/**
 * Ship Loop Stage Definitions (FR-004)
 */
export enum ShipStage {
  BRANCH_SETUP = "BRANCH_SETUP",
  IMPLEMENT = "IMPLEMENT",
  BUILD_CHECK = "BUILD_CHECK",
  TEST_GATE = "TEST_GATE",
  CODE_REVIEW = "CODE_REVIEW",
  UAT_REVIEW = "UAT_REVIEW",
  PR_CI = "PR_CI",
  CIRCUIT_BREAK = "CIRCUIT_BREAK",
  DONE = "DONE",
}

/**
 * Iteration history entry for circuit breaker diagnostics (DM-001)
 */
export interface IterationTimelineEntry {
  iteration: number;
  stage: ShipStage;
  verdict: "GO" | "NO-GO";
  durationS: number;
}

/**
 * Structured failure context for rip-cord bail (FR-018, DM-001)
 */
export interface FailureContext {
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
  testBaseline?: number; // Pre-existing test failure count (captured at BRANCH_SETUP)
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
  cwd: string;
  dryRun?: boolean;
  selectedModel?: string;
  selectedCommand?: string;
  geminiModel?: string;
  geminiFailbackModels?: string[];
}

/**
 * Result of an individual stage execution
 */
export type StageResult = {
  success: boolean;
  exitCode: number;
  error?: string;
  nextStage?: ShipStage;
};
