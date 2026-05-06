# Contract: work-until-done.sh — Phase Orchestrator

**Source**: `scripts/dev/work-until-done.sh`
**FRs**: FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-010, FR-016, FR-017, FR-018

## Interface

```
./scripts/dev/work-until-done.sh <feature> <phase> [tracking_issue]
```

**Environment**:
| Var | Default | Purpose |
|---|---|---|
| `MAX_ITERATIONS` | `3` | Circuit breaker limit (FR-007) |
| `CI_TIMEOUT` | `30` | CI wait timeout in minutes |
| `DRY_RUN` | `false` | Print planned stages without executing |
| `APPROVAL_MODE` | `yolo` | Agent approval mode |
| `AGENT_RUNNER_BIN` | `scripts/dev/agent-run.sh` | Agent dispatch binary |
| `WUD_VERDICT_BIN` | `scripts/dev/wud-verdict.sh` | Verdict checker |
| `WUD_BRANCH_BIN` | `scripts/dev/wud-branch.sh` | Branch manager |
| `WUD_CI_WAIT_BIN` | `scripts/dev/wud-ci-wait.sh` | CI wait script |
| `RUNS_DIR` | `.runs` | State/log output directory |

## State Machine (FR-004 — IMPLEMENTED)

```
BRANCH_SETUP → IMPLEMENTING → CODE_REVIEW → UAT_REVIEW → PR_CI → CI_WAIT → DONE
                  ↑__________________|__________________|__________|
                         (NO-GO loops back, incrementing iteration)
```

On failure states: `FAILED`, `CIRCUIT_BREAK`

### State Persistence (FR-008 — IMPLEMENTED)

`save_state(stage, iteration, extra)` writes JSON to `$RUNS_DIR/<feature>_p<phase>.state`.

`load_state()` resumes from last persisted stage. `FAILED`, `CIRCUIT_BREAK`, and `DONE` all reset to `BRANCH_SETUP`.

## Stage Functions

### `run_implement()` — IMPLEMENTED
- Calls `$AGENT_RUNNER implement <feature> <phase>`
- Exit 130 (SIGINT) → abort
- Exit non-zero → return 2 (retry signal)
- Exit 0 → push via `$WUD_BRANCH push`
- Records run via `record_run "implement"`

### `run_code_review()` — IMPLEMENTED
- Calls `$AGENT_RUNNER review-code <feature> <phase>`
- Checks verdict via `$WUD_VERDICT`
- GO → return 0, NO-GO → return 1

### `run_uat_review()` — IMPLEMENTED
- Calls `$AGENT_RUNNER review-uat <feature> <phase>`
- Checks verdict via `$WUD_VERDICT`
- GO → return 0, NO-GO → return 1

### `run_pr_and_ci()` — IMPLEMENTED
- Creates GitHub PR via `gh pr create --base develop`
- Waits for CI via `$WUD_CI_WAIT`

## Missing Behaviors

### Pre-flight Gate Check (FR-003) — **NOT IMPLEMENTED**

Before `run_implement()`, the orchestrator MUST execute each task's `gateScript` from `tasks.json`. If a gate already passes → skip with message `pre-flight PASS — gate already satisfied, skipping`. If gate fails → proceed to implementation.

**This does not exist in the current script.**

### Staging Validation (FR-016) — **NOT IMPLEMENTED**

After `run_implement()` succeeds and before push, the orchestrator MUST call:
```bash
scripts/dev/validate-staging.sh <feature>
```
If validation fails → re-run agent with corrective guidance.

**`validate-staging.sh` exists and is robust, but is never called by WUD.**

### Event Sidecar Emission (FR-017) — **NOT IMPLEMENTED**

Throughout execution, the orchestrator MUST emit structured events to `$RUNS_DIR/<feature>_p<phase>.events`:
```
BRANCH_SETUP: created feat/<feature> from develop (0.3s)
IMPLEMENT: agent completed, 4 files changed
CODE_REVIEW: GO — all assertions satisfied
```

Format: `<STAGE>: <outcome summary>`

On completion, `ship.ts` reads this file via `assembleDigest()` and includes it in the execution manifest's `digest[]` array.

**No sidecar file is currently emitted.**

### failureContext on CIRCUIT_BREAK (FR-018) — **NOT IMPLEMENTED**

On `CIRCUIT_BREAK`, `save_state()` MUST include structured failure context:
```json
{
  "failureContext": {
    "openTasks": ["T003", "T005"],
    "lastVerdict": "NO-GO",
    "iterationTimeline": [
      { "iteration": 1, "stage": "UAT_REVIEW", "verdict": "NO-GO", "durationS": 342 }
    ],
    "digest": ["IMPLEMENT: agent exited 0", "CODE_REVIEW: NO-GO"]
  }
}
```

**Currently `save_state("CIRCUIT_BREAK", ...)` writes only `stage` and `iteration`.**

### Log File Tier (FR-010, FR-017) — PARTIAL

The `$WUD_LOG` file is written to `$RUNS_DIR/` (machine-local, gitignored). This satisfies FR-010.

However, FR-017 mandates that raw logs be rehomed to `specs/<feature>/.gwrk/runs/<timestamp>_<stage>.log` and git-committed. **Log rehoming is a Harvest (011) concern**, not a Ship Loop concern. Ship Loop only needs to produce the logs and the sidecar `.events` file.
