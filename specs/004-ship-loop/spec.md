---
type: specification
feature: 004-ship-loop
last_modified: "2026-03-06T12:00:00Z"
---

# Feature Specification: 004 WUD Loop

**Feature Branch**: `004-ship-loop`
**Created**: 2026-02-27
**Revised**: 2026-03-06
**Status**: Settled
**Input**: Autonomous implement → review → PR → CI loop — `gwrk ship` and `gwrk ship` CLI commands (wrappers for `agent-run.sh` and `work-until-done.sh`) that orchestrate the full phase lifecycle: branch creation, agent dispatch, code review, UAT review, PR creation, CI gate, retry with escalation, and SQLite execution ledger recording.

---

## 2. User Scenarios & Testing

### US-001 - Single Phase Implementation (Priority: P0)
As a Principal Engineer, I want to run `gwrk ship <feature> <phase>` so that a single phase is executed end-to-end — branch setup, task loop, verification — and a commit is produced for every completed task.

**Implements**: FR-001, FR-002, FR-003, FR-011

**Independent Test**: Run `gwrk ship` against a feature with a prepared `tasks.json` and gate scripts; verify tasks transition to `completed` and commits are created.

**Acceptance Scenarios**:
1. **Given** a feature `004-ship-loop` with `tasks.json` containing 3 open tasks in phase-01 and passing gate scripts, **When** running `gwrk ship 004-ship-loop 1`, **Then**:
   - `jq '[.phases[] | select(.id == "phase-01") | .tasks[] | select(.status == "completed")] | length' specs/004-ship-loop/.gwrk/tasks.json` outputs `3`
   - `git log --oneline --format='%s' -3 | grep -c 'feat:'` outputs `3`
   - `gwrk db runs 004-ship-loop --json | jq '. | length'` returns `>= 1`

### US-002 - Hard Gate Pre-flight (Priority: P0)
As the WUD engine, I want each task's gate script to FAIL before implementation begins (verify RED), so that the gate is proven to detect the unimplemented state before the agent writes code.

**Implements**: FR-003

**Independent Test**: Run implement against a task whose gate already passes; verify the task is skipped with a warning.

**Acceptance Scenarios**:
1. **Given** a task T001 whose gate script already exits 0, **When** `gwrk ship 004-ship-loop 1` reaches T001, **Then**:
   - `gwrk ship 004-ship-loop 1 2>&1 | grep -q 'T001.*pre-flight PASS.*skipping'` exits 0

### US-003 - Autonomous WUD Lifecycle (Priority: P0)
As a Principal Engineer, I want to run `gwrk ship <feature> <phase>` so that the full lifecycle — implement → code review → UAT review → PR → CI — is executed autonomously with retry on failure and each step recorded in SQLite.

**Implements**: FR-004, FR-005, FR-006, FR-007, FR-011

**Independent Test**: Run `gwrk ship` with mock agent backends and verify the full state machine completes.

**Acceptance Scenarios**:
1. **Given** a feature with open tasks, passing gates, and mock review agents, **When** running `gwrk ship 004-ship-loop 1`, **Then**:
   - `test -f .runs/004-ship-loop_p1.state` exits 1 (state file cleaned on success)
   - `gwrk ship 004-ship-loop 1 2>&1 | grep -q 'WORK UNTIL DONE.*COMPLETE'` exits 0
   - `gwrk db runs 004-ship-loop --json | jq '[.[] | select(.command == "ship")] | length'` returns `>= 1`

### US-004 - Circuit Breaker (Priority: P0)
As a Principal Engineer, I want the WUD loop to stop after a configurable number of retry iterations so that infinite loops are prevented and I am escalated via stderr.

**Implements**: FR-007

**Independent Test**: Set `MAX_ITERATIONS=2` and force repeated review failures; verify WUD exits with circuit-breaker message.

**Acceptance Scenarios**:
1. **Given** `MAX_ITERATIONS=2` and a review that always returns NO-GO, **When** running `gwrk ship 004-ship-loop 1`, **Then**:
   - Command exits with code 1
   - `gwrk ship 004-ship-loop 1 2>&1 | grep -q 'Circuit breaker'` exits 0
   - `test -f .runs/004-ship-loop_p1.state && jq -r '.stage' .runs/004-ship-loop_p1.state` outputs `CIRCUIT_BREAK`

### US-005 - Crash Recovery (Priority: P1)
As the WUD engine, I want the state machine to persist its stage and iteration to disk so that if the process crashes, it can resume from the last completed stage.

**Implements**: FR-008

