# Contract: ShipOrchestrator

**Status**: PROPOSED
**Version**: 1.0.0
**Spec**: [spec.md](../spec.md)

## Interface: `ShipOrchestrator`

The `ShipOrchestrator` is the TypeScript state machine responsible for the ship loop lifecycle.

### Types

```typescript
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

export interface ShipRunConfig {
  featureId: string;
  phaseId: string;
  backend: string;
  maxIterations: number;
  ciTimeout: number; // minutes
  cwd: string;
  dryRun?: boolean;
}
```

### Methods

- `constructor(config: ShipRunConfig, state?: ShipState)`: Initializes the orchestrator. If `state` is provided, it resumes from that state.
- `run(): Promise<number>`: Executes the state machine loop. Returns the final exit code (0 for success).

## State Machine Semantics

1. **BRANCH_SETUP**: 
   - Checks if working tree is clean. Fail fast if dirty.
   - Creates/switches to `feat/<featureId>` branch from `develop`.
2. **ACTIVATE_TESTS**:
   - Initializes baseline test results for regression checking.
3. **IMPLEMENT**:
   - Executes pre-flight gate checks for all open tasks in `tasks.json`.
   - Skips tasks whose gates already pass.
   - Dispatches remaining tasks to agent via `dispatchToAgent()`.
   - Transitions to `BUILD_CHECK`.
4. **BUILD_CHECK**:
   - Maps the project's build command from the `ProjectProfile` using `getBuildCommand()`.
   - If the mapped build command is `null` (no build toolchain configured), skips build check with message: `✓ build skipped (no build toolchain)`.
   - Otherwise, executes the build command and asserts its success. Fails back to `IMPLEMENT` on failure.
   - Transitions to `TEST_GATE`.
5. **TEST_GATE**:
   - Maps the project's test command using `getTestCommand()`.
   - If the mapped test command is `null` (no test toolchain configured), skips test check with message: `✓ tests skipped (no test toolchain)`.
   - Otherwise, executes the test command and compares failures against baseline. Fails back to `IMPLEMENT` on regression.
   - Transitions to `CODE_REVIEW`.
6. **CODE_REVIEW**:
   - Dispatches `review-code` workflow.
   - If verdict is `GO` → transitions to `UAT_REVIEW`.
   - If verdict is `NO-GO` → increments iteration and loops back to `IMPLEMENT`.
7. **UAT_REVIEW**:
   - Dispatches `review-uat` workflow.
   - If verdict is `GO` → transitions to `PR_CI`.
   - If verdict is `NO-GO` → increments iteration and loops back to `IMPLEMENT`.
8. **PR_CI**:
   - Creates GitHub PR targeting `develop`.
   - Polls for CI completion using `gh pr checks`.
   - Transitions to `DONE`.

## Recovery Semantics (FR-008)

- State is persisted to `.runs/<featureId>_<phaseId>.state` after every stage transition.
- Upon restart, the orchestrator reads this file and resumes from the last persisted stage.

## Circuit Breaker (FR-007)

- If `iteration > maxIterations`, the state transitions to `CIRCUIT_BREAK`.
- Structured `failureContext` is recorded in the state file.
- The process exits with code 1.

## Logging & Artifacts (FR-017)

- Stage transitions and major events are recorded in the `digest[]`.
- Raw logs are git-committed to `specs/<feature>/.gwrk/runs/`.
