# Feature Specification: 004 WUD Loop

**Feature Branch**: `004-wud-loop`
**Created**: 2026-02-27
**Status**: Draft
**Input**: Autonomous implement → review → PR → CI loop — `gwrk implement` and `gwrk wud` CLI commands that orchestrate the full phase lifecycle: branch creation, agent dispatch, code review, UAT review, PR creation, CI gate, retry with escalation, and crash recovery.

---

## 2. User Scenarios & Testing

### US-001 - Single Phase Implementation (Priority: P0)
As a Principal Engineer, I want to run `gwrk implement <feature> <phase>` so that a single phase is executed end-to-end — branch setup, task loop, verification — and a commit is produced for every completed task.

**Implements**: FR-001, FR-002, FR-003

**Independent Test**: Run `gwrk implement` against a feature with a prepared `tasks.json` and gate scripts; verify tasks transition to `completed` and commits are created.

**Acceptance Scenarios**:
1. **Given** a feature `004-wud-loop` with `tasks.json` containing 3 open tasks in phase-01 and passing gate scripts, **When** running `gwrk implement 004-wud-loop 1`, **Then**:
   - `jq '[.phases[] | select(.id == "phase-01") | .tasks[] | select(.status == "completed")] | length' specs/004-wud-loop/.gwrk/tasks.json` outputs `3`
   - `git log --oneline --format='%s' -3 | grep -c 'feat:'` outputs `3`
2. **Given** a feature with no `tasks.json`, **When** running `gwrk implement 004-wud-loop 1`, **Then**:
   - Command exits with code 1
   - `gwrk implement 004-wud-loop 1 2>&1 | grep -q 'tasks.json not found'` exits 0

### US-002 - Hard Gate Pre-flight (Priority: P0)
As the WUD engine, I want each task's gate script to FAIL before implementation begins (verify RED), so that the gate is proven to detect the unimplemented state before the agent writes code.

**Implements**: FR-003

**Independent Test**: Run implement against a task whose gate already passes; verify the task is skipped with a warning.

**Acceptance Scenarios**:
1. **Given** a task T001 whose gate script already exits 0, **When** `gwrk implement` reaches T001, **Then**:
   - `gwrk implement 004-wud-loop 1 2>&1 | grep -q 'T001.*pre-flight PASS.*skipping'` exits 0
2. **Given** a task T002 whose gate script exits 1, **When** `gwrk implement` reaches T002, **Then**:
   - The agent proceeds to implement T002

### US-003 - Autonomous WUD Lifecycle (Priority: P0)
As a Principal Engineer, I want to run `gwrk wud <feature>` so that the full lifecycle — implement → code review → UAT review → PR → CI — is executed autonomously with retry on failure.

**Implements**: FR-004, FR-005, FR-006, FR-007

**Independent Test**: Run `gwrk wud` with mock agent backends and verify the full state machine completes.

**Acceptance Scenarios**:
1. **Given** a feature with open tasks, passing gates, and mock review agents, **When** running `gwrk wud 004-wud-loop 1`, **Then**:
   - `test -f .runs/004-wud-loop_p1.state` exits 1 (state file cleaned on success)
   - `gwrk wud 004-wud-loop 1 2>&1 | grep -q 'WORK UNTIL DONE.*COMPLETE'` exits 0
2. **Given** a feature where code review returns NO-GO on first iteration, **When** running `gwrk wud 004-wud-loop 1`, **Then**:
   - WUD loops back to implement and retries
   - `gwrk wud 004-wud-loop 1 2>&1 | grep -c 'IMPLEMENT.*Iteration'` returns `>= 2`

### US-004 - Circuit Breaker (Priority: P0)
As a Principal Engineer, I want the WUD loop to stop after a configurable number of retry iterations so that infinite loops are prevented and I am escalated via stderr.

**Implements**: FR-007

**Independent Test**: Set `MAX_ITERATIONS=2` and force repeated review failures; verify WUD exits with circuit-breaker message.

**Acceptance Scenarios**:
1. **Given** `MAX_ITERATIONS=2` and a review that always returns NO-GO, **When** running `gwrk wud 004-wud-loop 1`, **Then**:
   - Command exits with code 1
   - `gwrk wud 004-wud-loop 1 2>&1 | grep -q 'Circuit breaker'` exits 0
   - `test -f .runs/004-wud-loop_p1.state && jq -r '.stage' .runs/004-wud-loop_p1.state` outputs `CIRCUIT_BREAK`

### US-005 - Crash Recovery (Priority: P1)
As the WUD engine, I want the state machine to persist its stage and iteration to disk so that if the process crashes, it can resume from the last completed stage.

**Implements**: FR-008

