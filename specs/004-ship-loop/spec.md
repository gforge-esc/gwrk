# Feature Specification: 004 Ship Loop

**Feature Branch**: `004-ship-loop`
**Created**: 2026-02-27
**Revised**: 2026-03-09
**Status**: Settled
**Input**: Autonomous shipping lifecycle — `gwrk ship <feature> [phase]` orchestrates the complete phase lifecycle: branch creation, agent dispatch, code review, UAT review, PR creation, CI gate, retry with circuit breaking, crash recovery, and execution manifest recording (ADR-003). Delegates to `scripts/dev/work-until-done.sh` as the state machine orchestrator. Phase is optional — omitting it ships all phases sequentially.

---

## 2. User Scenarios & Testing

### US-001 - Ship Single Phase (Priority: P0)
As a Principal Engineer, I want `gwrk ship <feature> <phase>` to run the full lifecycle for one phase: branch → implement → review → PR → CI.

**Implements**: FR-001, FR-002, FR-003, FR-004, FR-006, FR-011, FR-012

**Independent Test**: Run `gwrk ship` against a feature with a prepared `tasks.json` and gate scripts; verify the full lifecycle completes with PR creation and SQLite recording.

**Acceptance Scenarios**:
1. **Given** a feature `004-ship-loop` with `tasks.json` containing 3 open tasks in phase-01 and passing gate scripts, **When** running `gwrk ship 004-ship-loop 1`, **Then**:
   - `jq '[.phases[] | select(.id == "phase-01") | .tasks[] | select(.status == "completed")] | length' specs/004-ship-loop/.gwrk/tasks.json` outputs `3`
   - `git log --oneline -3 --format='%s' | grep -c 'feat:'` exits 0
   - `gwrk db runs 004-ship-loop --json | jq '. | length'` returns `>= 1`
   - `ls specs/004-ship-loop/.gwrk/runs/*.json | wc -l` returns `>= 1`

### US-002 - Hard Gate Pre-flight (Priority: P0)
As the ship engine, I want each task's gate to be checked before implementation begins, and tasks whose gates already pass are skipped.

**Implements**: FR-003

**Independent Test**: Mock a task whose gate already passes; verify the task is skipped with pre-flight PASS warning.

**Acceptance Scenarios**:
1. **Given** a task T001 whose gate script already exits 0, **When** `gwrk ship 004-ship-loop 1` reaches T001, **Then**:
   - `gwrk ship 004-ship-loop 1 2>&1 | grep -q 'T001.*pre-flight PASS.*skipping'` exits 0

### US-003 - Ship All Phases (Priority: P0)
As a Principal Engineer, I want `gwrk ship <feature>` (no phase) to ship all phases sequentially, stopping on first failure.

**Implements**: FR-001, FR-013

**Independent Test**: Run `gwrk ship` with `--dry-run` against a feature with 3 phases; verify all phase invocations are printed.

**Acceptance Scenarios**:
1. **Given** a feature with 3 phases in `tasks.json`, **When** running `gwrk ship 004-ship-loop --dry-run`, **Then**:
   - `gwrk ship 004-ship-loop --dry-run 2>&1 | grep -c 'DRY RUN'` outputs `3`
2. **Given** a feature with 3 phases where phase 2 fails, **When** running `gwrk ship 004-ship-loop`, **Then**:
   - `gwrk db runs 004-ship-loop --json | jq '[.[] | select(.exit_code != 0)] | length'` returns `>= 1`
   - Phase 3 is never attempted (no SQLite run record for phase-03)

### US-004 - Circuit Breaker (Priority: P0)
As a Principal Engineer, I want the ship loop to stop after a configurable number of retry iterations.

**Implements**: FR-007

**Independent Test**: Set `--max-iterations 2` and force review NO-GO; verify circuit-breaker exit.

**Acceptance Scenarios**:
1. **Given** `--max-iterations 2` and a review that always returns NO-GO, **When** running `gwrk ship 004-ship-loop 1 --max-iterations 2`, **Then**:
   - `echo $?` outputs `1`
   - `gwrk ship 004-ship-loop 1 --max-iterations 2 2>&1 | grep -q 'Circuit breaker'` exits 0
   - `test -f .runs/004-ship-loop_p1.state && jq -r '.stage' .runs/004-ship-loop_p1.state` outputs `CIRCUIT_BREAK`

### US-005 - Crash Recovery (Priority: P1)
As the ship engine, I want the state machine to persist its stage to disk and resume on restart.

**Implements**: FR-008

**Independent Test**: Write a mid-run state file; restart ship; verify it resumes from the persisted stage.

**Acceptance Scenarios**:
1. **Given** a state file `.runs/004-ship-loop_p1.state` with `{"stage": "CODE_REVIEW", "iteration": 1}`, **When** running `gwrk ship 004-ship-loop 1`, **Then**:
   - `gwrk ship 004-ship-loop 1 2>&1 | grep -q 'Resuming from state: CODE_REVIEW'` exits 0

