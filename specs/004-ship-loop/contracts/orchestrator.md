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
  IMPLEMENT = "IMPLEMENT",
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
2. **IMPLEMENT**:
   - Executes pre-flight gate checks for all open tasks in `tasks.json`.
   - Skips tasks whose gates already pass.
   - Dispatches remaining tasks to agent via `dispatchToAgent()`.
   - Transitions to `CODE_REVIEW`.
3. **CODE_REVIEW**:
   - Dispatches `review-code` workflow.
   - If verdict is `GO` → transitions to `UAT_REVIEW`.
   - If verdict is `NO-GO` → increments iteration and loops back to `IMPLEMENT`.
4. **UAT_REVIEW**:
   - Dispatches `review-uat` workflow.
   - If verdict is `GO` → transitions to `PR_CI`.
   - If verdict is `NO-GO` → increments iteration and loops back to `IMPLEMENT`.
5. **PR_CI**:
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