**Independent Test**: Kill WUD mid-run; restart and verify it resumes from the last stage rather than restarting from scratch.

**Acceptance Scenarios**:
1. **Given** a state file `.runs/004-wud-loop_p1.state` with `{"stage": "CODE_REVIEW", "iteration": 1}`, **When** running `gwrk wud 004-wud-loop 1`, **Then**:
   - `gwrk wud 004-wud-loop 1 2>&1 | grep -q 'Resuming from state: CODE_REVIEW'` exits 0

### US-006 - PR Creation (Priority: P0)
As the WUD engine, I want a PR to be created after all reviews pass, targeting `develop`, so that the phase work is ready for merge.

**Implements**: FR-006

**Independent Test**: Run `gwrk wud` to completion and verify `gh pr list` shows the PR targeting `develop`.

**Acceptance Scenarios**:
1. **Given** a completed phase with passing reviews, **When** WUD creates a PR, **Then**:
   - `gh pr list --head feat/004-wud-loop --base develop --json number --jq '.[0].number'` returns a PR number
   - `gh pr view $(gh pr list --head feat/004-wud-loop --base develop --json number --jq '.[0].number') --json body --jq '.body' | grep -q 'Tasks Completed'` exits 0

### US-007 - Branch Management (Priority: P0)
As the WUD engine, I want `gwrk implement` to create a `feat/<feature>` branch from `develop` if it doesn't exist, or checkout and merge latest `develop` if it does, so that implementation always starts from a clean, up-to-date branch.

**Implements**: FR-002

**Independent Test**: Run `gwrk implement` in a repo without the feature branch; verify it creates `feat/<feature>` from `develop`.

**Acceptance Scenarios**:
1. **Given** no local branch `feat/004-wud-loop`, **When** running `gwrk implement 004-wud-loop 1`, **Then**:
   - `git branch --list feat/004-wud-loop | grep -q 'feat/004-wud-loop'` exits 0
2. **Given** `feat/004-wud-loop` exists and `develop` has new commits, **When** running `gwrk implement 004-wud-loop 1`, **Then**:
   - `git log feat/004-wud-loop --oneline -1 | grep -q "$(git log develop --oneline -1 | cut -d' ' -f1)"` exits 0

### US-008 - Agent Dispatch Configuration (Priority: P1)
As a Principal Engineer, I want `gwrk implement` and `gwrk wud` to dispatch the agent backend configured in `.gwrkrc.json` (defaulting to the `implement` role), so that I control which agent runs my phases.

**Implements**: FR-009

**Independent Test**: Set `agents.defaults.implement` to `gemini` in `.gwrkrc.json` and verify implement dispatches `gemini`.

**Acceptance Scenarios**:
1. **Given** `.gwrkrc.json` with `agents.defaults.implement: "gemini"`, **When** running `gwrk implement 004-wud-loop 1 --dry-run`, **Then**:
   - `gwrk implement 004-wud-loop 1 --dry-run 2>&1 | grep -q 'Agent: gemini'` exits 0

### US-009 - WUD Run Logging (Priority: P1)
As a Principal Engineer, I want every WUD run to produce a timestamped log file in `.runs/` so that I can audit what happened during autonomous execution.

**Implements**: FR-010

**Independent Test**: Run `gwrk wud` and verify a log file is created in `.runs/`.

**Acceptance Scenarios**:
1. **Given** a successful WUD run, **When** checking `.runs/`, **Then**:
   - `ls .runs/*wud*004-wud-loop*.log 2>/dev/null | wc -l` outputs `>= 1`
   - `grep -q 'IMPLEMENT' .runs/*wud*004-wud-loop*.log` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: System MUST provide a `gwrk implement <feature> <phase>` command that executes all tasks in a single phase sequentially — loading each task from `tasks.json`, dispatching the configured agent backend, and verifying via gate scripts. (Implements: US-001)