### US-006 - PR Creation & CI Gate (Priority: P0)
As the ship engine, I want a PR created targeting `develop` after reviews pass, with CI checks awaited.

**Implements**: FR-006

**Independent Test**: Run ship to completion; verify PR exists targeting `develop`.

**Acceptance Scenarios**:
1. **Given** a completed phase with passing reviews, **When** ship creates a PR, **Then**:
   - `gh pr list --head feat/004-ship-loop --base develop --json number --jq '.[0].number'` returns a PR number
   - `gh pr checks $(gh pr list --head feat/004-ship-loop --json number --jq '.[0].number') 2>&1 | grep -c 'pass\|no checks'` returns `>= 1`

### US-007 - Execution Manifest (Priority: P1)
As a Principal Engineer, I want every ship run to produce a git-tracked execution manifest per ADR-003.

**Implements**: FR-012

**Independent Test**: Run ship; verify manifest file exists with required fields.

**Acceptance Scenarios**:
1. **Given** a completed ship run, **Then**:
   - `ls specs/004-ship-loop/.gwrk/runs/*.json | wc -l` returns `>= 1`
   - `jq -e '.runId and .feature and .phase and .command and .exitCode and .durationS and .gitCommit and .gitBranch' specs/004-ship-loop/.gwrk/runs/*.json` exits 0

### US-008 - Agent Backend Config (Priority: P1)
As a Principal Engineer, I want the agent backend resolved from `.gwrkrc.json` with `--agent` override.

**Implements**: FR-009

**Independent Test**: Set `.gwrkrc.json agents.implement` to `gemini`; run ship; verify the configured agent is used.

**Acceptance Scenarios**:
1. **Given** `.gwrkrc.json` with `agents.implement: "gemini"`, **When** running `gwrk ship 004-ship-loop 1 --dry-run`, **Then**:
   - `gwrk ship 004-ship-loop 1 --dry-run 2>&1 | grep -q 'gemini'` exits 0
2. **Given** `--agent claude` override, **When** running `gwrk ship 004-ship-loop 1 --dry-run --agent claude`, **Then**:
   - `gwrk ship 004-ship-loop 1 --dry-run --agent claude 2>&1 | grep -q 'claude'` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: System MUST provide `gwrk ship <feature> [phase]` that delegates to `scripts/dev/work-until-done.sh`. When phase is omitted, all phases from `tasks.json` are shipped sequentially, stopping on first failure. (Implements: US-001, US-003)
- **FR-002**: System MUST create a `feat/<feature>` branch from `develop` via `scripts/dev/wud-branch.sh`, or checkout and rebase if it exists. (Implements: US-001)
- **FR-003**: System MUST execute pre-flight gate check per task. Gate already passing → skip with warning. Gate failing → proceed to implementation. (Implements: US-001, US-002)
- **FR-004**: System MUST orchestrate the full state machine: `BRANCH_SETUP → IMPLEMENT → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE`. (Implements: US-001)
- **FR-005**: System MUST dispatch code review (`review-code` workflow) and UAT review (`review-uat` workflow) after implementation. NO-GO → loop back to IMPLEMENT. (Implements: US-001)
- **FR-006**: System MUST create a GitHub PR via `gh pr create --base develop` after reviews pass, then wait for CI via `scripts/dev/wud-ci-wait.sh`. (Implements: US-001, US-006)
- **FR-007**: System MUST enforce circuit breaker via `--max-iterations` (default 3). Exceeded → exit 1, `CIRCUIT_BREAK` state persisted. (Implements: US-004)
- **FR-008**: System MUST persist state machine progress to `.runs/<feature>_p<phase>.state` as JSON after every stage transition. On restart, resume from last persisted stage. (Implements: US-005)
- **FR-009**: System MUST resolve agent backend from `.gwrkrc.json` `agents.implement` or `--agent` CLI override. (Implements: US-008)
- **FR-010**: System MUST create a timestamped log file in `.runs/` per run (machine-local, gitignored). (Implements: US-001)
- **FR-011**: System MUST record every agent dispatch in the SQLite execution ledger (`~/.gwrk/gwrk.db`). (Implements: US-001)
- **FR-012**: System MUST write an execution manifest to `specs/<feature>/.gwrk/runs/` per ADR-003 for every ship run. (Implements: US-007)
- **FR-013**: When phase argument is omitted, system MUST read all phases from `tasks.json` and ship each sequentially, exiting on first non-zero exit code. (Implements: US-003)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| tasks.json not found | `Task state file not found` | 1 |
| Phase not found | `Phase phase-NN not found` | 1 |
| work-until-done.sh missing | `ENOENT` | 1 |

#### FR-002 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Git merge conflict | `Conflict detected during develop merge` | 1 |
| Branch creation failed | `Failed to create feature branch` | 1 |

#### FR-003 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Gate already passes | `pre-flight PASS — gate already satisfied, skipping` | 0 (skip) |

#### FR-006 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| `gh` CLI not found | `gh CLI not found` | 2 |
| PR creation fails | `Failed to create PR` | 1 |
| CI timeout | `Timeout after` | 2 |

