# Implementation Plan: 004 Ship Loop

**Branch**: `feat/004-ship-loop` | **Date**: 2026-03-14 | **Spec**: [spec.md](./spec.md)

## Summary

The ship loop implements Pillar 3's autonomous execution kernel. The core machinery (ship.ts, work-until-done.sh, support scripts) is **~80% functional** from prior work. This plan addresses the **remaining delta**: structured log digest system, phase-skip logic in ship.ts, rip-cord bail on circuit break, staging validator integration in the orchestrator, and spec-level artifact alignment.

Three phases:
1. **Digest & Phase-Skip** — Structured event sidecar, digest assembly in manifest, phase-skip logic (FR-014, FR-017)
2. **Resilience & Bail** — Rip-cord bail on circuit break, staging validator integration in WUD, dirty-tree fail-fast (FR-002, FR-016, FR-018)
3. **Verification & Artifacts** — Tests, gate validation, contracts, spec artifacts (TR-001→TR-008)

---

## Phases and File Structure

### Phase 1: Digest & Phase-Skip

Implement the structured log digest system (FR-017) and phase-skip logic (FR-014). The digest system uses a sidecar `.events` file rather than parsing raw agent output.

**Files (4):**
- `scripts/dev/work-until-done.sh` (MODIFY: add `emit_event()` function that writes structured stage events to `.runs/<feature>_p<phase>.events` sidecar file. Call after each stage transition.)
- `src/commands/ship.ts` (MODIFY: add phase-skip logic — check `tasks.json` for phases where all tasks are `completed` or `cancelled`, skip with log message. Add digest assembly — read `.events` sidecar, write to `digest[]` in manifest.)
- `src/utils/manifest.ts` (MODIFY: add `digest: string[]` to manifest schema and `assembleDigest()` function that reads sidecar events file.)
- `src/commands/ship.test.ts` (MODIFY: add tests for phase-skip and digest assembly.)

**Requirements Addressed:** FR-014, FR-017, US-007, US-009, TC-007

**Dependencies:** None (Phase 1 is independent)

**Contract Mapping:**
- `contracts/ship.md` → `skipCompletedPhases()` → `src/commands/ship.ts`
- `contracts/implement.md` → `emit_event()` → `scripts/dev/work-until-done.sh`

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit | `ship.ts` | Phase with all completed tasks is skipped |
| TR-005 | Unit | `ship.ts` | Phase with cancelled + completed tasks is skipped |
| TR-005 | Unit | `ship.ts` | Phase with mixed open/completed is NOT skipped |
| TR-007 | E2E | `scripts-e2e.test.ts` | Manifest contains non-empty `digest[]` |

#### Done When
- `pnpm vitest run src/commands/ship.test.ts` exits 0 with phase-skip tests
- `jq -e '.digest | length > 0'` on a test manifest exits 0

---

### Phase 2: Resilience & Bail

Wire the rip-cord bail (FR-018), integrate staging validator into WUD (FR-016), and enforce dirty-tree fail-fast (FR-002).

**Files (3):**
- `scripts/dev/work-until-done.sh` (MODIFY: add `emit_event "CIRCUIT_BREAK: ..."` on circuit break. Add `failureContext` JSON to state file on CIRCUIT_BREAK. Add `validate-staging.sh` call after IMPLEMENT stage, before push. Add dirty-tree check at startup with fail-fast.)
- `scripts/dev/wud-branch.sh` (MODIFY: verify dirty-tree check emits correct error message per FR-002.)
- `src/scripts-e2e.test.ts` (MODIFY: add test for circuit-breaker state file containing `failureContext`.)

**Requirements Addressed:** FR-002, FR-016, FR-018, US-004, US-010, US-011

**Dependencies:** Phase 1 (uses `emit_event()`)

**Contract Mapping:**
- `contracts/branch.md` → dirty-tree → abort with message → `wud-branch.sh`
- `contracts/implement.md` → staging validation → `validate-staging.sh`

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | E2E | `scripts-e2e.test.ts` | Circuit break produces state file with `failureContext` |
| TR-002 | Shell | `wud-branch.sh` | Dirty tree exits 1 with correct message |
| TR-008 | Shell | `validate-staging.sh` | Out-of-scope files rejected |