**Independent Test**: Kill WUD mid-run; restart and verify it resumes from the last stage.

**Acceptance Scenarios**:
1. **Given** a state file `.runs/004-ship-loop_p1.state` with `{"stage": "CODE_REVIEW", "iteration": 1}`, **When** running `gwrk ship 004-ship-loop 1`, **Then**:
   - `gwrk ship 004-ship-loop 1 2>&1 | grep -q 'Resuming from state: CODE_REVIEW'` exits 0

### US-006 - PR Creation (Priority: P0)
As the WUD engine, I want a PR to be created after all reviews pass, targeting `develop`, so that the phase work is ready for merge.

**Implements**: FR-006

**Independent Test**: Run `gwrk ship` to completion and verify `gh pr list` shows the PR targeting `develop`.

**Acceptance Scenarios**:
1. **Given** a completed phase with passing reviews, **When** WUD creates a PR, **Then**:
   - `gh pr list --head feat/004-ship-loop --base develop --json number --jq '.[0].number'` returns a PR number

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: System MUST provide a `gwrk ship <feature> <phase>` command that executes all tasks in a single phase sequentially — loading each task from `tasks.json`, dispatching the configured agent backend, and verifying via gate scripts. (Implements: US-001)
- **FR-002**: System MUST create a `feat/<feature>` branch from `develop` if it doesn't exist, or checkout and rebase/merge latest `develop` if it does, before any implementation begins. (Implements: US-001, US-007)
- **FR-003**: System MUST execute a pre-flight check for each task — running `gates/T0xx-gate.sh` and confirming it FAILS (exit != 0) before dispatching the agent. If the gate already passes, the task MUST be skipped with a warning logged. (Implements: US-001, US-002)
- **FR-004**: System MUST provide a `gwrk ship <feature> <phase>` command that orchestrates the full WUD state machine: BRANCH_SETUP → IMPLEMENT → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE. (Implements: US-003)
- **FR-005**: System MUST dispatch agent-driven code review (`/review-code` workflow) and UAT review (`/review-uat` workflow) after implementation, checking the `tasks.json` verdict to determine GO or NO-GO. On NO-GO, the system MUST loop back to IMPLEMENT. (Implements: US-003)
- **FR-006**: System MUST create a GitHub PR via `gh pr create` targeting `develop` after both reviews pass, then wait for CI checks via `gh pr checks --watch`. (Implements: US-003, US-006)
- **FR-007**: System MUST enforce a configurable circuit breaker (`MAX_ITERATIONS`, default 3). After exceeding the limit, WUD MUST exit with code 1 and a `CIRCUIT_BREAK` state persisted to `.runs/`. (Implements: US-004)
- **FR-008**: System MUST persist state machine progress to `.runs/<feature>_p<phase>.state` as JSON after every stage transition. On restart, WUD MUST resume from the last persisted stage. (Implements: US-005)
- **FR-009**: System MUST read the agent backend from `.gwrkrc.json` `agents.defaults.implement` for implementation dispatch and `agents.defaults.review` for review dispatch. (Implements: US-008)
- **FR-010**: System MUST create a timestamped log file in `.runs/` for every WUD run, recording stage transitions, agent outputs, and timing information. (Implements: US-009)
- **FR-011**: System MUST record every agent dispatch and state machine transition in the SQLite execution ledger. Intermediate steps in `work-until-done.sh` MUST be recorded via a `gwrk db record` command. (Implements: US-001, US-003)
- **FR-012**: System MUST provide a `gwrk db record` command to allow shell scripts to write entries to the `runs` table. (Implements: FR-011)

#### FR-001 Error States (Implementation Loop)
| Condition | stderr contains | Exit code |
|---|---|---|
| tasks.json not found | `tasks.json not found for feature` | 1 |
| Phase not found in tasks.json | `Phase phase-NN not found in tasks.json` | 1 |
| No tasks in phase | `No tasks found in phase-NN` | 1 |
| Gate script missing | `Gate script gates/T0xx-gate.sh not found` | 1 |

#### FR-002 Error States (Branch Management)
| Condition | stderr contains | Exit code |
|---|---|---|
| Git merge conflict | `Conflict detected during develop merge` | 1 |
| Branch creation failed | `Failed to create feature branch` | 1 |

#### FR-003 Error States (Pre-flight Gate)
| Condition | stderr contains | Exit code |
|---|---|---|
| Gate already passes | `T0xx pre-flight PASS — gate already satisfied, skipping` | 0 (skip) |

