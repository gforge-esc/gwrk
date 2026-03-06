---
type: implementation_plan
feature: 004-wud-loop
last_modified: "2026-03-05T11:12:20Z"
---

# Implementation Plan: 004 WUD Loop

**Branch**: `004-wud-loop` | **Date**: 2026-02-27 | **Spec**: [spec.md](./spec.md)

## Summary

Implements the autonomous "Work Until Done" loop as two gwrk CLI commands: `gwrk implement` (single-phase task execution) and `gwrk wud` (full lifecycle state machine with review gates, PR creation, CI gate, retry + escalation, and crash recovery). Both commands consume the task engine APIs defined in `001-cli-core` (`loadTaskState`, `nextTask`, `runGate`, `markTaskComplete`, `dispatchAgent`) and add no new shared types.

The plan is structured in 3 phases:
1. **Phase 1 — Implement Command**: The core task loop with branch management, pre-flight gate checks, agent dispatch, post-flight verification, and commit-per-task.
2. **Phase 2 — WUD State Machine**: The full lifecycle orchestrator wrapping implement with code review, UAT review, PR+CI, circuit breaker, and crash recovery.
3. **Phase 3 — CLI Registration + Integration**: Wire commands into `cli.ts`, add dry-run mode, and validate the full end-to-end flow.

**Dependency**: Phase 1 of this spec (`001-cli-core`) must be implemented first — specifically `src/utils/state.ts`, `src/utils/exec.ts`, `src/utils/agent.ts`, and `src/utils/config.ts`.

---

## Phases and File Structure

### Phase 1: Implement Command

Core `gwrk implement <feature> <phase>` command — branch setup, task iteration, pre-flight/post-flight gate execution, agent dispatch, and commit-per-task.

**Files (5):**
- `src/commands/implement.ts` (NEW: Commander command — loads tasks.json, iterates phase tasks, pre-flight gate, dispatch agent, post-flight gate, commit)
- `src/utils/branch.ts` (NEW: Branch management — create feat/<feature> from develop, checkout existing, merge latest develop)
- `src/utils/wud-state.ts` (NEW: WUD run state persistence — save/load `.runs/<feature>_p<phase>.state`, Zod schema for WudState)
- `src/utils/log.ts` (NEW: Timestamped WUD run logger — writes to `.runs/` log files)
- `src/commands/implement.test.ts` (NEW: Vitest unit tests for implement command)

**Requirements Addressed:** FR-001, FR-002, FR-003, FR-009, US-001, US-002, US-007, US-008, TC-001, TC-002, TC-004, TC-005, TC-006

**Dependencies:** 001-cli-core (task engine APIs)

**Contract Mapping:**
- `contracts/implement.md` → `executePhase()` → `src/commands/implement.ts`
- `contracts/implement.md` → `runPreFlight()` → `src/commands/implement.ts`
- `contracts/branch.md` → `ensureBranch()` → `src/utils/branch.ts`
- 001-cli-core `contracts/tasks.md` → `loadTaskState()`, `nextTask()`, `runGate()`, `markTaskComplete()` → consumed from `src/utils/state.ts`
- 001-cli-core `contracts/agent.md` → `dispatchAgent()` → consumed from `src/utils/agent.ts`
- 001-cli-core `contracts/config.md` → `loadConfig()` → consumed from `src/utils/config.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | Environment variables, config hygiene |
| `coding-style.md` | TypeScript conventions, no `.js` files |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/commands/implement.test.ts` | Mock execFile, verify task loop iterates all phase tasks, calls runGate pre/post, calls markTaskComplete |
| TR-002 | Unit | `src/commands/implement.test.ts` | Mock git commands, verify branch creation from develop and merge of existing |
| TR-003 | Unit | `src/commands/implement.test.ts` | Verify tasks skipped when pre-flight gate exits 0 (already passes) |
| TR-009 | Unit | `src/commands/implement.test.ts` | Verify agent backend resolved from .gwrkrc.json `agents.defaults.implement` |

#### Done When
- `npx vitest run src/commands/implement.test.ts` exits 0
- `npx tsc --noEmit` exits 0
- `grep -r 'loadTaskState\|nextTask\|runGate\|markTaskComplete' src/commands/implement.ts | wc -l` returns ≥ 4

---

### Phase 2: WUD State Machine

Full autonomous lifecycle: BRANCH_SETUP → IMPLEMENTING → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE with circuit breaker and crash recovery.

**Files (4):**
- `src/commands/wud.ts` (NEW: Commander command — state machine orchestrator, dispatches implement, review-code, review-uat, creates PR, waits for CI)
- `src/utils/pr.ts` (NEW: PR creation + CI wait — wraps `gh pr create`, `gh pr checks --watch`, `gh pr list`)
- `src/utils/verdict.ts` (NEW: Phase verdict checker — queries tasks.json to determine GO/NO-GO after review)
- `src/commands/wud.test.ts` (NEW: Vitest unit tests for WUD state machine)