- **FR-002**: System MUST create a `feat/<feature>` branch from `develop` if it doesn't exist, or checkout and rebase/merge latest `develop` if it does, before any implementation begins. (Implements: US-001, US-007)
- **FR-003**: System MUST execute a pre-flight check for each task — running `gates/T0xx-gate.sh` and confirming it FAILS (exit != 0) before dispatching the agent. If the gate already passes, the task MUST be skipped with a warning logged. (Implements: US-001, US-002)
- **FR-004**: System MUST provide a `gwrk wud <feature> <phase>` command that orchestrates the full WUD state machine: BRANCH_SETUP → IMPLEMENT → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE. (Implements: US-003)
- **FR-005**: System MUST dispatch agent-driven code review (`/review-code` workflow) and UAT review (`/review-uat` workflow) after implementation, checking the `tasks.json` verdict to determine GO or NO-GO. On NO-GO, the system MUST loop back to IMPLEMENT. (Implements: US-003)
- **FR-006**: System MUST create a GitHub PR via `gh pr create` targeting `develop` after both reviews pass, then wait for CI checks via `gh pr checks --watch`. (Implements: US-003, US-006)
- **FR-007**: System MUST enforce a configurable circuit breaker (`MAX_ITERATIONS`, default 3). After exceeding the limit, WUD MUST exit with code 1 and a `CIRCUIT_BREAK` state persisted to `.runs/`. (Implements: US-004)
- **FR-008**: System MUST persist state machine progress to `.runs/<feature>_p<phase>.state` as JSON after every stage transition. On restart, WUD MUST resume from the last persisted stage. On success, the state file MUST be deleted. On terminal failure (`DONE`, `FAILED`, `CIRCUIT_BREAK`), restarting MUST reset to `BRANCH_SETUP`. (Implements: US-005)
- **FR-009**: System MUST read the agent backend from `.gwrkrc.json` `agents.defaults.implement` for implementation dispatch and `agents.defaults.review` for review dispatch. The dispatch MUST invoke the configured CLI command with the appropriate flags. (Implements: US-008)
- **FR-010**: System MUST create a timestamped log file in `.runs/` for every WUD run, recording stage transitions, agent outputs, and timing information. (Implements: US-009)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| tasks.json not found | `tasks.json not found for feature` | 1 |
| Phase not found in tasks.json | `Phase phase-NN not found in tasks.json` | 1 |
| No tasks in phase | `No tasks found in phase-NN` | 1 |
| Gate script missing | `Gate script gates/T0xx-gate.sh not found` | 1 |

#### FR-003 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Gate already passes (pre-flight) | `T0xx pre-flight PASS — gate already satisfied, skipping` | 0 (skip, not fail) |

#### FR-006 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| `gh` CLI not found | `gh CLI not found — install GitHub CLI` | 1 |
| PR creation fails | `Failed to create PR` | 1 |
| CI timeout | `CI timeout after NNm` | 1 |

#### FR-007 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Circuit breaker triggered | `Circuit breaker: max N iterations reached` | 1 |

#### FR-008 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Corrupt state file | `Corrupt state file — resetting to BRANCH_SETUP` | 0 (auto-heal) |

---

## 5. Data Model Requirements

### DM-001: WUD Run State (`.runs/<feature>_p<phase>.state`)

```typescript
interface WudState {
  stage: "BRANCH_SETUP" | "IMPLEMENTING" | "CODE_REVIEW" | "UAT_REVIEW" | "PR_CI" | "CI_WAIT" | "DONE" | "FAILED" | "CIRCUIT_BREAK";
  iteration: number;          // Current iteration count (1-indexed)
  feature: string;            // e.g. "004-wud-loop"
  phase: string;              // e.g. "1"
  trackingIssue?: string;     // Optional GitHub issue number
  prNumber?: number;          // Set after PR creation
  updatedAt: string;          // ISO 8601
}
```

### DM-002: WUD Run Log (`.runs/<timestamp>_wud_<feature>_p<phase>.log`)

Plain text log file with timestamped entries:
```
# gwrk Work-Until-Done Log
# Feature   : 004-wud-loop
# Phase     : 1
# Max Iter  : 3
# Started   : 2026-02-27T10:00:00-0700

10:00:01 [INFO] Ensuring feat/004-wud-loop branch...
10:00:02 [STAGE] IMPLEMENT — Iteration 1/3
...
```

### DM-003: Consumed Data Models (from 001-cli-core)

WUD reads and writes `tasks.json` (DM-001 from 001-cli-core) and appends to `history.jsonl` (DM-002 from 001-cli-core) via the `gwrk tasks done` command. No new task state schemas are introduced.

---

## 6. Technical Constraints

- **TC-001**: Determinism — WUD state machine transitions are deterministic. Given the same `tasks.json` state, gate results, and review verdicts, the system produces the same sequence of actions.
- **TC-002**: Air-Gapped — The WUD engine itself makes no network calls. Network operations (GitHub PR, CI checks) are delegated to `gh` CLI. Agent dispatch is via `child_process.execFile`.
- **TC-003**: Fail-Fast Config — Zod validation with no `.default()` calls. Missing `.gwrkrc.json` or invalid schema → `process.exit(1)`.
- **TC-004**: Gate Integrity — The WUD engine MUST NOT create, modify, or delete gate scripts. Gates are pre-committed artifacts from `/plan-to-tasks`.
- **TC-005**: Commit-per-Task — Each completed task gets its own git commit with the format `feat: T0xx done`. No batched commits.
- **TC-006**: Branch Isolation — `gwrk implement` always works on `feat/<feature>`. PRs always target `develop`. No direct pushes to `develop` or `main`.
- **TC-007**: Crash Safety — State is flushed to disk before every stage transition. The process can be killed at any point and resume without data loss or duplicate work.