#### FR-006 Error States (PR & CI)
| Condition | stderr contains | Exit code |
|---|---|---|
| `gh` CLI not found | `gh CLI not found — install GitHub CLI` | 1 |
| PR creation fails | `Failed to create PR` | 1 |
| CI timeout | `CI timeout after NNm` | 1 |

#### FR-007 Error States (Circuit Breaker)
| Condition | stderr contains | Exit code |
|---|---|---|
| Circuit breaker triggered | `Circuit breaker: max N iterations reached` | 1 |

#### FR-008 Error States (Crash Recovery)
| Condition | stderr contains | Exit code |
|---|---|---|
| Corrupt state file | `Corrupt state file — resetting to BRANCH_SETUP` | 0 (auto-heal) |

#### FR-009 Error States (Config)
| Condition | stderr contains | Exit code |
|---|---|---|
| Agent not configured | `Agent backend not found in .gwrkrc.json` | 1 |

#### FR-012 Error States (DB Record)
| Condition | stderr contains | Exit code |
|---|---|---|
| SQLite write failed | `Failed to write to execution ledger` | 1 |

---

## 5. Data Model Requirements

### DM-001: WUD Run State (`.runs/<feature>_p<phase>.state`)

Matches `004-ship-loop` contract. Persisted JSON.

### DM-002: WUD Run Log (`.runs/<timestamp>_wud_<feature>_p<phase>.log`)

Plain text log file.

### DM-003: SQLite Execution Ledger (`runs` table)

Every transition and agent dispatch must be recorded.
- `command`: "ship", "ship", "implement", "review-code", "review-uat"
- `workflow`: mapping to `.agent/workflows/`
- `exit_code`: outcome of the step
- `duration_s`: time taken

---

## 6. Technical Constraints

- **TC-001**: Determinism — WUD state machine transitions are deterministic.
- **TC-002**: Air-Gapped Engine — The gwrk core makes no direct network calls; all external ops (GitHub, CI) are delegated to CLIs (`gh`, `git`).
- **TC-003**: Fail-Fast Config — Zod validation with no `.default()` calls.
- **TC-004**: Gate Integrity — The WUD engine MUST NOT modify gate scripts.
- **TC-005**: Commit-per-Task — Each completed task gets its own git commit `feat: T0xx done`.
- **TC-006**: Branch Isolation — Implementation on `feat/<feature>`, PRs target `develop`.
- **TC-007**: Crash Safety — State flushed to disk before every stage transition.

---

## 7. Testing Requirements

- **TR-001**: `scripts/dev/agent-run.sh` — Verify implement loop iterates tasks.json. Shell. (FR-001)
- **TR-002**: `scripts/dev/wud-branch.sh` — Verify branch creation/merge logic. Shell. (FR-002)
- **TR-003**: `scripts/dev/work-until-done.sh` — Verify state machine transitions. Shell. (FR-004)
- **TR-004**: `scripts/dev/wud-verdict.sh` — Verify tasks.json parsing for GO/NO-GO. Shell. (FR-005)
- **TR-005**: `src/commands/db.ts` — Verify `gwrk db record` writes to SQLite. Vitest. (FR-012)
- **TR-006**: `src/commands/ship.ts` — Verify CLI wrapper records start/finish of orchestrator. Vitest. (FR-011)

---

## 8. Success Criteria

- **SC-001**: `gwrk ship` completes tasks with enforced gates.
- **SC-002**: `gwrk ship` runs autonomous loop to merge-ready PR.
- **SC-003**: Every agent dispatch is audit-ready in SQLite `runs` table.

---

## 9. Verification Requirements

- **VR-001**: E2E: Run `gwrk ship` → verify PR targeting `develop` → verify SQLite contains records for implement, review-code, and review-uat.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-002, FR-003, FR-011 | FR-001 | US-001 | TR-001 |
| US-002 | FR-003 | FR-002 | US-001, US-007 | TR-002 |
| US-003 | FR-004, FR-005, FR-006, FR-007, FR-011 | FR-003 | US-001, US-002 | TR-001 |
| US-004 | FR-007 | FR-004 | US-003 | TR-003 |
| US-005 | FR-008 | FR-005 | US-003 | TR-004 |
| US-006 | FR-006 | FR-006 | US-003, US-006 | TR-003 |
| US-007 | FR-002 | FR-007 | US-004 | TR-003 |
| US-008 | FR-009 | FR-008 | US-005 | TR-003 |
| US-009 | FR-010 | FR-009 | US-008 | TR-006 |
| | | FR-010 | US-009 | TR-003 |
| | | FR-011 | US-001, US-003 | TR-005, TR-006 |
| | | FR-012 | FR-011 | TR-005 |
