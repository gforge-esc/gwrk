/**
 * Define Loop Stage Definitions (FR-L25-004)
 */
export enum DefineStage {
  SPECIFY = "SPECIFY",
  PLAN = "PLAN",
  PLAN_TO_TASKS = "PLAN_TO_TASKS",
  ANALYZE = "ANALYZE",
  DEFINE_TESTS = "DEFINE_TESTS",
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
