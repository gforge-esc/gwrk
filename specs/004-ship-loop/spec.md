# Feature Specification: 004 Ship Loop

**Feature Branch**: `feat/004-ship-loop`
**Created**: 2026-02-27
**Revised**: 2026-03-14
**Status**: Settled
**Input**: The autonomous execution kernel for Pillar 3 (Shipping). `gwrk ship <feature> [phase]` orchestrates the complete phase lifecycle — branch creation, agent dispatch, code review, UAT review, PR creation, CI gate, retry with circuit breaking, crash recovery, staging validation, and execution manifest recording. Delegates to `scripts/dev/work-until-done.sh` as the phase orchestrator (state machine). Phase is optional — omitting it ships all phases sequentially, skipping completed ones.

> **Nomenclature**: "Ship loop" is the execution mechanism. "WUD" (Work Until Done) is the agent persona that operates the ship loop (architecture.md §2). The spec uses "ship loop" and "phase orchestrator" for the machinery, not "WUD."

> **Architectural anchors**: [ADR-003](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-003-state-contract.md) (two-tier state), [ADR-004](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-004-agent-native-output.md) (operational signals), [FOXTROT-CHARLIE](file:///Users/gonzo/Code/gwrk/docs/FOXTROT-CHARLIE.md) §Pillar 3, [architecture.md](file:///Users/gonzo/Code/gwrk/docs/architecture.md) §5.1/§6.2, [agent-native-cli.md](file:///Users/gonzo/Code/gwrk/docs/reference/agent-native-cli.md) §1.2

---

## 2. User Scenarios & Testing

### US-001 - Ship Single Phase (Priority: P0)
As a Principal Engineer, I want `gwrk ship <feature> <phase>` to run the full lifecycle for one phase: branch → implement → review → PR → CI.

**Implements**: FR-001, FR-002, FR-003, FR-004, FR-006, FR-011, FR-012, FR-016, FR-017

**Independent Test**: Run `gwrk ship` against a feature with prepared `tasks.json` and gate scripts; verify the full lifecycle completes with PR creation and execution manifest recording.

**Acceptance Scenarios**:
1. **Given** a feature `004-ship-loop` with `tasks.json` containing open tasks in phase-01 and passing gate scripts, **When** running `gwrk ship 004-ship-loop 1`, **Then**:
   - `jq '[.phases[] | select(.id == "phase-01") | .tasks[] | select(.status == "completed")] | length' specs/004-ship-loop/.gwrk/tasks.json` returns `>= 1`
   - `ls specs/004-ship-loop/.gwrk/runs/*.json | wc -l` returns `>= 1`
   - `jq -e '.runId and .feature and .phase and .durationS and .exitCode and .digest' specs/004-ship-loop/.gwrk/runs/*.json` exits 0
   - `gwrk db runs 004-ship-loop --json | jq '. | length'` returns `>= 1`

### US-002 - Hard Gate Pre-flight (Priority: P0)
As the ship engine, I want each task's gate to be checked before implementation begins, and tasks whose gates already pass are skipped.

**Implements**: FR-003

**Independent Test**: Mock a task whose gate already passes; verify the task is skipped with pre-flight PASS log.

**Acceptance Scenarios**:
1. **Given** a task T001 whose gate script already exits 0, **When** `gwrk ship 004-ship-loop 1` reaches T001, **Then**:
   - `grep -q 'pre-flight PASS.*T001' "$WUD_LOG"` exits 0
   - `grep -vc 'IMPLEMENT.*T001' "$WUD_LOG"` exits 0 (T001 not dispatched)

### US-003 - Ship All Phases (Priority: P0)
As a Principal Engineer, I want `gwrk ship <feature>` (no phase) to ship all phases sequentially, stopping on first failure.

**Implements**: FR-001, FR-013, FR-014

**Independent Test**: Run `gwrk ship` with `--dry-run` against a feature with 3 phases; verify all phase invocations are printed.

**Acceptance Scenarios**:
1. **Given** a feature with 3 phases in `tasks.json`, **When** running `gwrk ship 004-ship-loop --dry-run`, **Then**:
   - `gwrk ship 004-ship-loop --dry-run 2>&1 | grep -c 'DRY RUN'` outputs `3`
2. **Given** a feature with 3 phases where phase 2 fails, **When** running `gwrk ship 004-ship-loop`, **Then**:
   - Phase 3 is never attempted (no manifest for phase-03 in this run)
   - Exit code is non-zero

### US-004 - Circuit Breaker (Priority: P0)
As a Principal Engineer, I want the ship loop to stop after a configurable number of retry iterations.

**Implements**: FR-007, FR-018

**Independent Test**: Set `--max-iterations 1` and force review NO-GO; verify circuit-breaker exit.

**Acceptance Scenarios**:
1. **Given** `--max-iterations 1` and a review that always returns NO-GO, **When** running `gwrk ship 004-ship-loop 1 --max-iterations 1`, **Then**:
   - `echo $?` outputs non-zero
   - `grep -q 'Circuit breaker' "$WUD_LOG"` exits 0
   - `jq -r '.stage' .runs/004-ship-loop_p1.state` outputs `CIRCUIT_BREAK`

### US-005 - Crash Recovery (Priority: P1)
As the ship engine, I want the state machine to persist its stage to disk and resume on restart.

**Implements**: FR-008

**Independent Test**: Write a mid-run state file; restart ship; verify it resumes from the persisted stage.

**Acceptance Scenarios**:
1. **Given** a state file `.runs/004-ship-loop_p1.state` with `{"stage": "CODE_REVIEW", "iteration": 1}`, **When** running `gwrk ship 004-ship-loop 1`, **Then**:
   - `grep -q 'Resuming from state: CODE_REVIEW' "$WUD_LOG"` exits 0

### US-006 - PR Creation & CI Gate (Priority: P0)
As the ship engine, I want a PR created targeting `develop` after reviews pass, with CI checks awaited.

**Implements**: FR-006

**Independent Test**: Run ship to completion; verify PR exists targeting `develop`.

**Acceptance Scenarios**:
1. **Given** a completed phase with passing reviews, **When** ship creates a PR, **Then**:
   - `gh pr list --head feat/004-ship-loop --base develop --json number --jq '.[0].number'` returns a PR number
   - CI checks pass or `no checks` edge case is handled

### US-007 - Execution Manifest with Log Digest (Priority: P0)
As a Principal Engineer, I want every ship run to produce a git-tracked execution manifest with a log digest capturing the learning signal.

**Implements**: FR-012, FR-017

**Independent Test**: Run ship; verify manifest file exists with required fields including `digest[]`.

**Acceptance Scenarios**:
1. **Given** a completed ship run, **Then**:
   - `ls specs/004-ship-loop/.gwrk/runs/*.json | wc -l` returns `>= 1`
   - `jq -e '.runId and .feature and .phase and .exitCode and .durationS and .gitCommit and .digest' specs/004-ship-loop/.gwrk/runs/*.json` exits 0
   - `jq '.digest | length' specs/004-ship-loop/.gwrk/runs/*.json` returns `>= 1`

### US-008 - Agent Backend Config (Priority: P1)
As a Principal Engineer, I want the agent backend resolved from `.gwrkrc.json` with `--agent` override.

**Implements**: FR-009

**Independent Test**: Set `.gwrkrc.json agents.implement` to `gemini`; run ship; verify the configured agent is used.

**Acceptance Scenarios**:
1. **Given** `.gwrkrc.json` with `agents.implement: "gemini"`, **When** running `gwrk ship 004-ship-loop 1 --dry-run`, **Then**:
   - `gwrk ship 004-ship-loop 1 --dry-run 2>&1 | grep -q 'gemini'` exits 0
2. **Given** `--agent claude` override, **When** running `gwrk ship 004-ship-loop 1 --dry-run --agent claude`, **Then**:
   - `gwrk ship 004-ship-loop 1 --dry-run --agent claude 2>&1 | grep -q 'claude'` exits 0

### US-009 - Phase-Skip for Completed Phases (Priority: P0)
As a Principal Engineer, I want `gwrk ship <feature>` to skip phases where all tasks are already `completed` in `tasks.json`.

**Implements**: FR-014

**Independent Test**: Set all tasks in phase-01 to `completed`; run ship without phase arg; verify phase-01 is skipped.

**Acceptance Scenarios**:
1. **Given** a feature with 3 phases where phase-01 has all tasks `completed`, **When** running `gwrk ship <feature>`, **Then**:
   - `gwrk ship <feature> 2>&1 | grep -q 'Phase 01.*skipping'` exits 0
   - Phase 01 is never dispatched (no manifest for phase-01 from this run)

### US-010 - Staging Validation (Priority: P0)
As a Principal Engineer, I want the phase orchestrator to validate staged files before push, rejecting out-of-scope changes.

**Implements**: FR-016

**Independent Test**: Stage a file outside the feature scope; run staging validator; verify rejection.

**Acceptance Scenarios**:
1. **Given** staged files including `specs/000-build-plan.md`, **When** `validate-staging.sh` runs, **Then**:
   - Exit code is 1
   - stderr contains `Build plan staged` and `agents must not modify`
2. **Given** only in-scope files staged, **When** `validate-staging.sh` runs, **Then**:
   - Exit code is 0
   - Output contains `Staging validation passed`

### US-011 - Rip-Cord Bail on Circuit Break (Priority: P1)
As a Principal Engineer, I want the circuit breaker to produce structured failure context so I can diagnose what went wrong without reading raw logs.

**Implements**: FR-018

**Independent Test**: Force circuit break; verify state file contains failure context.

**Acceptance Scenarios**:
1. **Given** a circuit break triggered by max iterations, **Then**:
   - `.runs/<feature>_p<phase>.state` contains `"stage": "CIRCUIT_BREAK"` and `"failureContext"` object
   - `failureContext` contains: `openTasks`, `lastVerdict`, `iterationTimeline`, `digest`
   - `ls specs/<feature>/.gwrk/runs/*_FAIL.log | wc -l` returns `>= 1` (truncated raw log committed to git)

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

### Layer 1: TypeScript CLI (`ship.ts`)

- **FR-001**: System MUST provide `gwrk ship <feature> [phase]` that delegates to `scripts/dev/work-until-done.sh`. When phase is omitted, all phases from `tasks.json` are shipped sequentially, stopping on first failure. `shipPhase()` accepts `workDir` and `backend` overrides for composability with 005-parallel-dispatch. (Implements: US-001, US-003)
- **FR-009**: System MUST resolve agent backend hierarchically: (1) explicit `--agent` CLI override, (2) programmatic `backend` parameter from calling code, (3) fallback to `.gwrkrc.json agents.implement`. No graceful default — missing config → `process.exit(1)`. (Implements: US-008)
- **FR-011**: System MUST record every agent dispatch in the SQLite execution ledger (`~/.gwrk/gwrk.db` `runs` table) via `startRun()`/`finishRun()`. (Implements: US-001)
- **FR-012**: System MUST write an execution manifest to `specs/<feature>/.gwrk/runs/` per ADR-003 §3 for every ship run. Manifest includes `digest[]` array of structured log events per FR-017. (Implements: US-001, US-007)
- **FR-013**: When phase argument is omitted, system MUST read all phases from `tasks.json` and ship each sequentially, exiting on first non-zero exit code. (Implements: US-003)
- **FR-014**: When shipping all phases, system MUST check each phase's task states in `tasks.json` before dispatch. If ALL tasks in a phase have `status: "completed"` or `status: "cancelled"`, that phase MUST be skipped with log message `⏭  Phase NN: all tasks complete — skipping`. This check happens in `ship.ts` before calling the phase orchestrator. (Implements: US-009)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| tasks.json not found | `Task state file not found` | 1 |
| Phase not found | `Phase phase-NN not found` | 1 |
| work-until-done.sh missing | `ENOENT` | 1 |

#### FR-009 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Agent not configured | `Missing required config: agents.implement` | 1 |

### Layer 1: Phase Orchestrator (`work-until-done.sh`)

- **FR-002**: Phase orchestrator MUST create a `feat/<feature>` branch from current `develop` HEAD via `wud-branch.sh`. Dirty working tree → fail fast with `Dirty working tree — commit or stash before shipping`. (Implements: US-001)
- **FR-003**: Phase orchestrator MUST execute pre-flight gate check per task. Gate already passing → skip with `pre-flight PASS — gate already satisfied, skipping`. Gate failing → proceed to implementation. (Implements: US-001, US-002)
- **FR-004**: Phase orchestrator MUST implement the state machine: `BRANCH_SETUP → IMPLEMENT → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE`. Each transition persists state to disk. (Implements: US-001)
- **FR-005**: Phase orchestrator MUST dispatch code review (`review-code` workflow) and UAT review (`review-uat` workflow) after implementation. NO-GO → increment iteration, loop back to IMPLEMENT. (Implements: US-001)
- **FR-006**: Phase orchestrator MUST create a GitHub PR via `gh pr create --base develop` after reviews pass, then wait for CI via `wud-ci-wait.sh`. (Implements: US-001, US-006)
- **FR-007**: Phase orchestrator MUST enforce circuit breaker via `MAX_ITERATIONS` env var (default 3). Exceeded → exit 1, `CIRCUIT_BREAK` state persisted. (Implements: US-004)
- **FR-008**: Phase orchestrator MUST persist state machine progress to `.runs/<feature>_p<phase>.state` as JSON after every stage transition. On restart, resume from last persisted stage. (Implements: US-005)
- **FR-010**: Phase orchestrator MUST create a timestamped log file in `.runs/` per run (machine-local, gitignored). (Implements: US-001)
- **FR-016**: Phase orchestrator MUST run `scripts/dev/validate-staging.sh <feature>` after agent completes, before push. Validator rejects: out-of-scope files, orphan spec dirs, build plan modifications (Design Mandate Rule 3). Validation failure → re-run agent with corrective guidance. (Implements: US-010)
- **FR-017**: Phase orchestrator logging has three tiers: (a) Raw log — full agent output to `.runs/*.log`, machine-local, gitignored per ADR-003 §5. (b) **Log digest** — the orchestrator emits structured stage events to a sidecar file (`.runs/<feature>_p<phase>.events`). On completion, events are concatenated into the `digest[]` array in the execution manifest. Digest is git-tracked, surviving merge and machine change. Events use format: `<STAGE>: <outcome summary>`. (c) SQLite — harvested post-merge by build server via `gwrk harvest` (ADR-003 §4). **Exception**: On `CIRCUIT_BREAK`, the last 500 lines of raw log are committed to `specs/<feature>/.gwrk/runs/<timestamp>_FAIL.log` alongside the manifest. This ensures diagnostic evidence survives ephemeral VMs (Codex Cloud) and machine changes. (Implements: US-001, US-007, US-011)
- **FR-018**: On `CIRCUIT_BREAK`, phase orchestrator MUST: (1) write structured failure context to state file: `{ failureContext: { openTasks: [...], lastVerdict: "NO-GO", iterationTimeline: [...], digest: [...] } }`, (2) commit truncated raw log (last 500 lines) to `specs/<feature>/.gwrk/runs/<timestamp>_FAIL.log` for post-mortem diagnosis. Exit 1. (Implements: US-011)

#### FR-002 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Dirty working tree | `Dirty working tree — commit or stash before shipping` | 1 |
| Branch creation failed | `Failed to create feature branch` | 1 |
| Sync produces merge conflict | `Conflict during develop sync — resolve manually` | 1 |

#### FR-003 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Gate already passes | `pre-flight PASS — gate already satisfied, skipping` | 0 (skip) |

#### FR-006 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| `gh` CLI not found | `gh CLI not found — install: https://cli.github.com` | 2 |
| PR creation fails | `Failed to create PR` | 1 |
| CI timeout | `CI timeout after N minutes` | 2 |

#### FR-007 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Circuit breaker | `Circuit breaker tripped after N iterations` | 1 |

#### FR-008 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Corrupt state file | `Corrupt state file — starting fresh` | 0 (auto-heal) |

#### FR-014 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| tasks.json missing | Falls through to FR-001 | 1 |
| Mixed open/completed | Proceeds normally (not skipped) | 0 |

#### FR-016 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Out-of-scope files staged | `Staging validation FAILED` + specific violations | 1 |
| Build plan staged | `agents must not modify the build plan (Rule 3)` | 1 |

### Loop-Closing Contract

> Ship loop produces git-tracked execution manifests (ADR-003 Tier 1). `gwrk harvest` (build server, F002) consumes them post-merge into SQLite (ADR-003 Tier 2). This spec defines the manifest schema. The build server spec defines the harvest. See ADR-003 §4.

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
  "startedAt": "2026-03-09T14:02:33Z",
  "runId": "uuid-v4",
  "backend": "gemini",
  "failureContext": null
}
```

On `CIRCUIT_BREAK`, `failureContext` is populated:
```json
{
  "failureContext": {
    "openTasks": ["T003", "T005"],
    "lastVerdict": "NO-GO",
    "iterationTimeline": [
      { "iteration": 1, "stage": "UAT_REVIEW", "verdict": "NO-GO", "durationS": 342 },
      { "iteration": 2, "stage": "CODE_REVIEW", "verdict": "NO-GO", "durationS": 287 }
    ],
    "digest": ["IMPLEMENT: agent exited 0, 4 files changed", "CODE_REVIEW: NO-GO — test failures in ship.test.ts"]
  }
}
```

### DM-002: Execution Manifest (`specs/<feature>/.gwrk/runs/*.json`)

Git-tracked structured JSON per run. Per ADR-003 §3. Extended with `digest[]`:

```json
{
  "runId": "2026-03-14T14:02:33Z_ship_p01_gemini",
  "feature": "004-ship-loop",
  "phase": "phase-01",
  "command": "ship",
  "agent": "gemini",
  "startedAt": "2026-03-14T14:02:33Z",
  "finishedAt": "2026-03-14T14:18:02Z",
  "durationS": 929,
  "exitCode": 0,
  "attempt": 1,
  "gateResult": "PASS",
  "reviewVerdict": "GO",
  "filesChanged": 4,
  "linesAdded": 127,
  "linesDeleted": 33,
  "gitCommit": "abc1234",
  "gitBranch": "feat/004-ship-loop",
  "digest": [
    "BRANCH_SETUP: created feat/004-ship-loop from develop (0.3s)",
    "IMPLEMENT: gemini completed, 4 files changed, gates 3/5 passing",
    "CODE_REVIEW: GO — all assertions satisfied",
    "UAT_REVIEW: GO — acceptance criteria met",
    "PR_CI: PR #42 created, CI passed (2m14s)"
  ]
}
```

File naming: `<ISO-timestamp>_<command>_<phase>_<agent>.json`

### DM-003: SQLite Execution Ledger (`runs` table)

Per ADR-002: `command: "ship"`, `workflow: "work-until-done"`, `exit_code`, `duration_s`, `agent_backend`. Populated by `ship.ts` via `startRun()`/`finishRun()`.

---

## 6. Technical Constraints

- **TC-001**: Air-Gapped — No external network calls at runtime. External ops delegated to `gh`, `git` CLIs.
- **TC-002**: Fail-Fast Config — Zod validation with no `.default()` calls. Missing config → `process.exit(1)`.
- **TC-003**: TypeScript Only — No `.js` or `.jsx` in `src/`. ESM modules, ES2022 target.
- **TC-004**: Gate Integrity — Ship engine MUST NOT modify gate scripts.
- **TC-005**: Branch Isolation — Implementation on `feat/<feature>`, PRs target `develop`.
- **TC-006**: Crash Safety — State flushed to disk before every stage transition.
- **TC-007**: Shell Scripts ARE the Product — The TS layer adds SQLite recording, manifests, and UX. It does NOT reimplement orchestration.
- **TC-008**: Staging Scope — `validate-staging.sh` MUST reject files outside the feature's expected scope (Design Mandate Rules 3+5).

---

## 7. Testing Requirements

- **TR-001**: `src/scripts-e2e.test.ts` — Verify work-until-done.sh completes without unbound variables, handles non-zero agent exit, respects `MAX_ITERATIONS`. Vitest + Shell E2E. (FR-004, FR-007)
- **TR-002**: `scripts/dev/wud-branch.sh` validation — Verify branch creation from develop, checkout existing, dirty-tree rejection. Shell. (FR-002)
- **TR-003**: `scripts/dev/wud-verdict.sh` validation — Verify GO when all tasks completed, NO-GO when open tasks remain. Shell. (FR-005)
- **TR-004**: `scripts/dev/wud-ci-wait.sh` validation — Verify CI wait completes, timeout returns exit 2, no-checks edge case passes. Shell. (FR-006)
- **TR-005**: `src/commands/ship.test.ts` — Verify ship CLI: single-phase dispatch, all-phases iteration, `--max-iterations`, `--ci-timeout`, `--dry-run`, failure exit, phase-skip. Vitest. (FR-001, FR-011, FR-013, FR-014)
- **TR-006**: `src/cli.e2e.test.ts` — Verify `gwrk ship --help` shows `--dry-run`, `--max-iterations`, `--ci-timeout`, `--agent`, and no stale subcommands. Vitest + CLI. (FR-001)
- **TR-007**: `src/scripts-e2e.test.ts` — E2E: full lifecycle invocation with structured manifest output, retry on failure. Vitest + Shell. (FR-004, FR-007, FR-012, FR-017)
- **TR-008**: `scripts/dev/validate-staging.sh` validation — Verify rejection of out-of-scope files, build plan protection, orphan detection. Shell. (FR-016)

---

## 8. Success Criteria

- **SC-001**: `gwrk ship <feature> <phase>` completes full lifecycle: branch → implement → review → PR → CI.
- **SC-002**: `gwrk ship <feature>` (no phase) ships all phases sequentially, stops on first failure, skips completed phases.
- **SC-003**: Every agent dispatch is audit-ready in SQLite `runs` table and git-tracked execution manifest with `digest[]`.
- **SC-004**: Circuit breaker stops runaway loops. Crash recovery resumes from last stage. Rip-cord bail produces structured failure context.
- **SC-005**: `gwrk ship --help` shows `--dry-run`, `--max-iterations`, `--ci-timeout`, `--agent` and type classification `mutator`.
- **SC-006**: Staging validator rejects out-of-scope files and build plan modifications.

---

## 9. Verification Requirements

- **VR-001**: E2E: Run `gwrk ship 004-ship-loop 1` → verify execution manifest in `.gwrk/runs/` with `digest[]` → verify SQLite records → verify PR targeting `develop`.
- **VR-002**: Run `gwrk ship 004-ship-loop --dry-run` → verify all phases printed → verify no agent dispatched.
- **VR-003**: Run `gwrk ship --help` → verify output matches SC-005.
- **VR-004**: Run `validate-staging.sh` with out-of-scope files → verify rejection → run with clean scope → verify pass.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001,002,003,004,006,011,012,016,017 | FR-001 | US-001, US-003 | TR-005, TR-007 |
| US-002 | FR-003 | FR-002 | US-001 | TR-002 |
| US-003 | FR-001, FR-013, FR-014 | FR-003 | US-001, US-002 | TR-005, TR-007 |
| US-004 | FR-007, FR-018 | FR-004 | US-001 | TR-001, TR-007 |
| US-005 | FR-008 | FR-005 | US-001 | TR-001, TR-003 |
| US-006 | FR-006 | FR-006 | US-001, US-006 | TR-001, TR-004 |
| US-007 | FR-012, FR-017 | FR-007 | US-004 | TR-001, TR-007 |
| US-008 | FR-009 | FR-008 | US-005 | TR-001, TR-007 |
| US-009 | FR-014 | FR-009 | US-008 | TR-005 |
| US-010 | FR-016 | FR-010 | US-001 | TR-001 |
| US-011 | FR-018 | FR-011 | US-001 | TR-005 |
| | | FR-012 | US-001, US-007 | TR-005, TR-007 |
| | | FR-013 | US-003 | TR-005 |
| | | FR-014 | US-009 | TR-005 |
| | | FR-016 | US-010 | TR-008 |
| | | FR-017 | US-001, US-007 | TR-007 |
| | | FR-018 | US-004, US-011 | TR-001 |
