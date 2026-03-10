# Implementation Plan: 004 Ship Loop

**Branch**: `004-ship-loop` | **Date**: 2026-03-09 | **Spec**: [spec.md](./spec.md)

## Summary

Hardens the `gwrk ship` command lifecycle for production readiness. The core architecture already exists:

- **Shell state machine**: `work-until-done.sh` orchestrates BRANCH_SETUP → IMPLEMENT → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE
- **Shell helpers**: `wud-branch.sh` (branch management), `wud-verdict.sh` (GO/NO-GO), `wud-ci-wait.sh` (PR check wait)
- **TS CLI wrapper**: `src/commands/ship.ts` delegates to `work-until-done.sh`, adds SQLite recording, manifests, config validation

This plan closes the remaining gaps: hardening shell error paths, wiring review agent dispatch, and validating the full E2E lifecycle.

**Dependency**: 001-cli-core Phase 1-9 must be complete. Specifically: `src/utils/state.ts` (task state), `src/utils/exec.ts` (shell runner), `src/utils/config.ts` (config loader), `src/utils/manifest.ts` (execution manifests), `src/db/runs.ts` (SQLite recording).

---

## Phases and File Structure

### Phase 1: Shell Script Hardening

Harden existing shell scripts for production error paths, deterministic behavior, and proper logging.

**Files (4):**
- `scripts/dev/work-until-done.sh` (MODIFY: Validate required env vars upfront, ensure all stage transitions log to `.runs/`, improve error messages for each FR error state)
- `scripts/dev/wud-branch.sh` (MODIFY: Handle dirty working tree via stash/pop, improve merge conflict error reporting)
- `scripts/dev/wud-verdict.sh` (MODIFY: Handle missing jq gracefully, validate tasks.json structure before parsing)
- `scripts/dev/wud-ci-wait.sh` (MODIFY: Add retries for transient `gh` failures, improve timeout messaging)

**Requirements Addressed:** FR-002, FR-003, FR-004, FR-005, FR-007, FR-008, FR-010, US-001, US-002, US-004, US-005, TC-001, TC-002, TC-004, TC-005, TC-006

**Dependencies:** 001-cli-core (complete)

**Contract Mapping:**
- `contracts/ship.md` → `work-until-done.sh` state machine → `scripts/dev/work-until-done.sh`
- `contracts/branch.md` → `wud-branch.sh` branch ops → `scripts/dev/wud-branch.sh`
- `contracts/verdict.md` → `wud-verdict.sh` GO/NO-GO → `scripts/dev/wud-verdict.sh`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | Environment variables, fail-fast config |
| `.agent/rules/operating-model.md` | RAGB status tracking |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Shell E2E | `src/scripts-e2e.test.ts` | work-until-done.sh completes without unbound variables; handles non-zero agent exit |
| TR-002 | Shell | `scripts/dev/wud-branch.sh` | Branch creation from develop; checkout existing; push with force-with-lease |
| TR-003 | Shell | `scripts/dev/wud-verdict.sh` | GO when all tasks completed; NO-GO when open tasks remain; error on missing jq |
| TR-004 | Shell | `scripts/dev/wud-ci-wait.sh` | CI wait completes; timeout returns exit 2; no-checks edge case passes |

#### Done When
- `bash -n scripts/dev/work-until-done.sh` exits 0 (no syntax errors)
- `bash -n scripts/dev/wud-branch.sh` exits 0
- `bash -n scripts/dev/wud-verdict.sh` exits 0
- `bash -n scripts/dev/wud-ci-wait.sh` exits 0
- `pnpm test -- --reporter=dot 2>&1 | grep -q 'Tests.*passed'` exits 0 (no regressions)
- All FR error states from spec §4 produce correct stderr and exit codes

---

### Phase 2: Review Agent Integration

Wire code review and UAT review dispatch into the state machine with verdict checking and retry loop.

**Files (3):**
- `scripts/dev/work-until-done.sh` (MODIFY: CODE_REVIEW and UAT_REVIEW stages dispatch via `agent-run.sh review-code` and `review-uat`, check verdict via `wud-verdict.sh`, loop on NO-GO)
- `scripts/dev/agent-run.sh` (MODIFY: Add `review-code` and `review-uat` workflow support with proper agent backend resolution)
- `.agent/workflows/review-code.md` (NEW: Review code workflow instructions for agent dispatch)

