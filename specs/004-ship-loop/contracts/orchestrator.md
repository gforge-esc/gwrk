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
   - MUST verify the branch is pushable before any agent runs (`ensurePushable`).
     PR_CI pushes only at the end, so a stale remote branch otherwise surfaces
     after implement + code review + UAT have all run and discards the run.
     - No `origin/<branch>` → proceed; the first push creates it.
     - Behind only → fast-forward (`git merge --ff-only`) and proceed.
     - Diverged (behind AND ahead) → fail the stage, naming the branch, both
       counts, and the reconciliation commands. Choosing between two histories
       is the operator's call, not the orchestrator's.
     - The comparison itself failing is non-fatal (warn and proceed) — PR_CI
       still guards the push.
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

### Review/Gate Divergence (both review stages)

ADR-007 makes gates truth and the agent verdict advisory. **Advisory is not
discarded.** `revertSourceMutations()` throws away everything a review agent
wrote except `tasks.json`, so moving a task `completed → open` is how a review
agent registers a defect.

`readVerdict()` therefore receives the set of tasks the review agent re-opened
during this run (diffed against the pre-dispatch snapshot, so a task already
open before review carries no verdict), and:

- Gate PASSES + task re-opened by review → **DIVERGENCE**. The task MUST NOT be
  marked `completed`. Record the task ids on `ShipState.reviewGateDivergence`,
  annotate the task description so DIAGNOSE sees the cause, and return `NO-GO`.
- Gate PASSES + task untouched by review → complete it (unchanged).
- Gate FAILS → the existing NO-GO path, unchanged. A failing gate is not a
  divergence: gate and review agree.

A green gate covering a review finding means the GATE has a coverage hole. That
is the only moment the system can detect one, so it is reported rather than
resolved in the gate's favour. Marking such a task complete is what shipped
005-dashboard-api Phase 1 with a reproduced defect while the console read `GO`.
8. **PR_CI**:
   - Creates GitHub PR targeting `develop`.
   - Polls for CI completion using `gh pr checks` (see below).
   - Transitions to `DONE`.

### Waiting for checks (`waitForChecks`)

The wait escalates, and only the last step may conclude there is nothing to
wait for:

```
gh pr checks --required   →  "no required checks reported"  →  retry without --required
                          →  "no checks reported"           →  skip, logged
```

- A repo WITH branch protection waits on its required checks.
- A repo WITHOUT protection still waits on every check it has. `--required`
  exits 1 with `no **required** checks reported`, which does not contain the
  substring `no checks reported` — the old single-level guard missed it and
  failed PR_CI instantly on green CI.
- Only a repo with no checks at all skips, and it says so.

Widening the guard without the fallback is NOT an acceptable fix: it would make
gwrk skip CI on every unprotected repo and report success — the vacuous-green
class 026/027 exist to close. Any genuine check failure at either level throws.

#### Transient GitHub failures are retried, verdicts are not

Each `gh pr checks` invocation retries on errors that are recognisably GitHub's
infrastructure rather than a statement about the code: GraphQL 502-class
("Something went wrong while executing your query"), HTTP 500/502/503/504,
primary and secondary rate limits, and dropped connections
(`ECONNRESET`/`ETIMEDOUT`/`EAI_AGAIN`/`ENOTFOUND`/`EPIPE`/socket hang up).
Backoff is 3s → 10s → 30s, then the error propagates.

A CI **verdict** is never retried. Retrying one would double an already-long
wait and could mask a genuine red.

The classification matters because the caller has already spent the run: #2631
completed implement, both reviews through a NO-GO/iterate cycle, opened the PR
and passed CI in 9s, then exited 1 on GitHub's own GraphQL error. Retry composes
with the escalation above — a blip on the `--required` query still falls through
to the all-checks wait once it clears.

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