---

## 7. Testing Requirements

- **TR-001**: `src/commands/implement.test.ts` — Verify `implement` loads tasks.json, iterates tasks in phase order, runs pre-flight gate check (expects FAIL), dispatches agent, runs post-flight gate (expects PASS), calls `gwrk tasks done`, and commits. Mock `execFile` and `state.ts`. Vitest. (FR-001, FR-002, FR-003)
- **TR-002**: `src/commands/implement.test.ts` — Verify `implement` creates branch from `develop` when missing, merges `develop` when exists. Mock `git` commands. Vitest. (FR-002)
- **TR-003**: `src/commands/implement.test.ts` — Verify `implement` skips tasks whose pre-flight gate already passes, with warning message. Vitest. (FR-003)
- **TR-004**: `src/commands/wud.test.ts` — Verify WUD state machine transitions: BRANCH_SETUP → IMPLEMENTING → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE. Mock all stages. Vitest. (FR-004, FR-005, FR-006)
- **TR-005**: `src/commands/wud.test.ts` — Verify WUD loops back to IMPLEMENT on code review NO-GO and UAT NO-GO. Vitest. (FR-005)
- **TR-006**: `src/commands/wud.test.ts` — Verify WUD creates PR via `gh pr create --base develop` and waits for CI via `gh pr checks --watch`. Mock `gh` CLI. Vitest. (FR-006)
- **TR-007**: `src/commands/wud.test.ts` — Verify circuit breaker: WUD exits with code 1 after `MAX_ITERATIONS` exceeded. Verify state file contains `CIRCUIT_BREAK`. Vitest. (FR-007)
- **TR-008**: `src/commands/wud.test.ts` — Verify crash recovery: write a state file with `stage: "CODE_REVIEW"`, restart WUD, verify it resumes from CODE_REVIEW. Verify state file deleted on DONE. Vitest. (FR-008)
- **TR-009**: `src/commands/implement.test.ts` — Verify agent backend read from `.gwrkrc.json` and dispatched with correct flags. Vitest. (FR-009)
- **TR-010**: `src/commands/wud.test.ts` — Verify WUD creates a log file in `.runs/` with correct format and content. Vitest. (FR-010)

---

## 8. Success Criteria

- **SC-001**: `gwrk implement <feature> <phase>` completes all tasks in a phase with one commit per task and enforced gate verification.
- **SC-002**: `gwrk wud <feature> <phase>` runs the full IMPLEMENT → REVIEW → PR → CI loop autonomously without human intervention (happy path).
- **SC-003**: WUD circuit breaker fires reliably — no infinite loops under any review/CI failure pattern.
- **SC-004**: WUD crash recovery works — killing the process mid-run and restarting resumes from the last stage without repeating completed work.

---

## 9. Verification Requirements

- **VR-001**: E2E integration test: prepare a feature with `tasks.json` + gate scripts → run `gwrk implement <feature> 1` → verify all tasks completed, commits created, branch exists.
- **VR-002**: E2E integration test: run `gwrk wud <feature> 1` with mock agents → verify full state machine → verify PR created targeting `develop` → verify state file cleaned.
- **VR-003**: Negative test: set `MAX_ITERATIONS=1`, mock review NO-GO → verify `CIRCUIT_BREAK` state persisted and exit code 1.
- **VR-004**: Crash recovery test: write partial state file → restart `gwrk wud` → verify resume from correct stage.
- **VR-005**: Config validation test: remove `agents.defaults.implement` from `.gwrkrc.json` → verify `gwrk implement` crashes with Zod error.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-002, FR-003 | FR-001 | US-001 | TR-001, TR-002, TR-003 |
| US-002 | FR-003 | FR-002 | US-001, US-007 | TR-002 |
| US-003 | FR-004, FR-005, FR-006, FR-007 | FR-003 | US-001, US-002 | TR-001, TR-003 |
| US-004 | FR-007 | FR-004 | US-003 | TR-004, TR-005 |
| US-005 | FR-008 | FR-005 | US-003 | TR-004, TR-005 |
| US-006 | FR-006 | FR-006 | US-003, US-006 | TR-006 |
| US-007 | FR-002 | FR-007 | US-004 | TR-007 |
| US-008 | FR-009 | FR-008 | US-005 | TR-008 |
| US-009 | FR-010 | FR-009 | US-008 | TR-009 |
| | | FR-010 | US-009 | TR-010 |