**Requirements Addressed:** FR-005, FR-007, US-001, US-004, US-006, TC-001

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/ship.md` → CODE_REVIEW/UAT_REVIEW stages → `scripts/dev/work-until-done.sh`
- `contracts/verdict.md` → `wud-verdict.sh` → post-review GO/NO-GO check

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | Agent configuration, environment variables |
| `.agent/rules/operating-model.md` | Review agent personas |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Shell E2E | `src/scripts-e2e.test.ts` | State machine transitions through review stages |
| TR-007 | Shell E2E | `src/scripts-e2e.test.ts` | Circuit breaker fires after MAX_ITERATIONS on perpetual NO-GO |

#### Done When
- `grep -c 'review-code\|review-uat' scripts/dev/work-until-done.sh` returns `>= 2`
- `grep -c 'wud-verdict' scripts/dev/work-until-done.sh` returns `>= 1`
- `pnpm test -- --reporter=dot 2>&1 | grep -q 'Tests.*passed'` exits 0

---

### Phase 3: E2E Lifecycle Validation

Full end-to-end validation of `gwrk ship` — single phase, all phases, help output, and SQLite recording.

**Files (3):**
- `src/commands/ship.test.ts` (MODIFY: Add lifecycle-level tests with full mock, verify all-phases iteration, verify manifest writing)
- `src/cli.e2e.test.ts` (MODIFY: Verify `gwrk ship --help` shows options, no stale subcommands like `done`)
- `src/scripts-e2e.test.ts` (MODIFY: Add full lifecycle E2E with mock agent backends)

**Requirements Addressed:** FR-001, FR-011, FR-012, FR-013, SC-001, SC-002, SC-003, SC-004, SC-005, VR-001, VR-002, VR-003, US-003, US-007, US-008

**Dependencies:** Phase 1, Phase 2

**Contract Mapping:**
- `contracts/ship.md` → `shipPhase()` → `src/commands/ship.ts`
- `contracts/ship.md` → `shipCommand` → `src/commands/ship.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | Test expectations, CLI routing |
| `.agent/rules/operating-model.md` | RAGB for verification |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit | `src/commands/ship.test.ts` | Single-phase dispatch, all-phases iteration, --max-iterations, --ci-timeout, dry-run, failure exit |
| TR-006 | E2E | `src/cli.e2e.test.ts` | `gwrk ship --help` shows options, no `done` subcommand |
| TR-007 | E2E | `src/scripts-e2e.test.ts` | Full lifecycle invocation completes, handles failure |

#### Done When
- `gwrk ship 004-ship-loop 1 --dry-run 2>&1 | grep -q 'DRY RUN'` exits 0
- `gwrk ship 004-ship-loop --dry-run 2>&1 | grep -c 'DRY RUN'` returns number equal to phase count
- `gwrk ship --help 2>&1 | grep -q '\-\-ci-timeout'` exits 0
- `gwrk ship --help 2>&1 | grep -qv 'done'` exits 0 (no stale subcommand)
- `npx tsc --noEmit` exits 0
- `pnpm test -- --reporter=dot 2>&1 | grep -q 'Tests.*passed'` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `TaskState` | `src/utils/state.ts` (001-cli-core) | `src/commands/ship.ts` |
| `GwrkConfig` | `src/utils/config.ts` (001-cli-core) | `src/commands/ship.ts` |
| `ExecutionManifest` | `src/utils/manifest.ts` (001-cli-core) | `src/commands/ship.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| `gwrk harvest` | Manifest ETL into SQLite | Build-server-side; depends on 002-build-server | 002-build-server |
| `history.jsonl` removal | Remove deprecated file | Blocked until harvest is operational | 002-build-server |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | Phase 1, 2, 3 | Planned |
| US-002 | Phase 1 | Planned |
| US-003 | Phase 3 | Planned |
| US-004 | Phase 2 | Planned |
| US-005 | Phase 1 | Planned |
| US-006 | Phase 2 | Planned |
| US-007 | Phase 3 | Planned |
| US-008 | Phase 3 | Planned |
| FR-001 | Phase 3 | Planned |
| FR-002 | Phase 1 | Planned |
| FR-003 | Phase 1 | Planned |
| FR-004 | Phase 1 | Planned |
| FR-005 | Phase 2 | Planned |
| FR-006 | Phase 2 | Planned |
| FR-007 | Phase 2 | Planned |
| FR-008 | Phase 1 | Planned |
| FR-009 | Phase 1 | Planned |
| FR-010 | Phase 1 | Planned |
| FR-011 | Phase 3 | Planned |
| FR-012 | Phase 3 | Planned |
| FR-013 | Phase 3 | Planned |
| TR-001 | Phase 1 | Planned |
| TR-002 | Phase 1 | Planned |
| TR-003 | Phase 1 | Planned |
| TR-004 | Phase 1 | Planned |
| TR-005 | Phase 3 | Planned |
| TR-006 | Phase 3 | Planned |
| TR-007 | Phase 2, 3 | Planned |
| TC-001 | Phase 1 | Planned |
| TC-002 | Phase 1 | Planned |
| TC-003 | Phase 1 | Planned |
| TC-004 | Phase 1 | Planned |
| TC-005 | Phase 1 | Planned |
| TC-006 | Phase 1 | Planned |
| TC-007 | Phase 1, 2, 3 | Planned |
| DM-001 | Phase 1 | Planned |
| DM-002 | Phase 3 | Planned |
| DM-003 | Phase 3 | Planned |
| SC-001 | Phase 3 | Planned |
| SC-002 | Phase 3 | Planned |
| SC-003 | Phase 3 | Planned |
| SC-004 | Phase 2 | Planned |
| SC-005 | Phase 3 | Planned |
| VR-001 | Phase 3 | Planned |
| VR-002 | Phase 3 | Planned |
| VR-003 | Phase 3 | Planned |
