---
type: specification
feature: 004-ship-loop
last_modified: "2026-03-09T16:33:00Z"
---

# Feature Specification: 004 Ship Loop

**Feature Branch**: `004-ship-loop`
**Created**: 2026-02-27
**Revised**: 2026-03-09
**Status**: Settled
**Input**: Autonomous shipping lifecycle — `gwrk ship <feature> [phase]` delegates to `scripts/dev/work-until-done.sh` which orchestrates the full phase lifecycle: branch creation, agent dispatch, code review, UAT review, PR creation, CI gate, retry with circuit breaking, crash recovery, and execution manifest recording (ADR-003).

---

## 1. Design Decisions

### Architecture: Shell Scripts ARE the Product

The ship lifecycle is implemented in shell scripts, not TypeScript:

| Script | Purpose |
|---|---|
| `scripts/dev/work-until-done.sh` | Full state machine orchestrator |
| `scripts/dev/agent-run.sh` | Single agent dispatch (implement, review-code, review-uat) |
| `scripts/dev/wud-branch.sh` | Branch creation/checkout/push |
| `scripts/dev/wud-verdict.sh` | GO/NO-GO verdict from tasks.json |
| `scripts/dev/wud-ci-wait.sh` | PR check wait via `gh pr checks --watch` |

The `gwrk ship` TS command adds: SQLite run recording, execution manifest writing (ADR-003), config validation, CLI UX. It does NOT reimplement orchestration logic.

### Phase is Optional

- `gwrk ship <feature> <phase>` — ships a single phase
- `gwrk ship <feature>` — ships all phases from `tasks.json` sequentially, stops on first failure

---

## 2. User Scenarios & Testing

### US-001 - Single Phase Ship (Priority: P0)
As a PE, I want `gwrk ship <feature> <phase>` to execute the full lifecycle for a single phase: branch → implement → review → PR → CI.

**Implements**: FR-001, FR-002, FR-003, FR-004, FR-006, FR-011

**Acceptance Scenarios**:
1. **Given** a feature `004-ship-loop` with `tasks.json` containing 3 open tasks in phase-01 and passing gate scripts, **When** running `gwrk ship 004-ship-loop 1`, **Then**:
   - All tasks transition to `completed` in tasks.json
   - A `feat/004-ship-loop` branch exists
   - `gwrk db runs 004-ship-loop --json | jq '. | length'` returns `>= 1`
   - An execution manifest exists in `specs/004-ship-loop/.gwrk/runs/`

### US-002 - Hard Gate Pre-flight (Priority: P0)
As the ship engine, I want each task's gate script to be checked before implementation begins, and tasks whose gates already pass are skipped.

**Implements**: FR-003

**Acceptance Scenarios**:
1. **Given** a task T001 whose gate script already exits 0, **When** `gwrk ship 004-ship-loop 1` reaches T001, **Then**:
   - Output contains `T001.*pre-flight PASS.*skipping`

### US-003 - Full Feature Ship (Priority: P0)
As a PE, I want `gwrk ship <feature>` (no phase) to ship all phases sequentially, stopping on first failure.

**Implements**: FR-001, FR-013

**Acceptance Scenarios**:
1. **Given** a feature with 3 phases, **When** running `gwrk ship 004-ship-loop`, **Then**:
   - All 3 phases are attempted in order
   - If phase 2 fails, phase 3 is not attempted
   - Each phase gets its own execution manifest

### US-004 - Circuit Breaker (Priority: P0)
As a PE, I want the ship loop to stop after a configurable number of retry iterations and report the failure.

**Implements**: FR-007

**Acceptance Scenarios**:
1. **Given** `--max-iterations 2` and a review that always returns NO-GO, **When** running `gwrk ship 004-ship-loop 1 --max-iterations 2`, **Then**:
   - Command exits with code 1
   - Output contains `Circuit breaker`
   - `.runs/004-ship-loop_p1.state` contains `CIRCUIT_BREAK` stage

### US-005 - Crash Recovery (Priority: P1)
As the ship engine, I want the state machine to persist progress to disk and resume from the last completed stage on restart.

**Implements**: FR-008

**Acceptance Scenarios**:
1. **Given** a state file `.runs/004-ship-loop_p1.state` with `{"stage": "CODE_REVIEW", "iteration": 1}`, **When** running `gwrk ship 004-ship-loop 1`, **Then**:
   - Output contains `Resuming from state: CODE_REVIEW`

### US-006 - PR Creation & CI Gate (Priority: P0)
As the ship engine, I want a PR to be created targeting `develop` after reviews pass, then CI checks awaited.

**Implements**: FR-006

**Acceptance Scenarios**:
1. **Given** a completed phase with passing reviews, **When** ship creates a PR, **Then**:
   - `gh pr list --head feat/004-ship-loop --base develop` shows the PR

### US-007 - Execution Manifest (Priority: P1)
As a PE, I want every ship run to produce a git-tracked execution manifest for distributed agent analytics (ADR-003).

**Implements**: FR-012

**Acceptance Scenarios**:
1. **Given** a completed ship run, **Then**:
   - `ls specs/004-ship-loop/.gwrk/runs/*.json` returns at least one manifest
   - Manifest contains: `runId`, `feature`, `phase`, `command`, `agent`, `exitCode`, `durationS`, `gitCommit`, `gitBranch`

---

## 3. Functional Requirements