#### Done When
- `jq -e '.failureContext.openTasks' .runs/test_p1.state` exits 0 (on test data)
- `validate-staging.sh` rejects out-of-scope files → exit 1
- `wud-branch.sh` on dirty tree → exit 1, stderr contains `Dirty working tree`

---

### Phase 3: Verification & Artifacts

Run all gate scripts, verify full test suite, write contracts, update spec-level artifacts.

**Files (8):**
- `specs/004-ship-loop/contracts/ship.md` (MODIFY: update with phase-skip, digest assembly, manifest schema)
- `specs/004-ship-loop/contracts/implement.md` (MODIFY: update with emit_event, staging validation)
- `specs/004-ship-loop/contracts/branch.md` (MODIFY: document dirty-tree fail-fast)
- `specs/004-ship-loop/contracts/verdict.md` (VERIFY: ensure GO/NO-GO format matches FR-005)
- `specs/004-ship-loop/contracts/wud.md` (MODIFY: update state machine diagram with CIRCUIT_BREAK → failureContext)
- `specs/004-ship-loop/contracts/pr.md` (VERIFY: PR creation and CI wait contract)
- `specs/004-ship-loop/gap-analysis.md` (REWRITE: reflect current state)
- `specs/004-ship-loop/checklists/requirements.md` (REWRITE: against new spec)

**Requirements Addressed:** All FRs verified, TR-001→TR-008 validated

**Dependencies:** Phase 1, Phase 2

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001→TR-008 | All | All targets | Full test suite passes |

#### Done When
- `pnpm test` exits 0 (full suite)
- `pnpm build` exits 0
- All gate scripts in `specs/004-ship-loop/gates/` exit 0
- All contracts reflect current implementation

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `TaskState` | `src/utils/state.ts` | `ship.ts`, `tasks.ts` |
| `AgentBackend` | `src/utils/config.ts` | `ship.ts`, `dispatch.ts`, `agent-run.sh` |
| `RunManifest` | `src/utils/manifest.ts` | `ship.ts`, `gwrk harvest` (future) |
| `ShipRunState` | `.runs/*.state` (JSON) | `work-until-done.sh`, `ship.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| FR-006 (partial) | PR dedup (update vs create) | Edge case, low frequency | F004v2 |
| `gwrk harvest` | SQLite manifest harvesting | Build server concern, not ship concern | F002 Phase 4 |
| Review verdict pinning | Pin verdict format in contract | Low risk currently | F004v2 |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| FR-001 (ship command) | — | ✅ Done (ship.ts exists, 389 lines) |
| FR-002 (branch + dirty-tree) | Phase 2 | 🔲 dirty-tree fail-fast needed |
| FR-003 (pre-flight gates) | — | ✅ Done (WUD has pre-flight) |
| FR-004 (state machine) | — | ✅ Done (WUD 600 lines) |
| FR-005 (review dispatch) | — | ✅ Done (WUD has review stages) |
| FR-006 (PR + CI) | — | ✅ Done (WUD creates PR, CI wait) |
| FR-007 (circuit breaker) | — | ✅ Done (WUD MAX_ITERATIONS) |
| FR-008 (crash recovery) | — | ✅ Done (WUD save/load_state) |
| FR-009 (agent config) | — | ✅ Done (ship.ts config resolution) |
| FR-010 (timestamped log) | — | ✅ Done (WUD creates .runs/ log) |
| FR-011 (SQLite recording) | — | ✅ Done (ship.ts startRun/finishRun) |
| FR-012 (execution manifest) | — | ✅ Done (manifest.ts, 100 lines) |
| FR-013 (all-phases sequential) | — | ✅ Done (ship.ts iterates phases) |
| FR-014 (phase skip) | Phase 1 | 🔲 Need to add completed/cancelled check |
| FR-016 (staging validator) | Phase 2 | 🔲 Need to integrate into WUD |
| FR-017 (log digest) | Phase 1 | 🔲 Need emit_event + digest assembly |
| FR-018 (rip-cord bail) | Phase 2 | 🔲 Need failureContext on circuit break |