#### FR-007 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Circuit breaker | `Circuit breaker` | 1 |

#### FR-008 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Corrupt state file | `Corrupt state file` | 0 (auto-heal) |

#### FR-009 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Agent not configured | `Missing required config` | 1 |

---

## 5. Data Model Requirements

### DM-001: Ship Run State (`.runs/<feature>_p<phase>.state`)

Machine-local crash recovery state. Gitignored via `.runs/` in `.gitignore`.

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

Git-tracked structured JSON per run. See [ADR-003](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-003-state-contract.md). Schema defined in `src/utils/manifest.ts` (001-cli-core).

### DM-003: SQLite Execution Ledger (`runs` table)

Every ship dispatch recorded per [ADR-002](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-002-sqlite-execution-ledger.md):
- `command`: `"ship"`
- `workflow`: `"work-until-done"`
- `exit_code`, `duration_s`, `agent_backend`

---

## 6. Technical Constraints

- **TC-001**: Determinism — State machine transitions are deterministic. Same inputs → same state path.
- **TC-002**: Air-Gapped Engine — gwrk makes no direct network calls. External ops delegated to `gh`, `git` CLIs.
- **TC-003**: Fail-Fast Config — Zod validation with no `.default()` calls. Missing config → `process.exit(1)`.
- **TC-004**: Gate Integrity — Ship engine MUST NOT modify gate scripts.
- **TC-005**: Branch Isolation — Implementation on `feat/<feature>`, PRs target `develop`.
- **TC-006**: Crash Safety — State flushed to disk before every stage transition.
- **TC-007**: Shell Scripts ARE the Product — The TS layer adds SQLite recording, manifests, and UX. It does NOT reimplement orchestration.

---

## 7. Testing Requirements

- **TR-001**: `scripts/dev/work-until-done.sh` — Verify state machine transitions complete without unbound variables and handle non-zero agent exits. Shell E2E. (FR-004)
- **TR-002**: `scripts/dev/wud-branch.sh` — Verify branch creation from develop, checkout of existing, push with force-with-lease. Shell. (FR-002)
- **TR-003**: `scripts/dev/wud-verdict.sh` — Verify GO/NO-GO parsing from tasks.json. Shell. (FR-005)
- **TR-004**: `scripts/dev/wud-ci-wait.sh` — Verify CI wait, timeout handling, no-checks edge case. Shell. (FR-006)
- **TR-005**: `src/commands/ship.test.ts` — Verify ship CLI: single-phase dispatch, all-phases iteration, --max-iterations, --ci-timeout, dry-run, failure exit. Vitest. (FR-001, FR-011, FR-013)
- **TR-006**: `src/cli.e2e.test.ts` — Verify `gwrk ship --help` shows options, no stale subcommands. Vitest + CLI. (FR-001)
- **TR-007**: `src/scripts-e2e.test.ts` — E2E: work-until-done.sh invocation completes and handles agent failure. Vitest + Shell. (FR-004, FR-007)

---

## 8. Success Criteria

- **SC-001**: `gwrk ship <feature> <phase>` completes full lifecycle: branch → implement → review → PR → CI.
- **SC-002**: `gwrk ship <feature>` (no phase) ships all phases sequentially, stops on first failure.
- **SC-003**: Every agent dispatch is audit-ready in SQLite `runs` table and execution manifest.
- **SC-004**: Circuit breaker stops runaway loops. Crash recovery resumes from last stage.
- **SC-005**: `gwrk ship --help` shows `--dry-run`, `--max-iterations`, `--ci-timeout`, `--agent` and no subcommands.

---

## 9. Verification Requirements

- **VR-001**: E2E: Run `gwrk ship 004-ship-loop 1` against a test fixture → verify PR targeting `develop` → verify SQLite contains records for ship workflow → verify execution manifest in `.gwrk/runs/`.
- **VR-002**: Run `gwrk ship 004-ship-loop --dry-run` → verify all phases printed → verify no agent dispatched.
- **VR-003**: Run `gwrk ship --help` → verify output matches SC-005.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-002, FR-003, FR-004, FR-006, FR-011, FR-012 | FR-001 | US-001, US-003 | TR-005, TR-007 |
| US-002 | FR-003 | FR-002 | US-001 | TR-002 |
| US-003 | FR-001, FR-013 | FR-003 | US-001, US-002 | TR-005, TR-007 |
| US-004 | FR-007 | FR-004 | US-001 | TR-001, TR-007 |
| US-005 | FR-008 | FR-005 | US-001 | TR-001, TR-003 |
| US-006 | FR-006 | FR-006 | US-001, US-006 | TR-001, TR-004 |
| US-007 | FR-012 | FR-007 | US-004 | TR-001, TR-007 |
| US-008 | FR-009 | FR-008 | US-005 | TR-001, TR-007 |
| | | FR-009 | US-008 | TR-005 |
| | | FR-010 | US-001 | TR-001 |
| | | FR-011 | US-001 | TR-005 |
| | | FR-012 | US-007 | TR-005 |
| | | FR-013 | US-003 | TR-005 |