**Requirements Addressed:** FR-004, FR-005, FR-006, FR-007, FR-008, FR-010, US-003, US-004, US-005, US-006, US-009, TC-007

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/wud.md` → `runWudLoop()` → `src/commands/wud.ts`
- `contracts/wud.md` → `saveWudState()` / `loadWudState()` → `src/utils/wud-state.ts` (Phase 1)
- `contracts/pr.md` → `createPR()` / `waitForCI()` → `src/utils/pr.ts`
- `contracts/verdict.md` → `checkPhaseVerdict()` → `src/utils/verdict.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | Environment variables, config hygiene |
| `coding-style.md` | TypeScript conventions |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-004 | Unit | `src/commands/wud.test.ts` | Mock all stages, verify state machine walks BRANCH_SETUP → IMPLEMENTING → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE |
| TR-005 | Unit | `src/commands/wud.test.ts` | Mock review NO-GO, verify loop back to IMPLEMENTING |
| TR-006 | Unit | `src/commands/wud.test.ts` | Mock `gh` CLI, verify PR created with --base develop, CI wait called |
| TR-007 | Unit | `src/commands/wud.test.ts` | Set MAX_ITERATIONS=1, mock perpetual NO-GO, verify CIRCUIT_BREAK state and exit 1 |
| TR-008 | Unit | `src/commands/wud.test.ts` | Write state file `{stage: "CODE_REVIEW"}`, call wud, verify resume from CODE_REVIEW |
| TR-010 | Unit | `src/commands/wud.test.ts` | Verify log file created in .runs/ with stage entries |

#### Done When
- `npx vitest run src/commands/wud.test.ts` exits 0
- `npx tsc --noEmit` exits 0
- `grep -c 'BRANCH_SETUP\|IMPLEMENTING\|CODE_REVIEW\|UAT_REVIEW\|PR_CI\|DONE' src/commands/wud.ts` returns ≥ 6

---

### Phase 3: CLI Registration + Integration

Wire `implement` and `wud` commands into `cli.ts`, add `--dry-run` flag, and validate end-to-end with integration smoke tests.

**Files (3):**
- `src/cli.ts` (MODIFY: Register `implement` and `wud` subcommands with Commander)
- `src/commands/implement.ts` (MODIFY: Add `--dry-run` flag support)
- `src/commands/wud.ts` (MODIFY: Add `--dry-run` flag support, add `--max-iterations` option)

**Requirements Addressed:** FR-001, FR-004, US-001, US-003, US-008, SC-001, SC-002, VR-001, VR-002

**Dependencies:** Phase 1, Phase 2

**Contract Mapping:**
- `cli.ts` → registers `implement` and `wud` commands from Phase 1/2 modules

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | CLI routing conventions |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Integration | Shell | `gwrk implement --help` exits 0, shows usage |
| TR-004 | Integration | Shell | `gwrk wud --help` exits 0, shows usage |

#### Done When
- `gwrk implement --help 2>&1 | grep -q 'implement <feature> <phase>'` exits 0
- `gwrk wud --help 2>&1 | grep -q 'wud <feature>'` exits 0
- `gwrk implement 004-wud-loop 1 --dry-run 2>&1 | grep -q 'DRY RUN'` exits 0
- `npx tsc --noEmit` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `TaskState` | `src/utils/state.ts` (001-cli-core) | `src/commands/implement.ts`, `src/utils/verdict.ts` |
| `Task` | `src/utils/state.ts` (001-cli-core) | `src/commands/implement.ts` |
| `GwrkConfig` | `src/utils/config.ts` (001-cli-core) | `src/commands/implement.ts`, `src/commands/wud.ts` |
| `DispatchOptions` | `src/utils/agent.ts` (001-cli-core) | `src/commands/implement.ts`, `src/commands/wud.ts` |
| `WudState` | `src/utils/wud-state.ts` (NEW) | `src/commands/wud.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

None — full coverage.

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | Phase 1 | Planned |
| US-002 | Phase 1 | Planned |
| US-003 | Phase 2 | Planned |
| US-004 | Phase 2 | Planned |
| US-005 | Phase 2 | Planned |
| US-006 | Phase 2 | Planned |
| US-007 | Phase 1 | Planned |
| US-008 | Phase 1 | Planned |
| US-009 | Phase 2 | Planned |
| FR-001 | Phase 1, 3 | Planned |
| FR-002 | Phase 1 | Planned |
| FR-003 | Phase 1 | Planned |
| FR-004 | Phase 2, 3 | Planned |
| FR-005 | Phase 2 | Planned |
| FR-006 | Phase 2 | Planned |
| FR-007 | Phase 2 | Planned |
| FR-008 | Phase 2 | Planned |
| FR-009 | Phase 1 | Planned |
| FR-010 | Phase 2 | Planned |
| TR-001 | Phase 1 | Planned |
| TR-002 | Phase 1 | Planned |
| TR-003 | Phase 1 | Planned |
| TR-004 | Phase 2 | Planned |
| TR-005 | Phase 2 | Planned |
| TR-006 | Phase 2 | Planned |
| TR-007 | Phase 2 | Planned |
| TR-008 | Phase 2 | Planned |
| TR-009 | Phase 1 | Planned |
| TR-010 | Phase 2 | Planned |
| TC-001 | Phase 1 | Planned |
| TC-002 | Phase 1 | Planned |
| TC-003 | Phase 3 | Planned |
| TC-004 | Phase 1 | Planned |
| TC-005 | Phase 1 | Planned |
| TC-006 | Phase 1 | Planned |
| TC-007 | Phase 2 | Planned |
| DM-001 | Phase 2 | Planned |
| DM-002 | Phase 1 | Planned |
| DM-003 | Phase 1 | Planned |
| SC-001 | Phase 3 | Planned |
| SC-002 | Phase 3 | Planned |
| SC-003 | Phase 2 | Planned |
| SC-004 | Phase 2 | Planned |
| VR-001 | Phase 3 | Planned |
| VR-002 | Phase 3 | Planned |
| VR-003 | Phase 2 | Planned |
| VR-004 | Phase 2 | Planned |
| VR-005 | Phase 3 | Planned |
