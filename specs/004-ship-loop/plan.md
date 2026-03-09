---
type: implementation_plan
feature: 004-ship-loop
last_modified: "2026-03-09T16:33:00Z"
---

# Implementation Plan: 004 Ship Loop

**Branch**: `004-ship-loop` | **Date**: 2026-03-09 | **Spec**: [spec.md](./spec.md)

## Summary

Hardens the `gwrk ship` command lifecycle. The core state machine already exists in shell scripts (`work-until-done.sh`, `wud-branch.sh`, `wud-verdict.sh`, `wud-ci-wait.sh`) and the TS CLI wrapper (`ship.ts`) already delegates to `work-until-done.sh`. This feature closes the remaining gaps: hardening the shell scripts for production use, adding integration tests, improving error reporting, and ensuring end-to-end lifecycle completion.

> **Architecture principle**: Shell scripts ARE the product. The TS layer adds SQLite recording, execution manifests (ADR-003), and CLI UX — it does NOT reimplement orchestration.

> **Status**: Work-until-done.sh state machine is functional. Shell helpers (branch, verdict, ci-wait) exist and pass basic testing. TS wrapper handles single-phase and all-phase dispatch. Gaps: hardened error paths, review agent integration, multi-agent dispatch context, E2E validation.

---

## Phases and File Structure

### Phase 1: Shell Script Hardening

Harden the existing shell scripts for production error paths, proper logging, and deterministic behavior.

**Files (4):**
- `scripts/dev/work-until-done.sh` (MODIFY: Improve error messages, ensure all stage transitions log to `.runs/`, validate required env vars upfront)
- `scripts/dev/wud-branch.sh` (MODIFY: Handle dirty working tree, stash/pop, merge conflict recovery)
- `scripts/dev/wud-verdict.sh` (MODIFY: Handle missing jq gracefully, validate tasks.json schema before parsing)
- `scripts/dev/wud-ci-wait.sh` (MODIFY: Add retries for transient `gh` failures, improve timeout messaging)

**Requirements Addressed:** FR-002, FR-004, FR-005, FR-006, FR-007, FR-008, FR-010, TC-001, TC-002, TC-005, TC-006

**Tests:**
- `src/scripts-e2e.test.ts` (MODIFY: Add error-path scenarios)

#### Done When
- `work-until-done.sh` runs without unbound variable errors in all code paths
- All error states from spec §3 produce correct stderr and exit codes
- `wud-branch.sh` handles dirty working trees without data loss
- `pnpm test` passes

---

### Phase 2: Review Agent Integration

Wire code review and UAT review dispatch into the state machine with proper verdict checking.

**Files (3):**
- `scripts/dev/work-until-done.sh` (MODIFY: Review stages dispatch via `agent-run.sh review-code` and `review-uat`, check verdict via `wud-verdict.sh`)
- `scripts/dev/agent-run.sh` (MODIFY: Add `review-code` and `review-uat` workflow support)
- `.agent/workflows/review-code.md` (NEW: Review code workflow template)

**Requirements Addressed:** FR-005, US-001, US-004

**Tests:**
- `src/scripts-e2e.test.ts` (MODIFY: Mock review stages, verify NO-GO → retry loop)

#### Done When
- `work-until-done.sh` dispatches code review and checks verdict
- NO-GO loops back to IMPLEMENT
- Circuit breaker fires after `MAX_ITERATIONS` exceeded
- `pnpm test` passes

---

### Phase 3: E2E Lifecycle Validation

Full end-to-end validation: `gwrk ship <feature> <phase>` completes the entire lifecycle and `gwrk ship <feature>` ships all phases.

**Files (2):**
- `src/commands/ship.test.ts` (MODIFY: Add integration-level tests with full lifecycle mock)
- `src/cli.e2e.test.ts` (MODIFY: Add `gwrk ship --help` verification, no stale subcommands)

**Requirements Addressed:** FR-001, FR-011, FR-012, FR-013, SC-001, SC-002, SC-003, SC-004, VR-001

**Tests:**
- `src/commands/ship.test.ts` — Single-phase full lifecycle, all-phases iteration, failure stops
- `src/cli.e2e.test.ts` — Help output, no `done` subcommand, `--ci-timeout` present

#### Done When
- `gwrk ship 004-ship-loop 1 --dry-run` prints the correct `work-until-done.sh` invocation
- `gwrk ship 004-ship-loop --dry-run` prints invocations for all phases
- `gwrk ship --help` shows options (no subcommands)
- All tests pass

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `TaskState` | `src/utils/state.ts` (001-cli-core) | `src/commands/ship.ts` |
| `GwrkConfig` | `src/utils/config.ts` (001-cli-core) | `src/commands/ship.ts` |
| `ExecutionManifest` | `src/utils/manifest.ts` (001-cli-core) | `src/commands/ship.ts` |

---

## Deferred Items

- `gwrk harvest` — build-server-side ETL of manifests into SQLite. Deferred to 002-build-server.
- `history.jsonl` removal — deferred until harvest is operational.

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
| SC-001 | Phase 3 | Planned |
| SC-002 | Phase 3 | Planned |
| SC-003 | Phase 3 | Planned |
| SC-004 | Phase 2 | Planned |