- **FR-001**: `gwrk ship <feature> [phase]` — delegates to `work-until-done.sh` for full lifecycle. Phase optional; omitted = all phases. (US-001, US-003)
- **FR-002**: System MUST create `feat/<feature>` branch from `develop` (or checkout existing) via `wud-branch.sh`. (US-001)
- **FR-003**: Pre-flight gate check per task. If gate already passes, skip with warning. (US-001, US-002)
- **FR-004**: Full state machine: BRANCH_SETUP → IMPLEMENT → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE. (US-001)
- **FR-005**: Code review (`/review-code`) and UAT review (`/review-uat`) via agent dispatch. NO-GO loops back to IMPLEMENT. (US-001)
- **FR-006**: PR creation via `gh pr create --base develop`, CI wait via `wud-ci-wait.sh`. (US-006)
- **FR-007**: Circuit breaker: `--max-iterations` (default 3). Exceeded → exit 1, `CIRCUIT_BREAK` state. (US-004)
- **FR-008**: Crash recovery: state persisted to `.runs/<feature>_p<phase>.state`. Resume on restart. (US-005)
- **FR-009**: Agent backend resolved from `.gwrkrc.json` `agents.implement` or `--agent` override. (US-001)
- **FR-010**: Timestamped log file in `.runs/` per run (machine-local, gitignored). (US-001)
- **FR-011**: Every agent dispatch recorded in SQLite execution ledger. (US-001)
- **FR-012**: Execution manifest written to `specs/<feature>/.gwrk/runs/` per ADR-003. (US-007)
- **FR-013**: When phase omitted, iterate all phases from `tasks.json` sequentially, stop on first failure. (US-003)

### Error States

| FR | Condition | stderr contains | Exit code |
|---|---|---|---|
| FR-001 | tasks.json not found | `Task state file not found` | 1 |
| FR-001 | Phase not found | `Phase phase-NN not found` | 1 |
| FR-002 | Git merge conflict | `Conflict detected during develop merge` | 1 |
| FR-003 | Gate already passes | `pre-flight PASS — skipping` | 0 (skip) |
| FR-006 | `gh` CLI not found | `gh CLI not found` | 1 |
| FR-006 | CI timeout | `Timeout after NNm` | 1 |
| FR-007 | Circuit breaker | `Circuit breaker: max N iterations reached` | 1 |
| FR-008 | Corrupt state file | `Corrupt state file — resetting` | 0 (auto-heal) |

---

## 4. Data Model Requirements

### DM-001: Ship Run State (`.runs/<feature>_p<phase>.state`)

Machine-local crash recovery state. Gitignored.

```json
{
  "stage": "CODE_REVIEW",
  "iteration": 1,
  "feature": "004-ship-loop",
  "phase": 1,
  "startedAt": "2026-03-09T14:02:33Z"
}
```

### DM-002: Execution Manifest (`specs/<feature>/.gwrk/runs/*.json`)

Git-tracked structured JSON per run. See [ADR-003](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-003-state-contract.md).

### DM-003: SQLite Execution Ledger (`runs` table)

Every ship dispatch recorded:
- `command`: `"ship"`
- `workflow`: `"work-until-done"`
- `exit_code`, `duration_s`, `agent_backend`

---

## 5. Technical Constraints

- **TC-001**: Determinism — state machine transitions are deterministic.
- **TC-002**: Air-Gapped — gwrk makes no direct network calls; external ops delegated to `gh`, `git`.
- **TC-003**: Fail-Fast Config — Zod validation, no `.default()`.
- **TC-004**: Gate Integrity — ship engine MUST NOT modify gate scripts.
- **TC-005**: Branch Isolation — implementation on `feat/<feature>`, PRs target `develop`.
- **TC-006**: Crash Safety — state flushed to disk before every stage transition.

---

## 6. Testing Requirements

- **TR-001**: `scripts/dev/work-until-done.sh` — state machine transitions (shell e2e). (FR-004)
- **TR-002**: `scripts/dev/wud-branch.sh` — branch creation/checkout/push (shell). (FR-002)
- **TR-003**: `scripts/dev/wud-verdict.sh` — GO/NO-GO verdict parsing (shell). (FR-005)
- **TR-004**: `scripts/dev/wud-ci-wait.sh` — CI wait and timeout (shell). (FR-006)
- **TR-005**: `src/commands/ship.test.ts` — CLI wrapper: full lifecycle dispatch, optional phase iteration, dry-run, failure handling (Vitest). (FR-001, FR-011, FR-013)
- **TR-006**: `src/scripts-e2e.test.ts` — E2E: `work-until-done.sh` invocation completes without unbound variables (Vitest + shell). (FR-004)

---

## 7. Success Criteria

- **SC-001**: `gwrk ship <feature> <phase>` completes the full lifecycle: branch → implement → review → PR → CI.
- **SC-002**: `gwrk ship <feature>` (no phase) ships all phases sequentially.
- **SC-003**: Every agent dispatch is recorded in SQLite + execution manifest.
- **SC-004**: Circuit breaker stops runaway loops. Crash recovery resumes from last stage.

---

## 8. Coverage Matrix

| US | FR | TR |
|---|---|---|
| US-001 | FR-001, FR-002, FR-003, FR-004, FR-006, FR-011 | TR-001, TR-002, TR-005 |
| US-002 | FR-003 | TR-005 |
| US-003 | FR-001, FR-013 | TR-005 |
| US-004 | FR-007 | TR-001 |
| US-005 | FR-008 | TR-001 |
| US-006 | FR-006 | TR-001, TR-004 |
| US-007 | FR-012 | TR-005 |
