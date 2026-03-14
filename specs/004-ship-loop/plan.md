# Implementation Plan: 004 Ship Loop

**Branch**: `feat/004-ship-loop` | **Date**: 2026-03-14 | **Spec**: [spec.md](./spec.md)

## Summary

The ship loop implements Pillar 3's autonomous execution kernel (Foxtrot Charlie: Shipping → Throughput). Core machinery (ship.ts, work-until-done.sh, support scripts) is ~80% functional. This plan addresses the remaining delta: structured log digest system with full log git-tracking, phase-skip logic, rip-cord bail on circuit break, and staging validator integration.

Three phases, 12 tasks, ≤5 file changes per phase:
1. **Digest & Phase-Skip** — Structured event sidecar, digest assembly, log rehoming, phase-skip logic
2. **Resilience & Bail** — Rip-cord bail, staging validator integration, dirty-tree fail-fast
3. **Verification & Artifacts** — Contracts, gap analysis, full suite

---

## Phases and File Structure

### Phase 1: Digest & Phase-Skip

Implement the structured log digest system (FR-017), phase-skip logic (FR-014), pre-flight gate check (FR-003), and log rehoming (FR-010). FR-017 git-tracks ALL raw logs to `specs/<feature>/.gwrk/runs/` (ADR-003 §5 updated: measured 10KB avg, 115KB max). Digest serves as a quick index into full logs.

**Files (5):**
- `scripts/dev/work-until-done.sh` (MODIFY: add `emit_event()` function writing structured stage events to `.runs/<feature>_p<phase>.events` sidecar. Add log copy to `specs/<feature>/.gwrk/runs/<timestamp>_<stage>.log` on stage completion. Add **pre-flight gate check**: run each task's gate script before dispatch — if gate already passes, skip task with `pre-flight PASS` log.)
- `src/utils/manifest.ts` (MODIFY: add `digest: string[]` to `RunManifest` Zod schema. Add `assembleDigest()` that reads sidecar `.events` file.)
- `src/commands/ship.ts` (MODIFY: add `isPhaseComplete()` helper — checks if all tasks are `completed` or `cancelled`. Add phase-skip logic in all-phases path. Wire `assembleDigest()` into `writeManifest()` call.)
- `src/commands/ship.test.ts` (MODIFY: add tests for phase-skip (completed, cancelled+completed, mixed) and digest assembly.)
- `specs/004-ship-loop/.gwrk/runs/.gitkeep` (NEW: ensure runs dir exists for log commits.)

**Requirements Addressed:** FR-003, FR-010, FR-012, FR-014, FR-017, US-002, US-007, US-009, TC-007

**Dependencies:** None

**Contract Mapping:**
- `contracts/ship.md` → `isPhaseComplete()` → `src/commands/ship.ts`
- `contracts/ship.md` → `assembleDigest()` → `src/utils/manifest.ts`
- `contracts/implement.md` → `emit_event()` → `scripts/dev/work-until-done.sh`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| TC-002 Fail-Fast Config | Zod schema for `RunManifest` — no `.default()` on digest |
| TC-003 TypeScript Only | manifest.ts changes are `.ts` |
| TC-007 Shell Scripts ARE the Product | `emit_event()` stays in bash, not TS |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit | `src/commands/ship.test.ts` | Phase with all `completed` tasks is skipped |
| TR-005 | Unit | `src/commands/ship.test.ts` | Phase with `cancelled` + `completed` is skipped |
| TR-005 | Unit | `src/commands/ship.test.ts` | Phase with mixed open/completed is NOT skipped |
| TR-005 | Unit | `src/commands/ship.test.ts` | Manifest contains non-empty `digest[]` from `.events` sidecar |
| TR-007 | E2E | `src/scripts-e2e.test.ts` | WUD run produces `.events` sidecar file |

#### Done When
- `pnpm vitest run src/commands/ship.test.ts` exits 0 with phase-skip and digest tests
- `grep -q 'emit_event' scripts/dev/work-until-done.sh` exits 0
- `grep -qE 'cancelled|canceled' src/commands/ship.ts` exits 0
- `jq -e '.digest' src/utils/manifest.ts 2>/dev/null || grep -q 'digest' src/utils/manifest.ts` exits 0

---

### Phase 2: Resilience & Bail

Wire the rip-cord bail (FR-018), integrate staging validator (FR-016), and enforce dirty-tree fail-fast (FR-002).

**Files (4):**
- `scripts/dev/work-until-done.sh` (MODIFY: add `emit_event "CIRCUIT_BREAK: ..."` on circuit break. Write `failureContext` JSON to state file: `openTasks`, `lastVerdict`, `iterationTimeline`, `digest`. Call `validate-staging.sh` after IMPLEMENT, before push. Add dirty-tree guard at startup.)
- `scripts/dev/wud-branch.sh` (MODIFY: add `git status --porcelain` check. Non-empty → emit `Dirty working tree — commit or stash before shipping` to stderr, exit 1.)
- `scripts/dev/validate-staging.sh` (VERIFY: confirm existing validator handles all FR-016 rejection cases.)
- `src/scripts-e2e.test.ts` (MODIFY: add test for circuit-break state file containing `failureContext`; add test for dirty-tree rejection.)

**Requirements Addressed:** FR-002, FR-016, FR-018, US-004, US-010, US-011, TC-006, TC-008

**Dependencies:** Phase 1 (`emit_event()`)

**Contract Mapping:**
- `contracts/branch.md` → dirty-tree guard → `scripts/dev/wud-branch.sh`
- `contracts/implement.md` → staging validation → `scripts/dev/validate-staging.sh`
- `contracts/wud.md` → `CIRCUIT_BREAK` → `failureContext` → `scripts/dev/work-until-done.sh`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| TC-006 Crash Safety | State flushed before every stage transition |
| TC-007 Shell Scripts ARE the Product | All changes in bash |
| TC-008 Staging Scope | validate-staging.sh rejects out-of-scope |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | E2E | `src/scripts-e2e.test.ts` | Circuit break produces state file with `failureContext` |
| TR-002 | Shell | `scripts/dev/wud-branch.sh` | Dirty tree exits 1 with correct message |
| TR-008 | Shell | `scripts/dev/validate-staging.sh` | Out-of-scope files → exit 1 |
| TR-008 | Shell | `scripts/dev/validate-staging.sh` | Build plan staged → exit 1 |

#### Done When
- `grep -qE 'failureContext|failure_context' scripts/dev/work-until-done.sh` exits 0
- `grep -q 'validate-staging' scripts/dev/work-until-done.sh` exits 0
- `grep -qE 'porcelain|Dirty working tree' scripts/dev/wud-branch.sh` exits 0
- `pnpm vitest run src/scripts-e2e.test.ts` exits 0

---

### Phase 3: Verification & Artifacts

Update all contracts to reflect implementation reality. Rewrite gap-analysis. Run full verification.

**Files (8):**
- `specs/004-ship-loop/contracts/ship.md` (MODIFY: add `isPhaseComplete()`, `assembleDigest()`, manifest schema with `digest[]`)
- `specs/004-ship-loop/contracts/implement.md` (MODIFY: add `emit_event()`, staging validation call, log rehoming)
- `specs/004-ship-loop/contracts/branch.md` (MODIFY: add dirty-tree fail-fast contract)
- `specs/004-ship-loop/contracts/wud.md` (MODIFY: add `CIRCUIT_BREAK` → `failureContext` state machine transition)
- `specs/004-ship-loop/contracts/verdict.md` (VERIFY: GO/NO-GO format matches FR-005)
- `specs/004-ship-loop/contracts/pr.md` (VERIFY: PR creation + CI wait contract)
- `specs/004-ship-loop/gap-analysis.md` (REWRITE: reflect current implementation vs new spec)
- `specs/004-ship-loop/checklists/requirements.md` (REWRITE: against new 18 FRs)

**Requirements Addressed:** All FRs verified, all TRs validated, all VRs exercised

**Dependencies:** Phase 1, Phase 2

**Contract Mapping:**
- All `contracts/*.md` files updated to match implementation

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| I-GW-S01 Spec-First | Contracts must match spec |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | E2E | `src/scripts-e2e.test.ts` | Full WUD lifecycle |
| TR-005 | Unit | `src/commands/ship.test.ts` | All ship.ts tests pass |
| TR-006 | CLI | `src/cli.e2e.test.ts` | `gwrk ship --help` correct |
| TR-012 | Integration | `pnpm test` | Full suite passes |

#### Done When
- `pnpm test` exits 0
- `pnpm build` exits 0
- `bash specs/004-ship-loop/gates/run-all-gates.sh` exits 0 (12/12 pass)
- All contracts in `specs/004-ship-loop/contracts/` reference current implementation

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `TaskState` | `src/utils/state.ts` | `ship.ts`, `tasks.ts` |
| `AgentBackend` | `src/utils/config.ts` | `ship.ts`, `dispatch.ts`, `agent-run.sh` |
| `RunManifest` | `src/utils/manifest.ts` | `ship.ts`, `gwrk harvest` (future, F002) |
| `ShipRunState` | `.runs/*.state` (JSON) | `work-until-done.sh`, `ship.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| FR-006 (partial) | PR dedup (update existing vs create new) | Edge case, low frequency | F004v2 |
| `gwrk harvest` | SQLite manifest harvesting from git-tracked runs/ | Build server concern (ADR-003 §4), not ship concern | F002 Phase 4 |
| VR-001 (partial) | Full E2E: ship → manifest → SQLite → PR | Requires build server harvest loop | F002 + F004v2 |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| **User Scenarios** | | |
| US-001 Ship Single Phase | — | ✅ Done (ship.ts + WUD exist) |
| US-002 Hard Gate Pre-flight | Phase 1 | ⚠️ **No pre-flight in WUD** — CI gate exists but not task-level pre-flight skip |
| US-003 Ship All Phases | Phase 1 | 🔲 Phase-skip cancelled handling needed |
| US-004 Circuit Breaker | Phase 2 | 🔲 failureContext needed |
| US-005 Crash Recovery | — | ✅ Done (save/load_state) |
| US-006 PR Creation & CI | — | ✅ Done (WUD PR + CI wait) |
| US-007 Manifest + Digest | Phase 1 | 🔲 Digest assembly + log rehoming |
| US-008 Agent Config | — | ✅ Done (config resolution) |
| US-009 Phase-Skip | Phase 1 | ⚠️ Exists but `cancelled` not handled |
| US-010 Staging Validation | Phase 2 | 🔲 WUD integration |
| US-011 Rip-Cord Bail | Phase 2 | 🔲 failureContext |
| **Functional Requirements** | | |
| FR-001 ship command | — | ✅ Done |
| FR-002 branch + dirty-tree | Phase 2 | ⚠️ **Branch works, dirty-tree check completely missing** |
| FR-003 pre-flight gates | Phase 1 | ⚠️ **Not implemented** — WUD has CI gate but NO task-level pre-flight skip |
| FR-004 state machine | — | ✅ Done |
| FR-005 review dispatch | — | ✅ Done |
| FR-006 PR + CI | — | ✅ Done |
| FR-007 circuit breaker | — | ✅ Done (save_state + exit) |
| FR-008 crash recovery | — | ✅ Done |
| FR-009 agent config | — | ✅ Done |
| FR-010 timestamped log | — | ⚠️ **Partial** — logs to `.runs/` not `.gwrk/runs/` (needs rehoming) |
| FR-011 SQLite recording | — | ✅ Done |
| FR-012 execution manifest | Phase 1 | ⚠️ **Partial** — manifest written but no `digest[]` field |
| FR-013 all-phases sequential | — | ✅ Done |
| FR-014 phase skip | Phase 1 | ⚠️ **Partial** — exists but `cancelled` status not handled |
| FR-016 staging validator | Phase 2 | ⚠️ **Script exists but NOT called from WUD** |
| FR-017 logging (3-tier) | Phase 1 | 🔲 emit_event + log rehoming to git-tracked |
| FR-018 rip-cord bail | Phase 2 | ⚠️ **Circuit break saves state but no `failureContext` JSON** |
| **Testing Requirements** | | |
| TR-001 E2E WUD lifecycle | Phase 2, 3 | 🔲 |
| TR-002 wud-branch validation | Phase 2 | 🔲 |
| TR-003 wud-verdict validation | Phase 3 | ✅ (verify) |
| TR-004 wud-ci-wait validation | Phase 3 | ✅ (verify) |
| TR-005 ship.test.ts | Phase 1 | 🔲 |
| TR-006 CLI help | Phase 3 | ✅ (verify) |
| TR-007 E2E manifest + digest | Phase 1, 3 | 🔲 |
| TR-008 staging validator | Phase 2 | 🔲 |
| **Technical Constraints** | | |
| TC-001 Air-Gapped | All | ✅ Enforced |
| TC-002 Fail-Fast Config | Phase 1 | ✅ (Zod, no defaults) |
| TC-003 TypeScript Only | All | ✅ Enforced |
| TC-004 Gate Integrity | All | ✅ Enforced |
| TC-005 Branch Isolation | — | ✅ Done |
| TC-006 Crash Safety | Phase 2 | 🔲 (failureContext flush) |
| TC-007 Shell = Product | Phase 1, 2 | ✅ WUD stays bash |
| TC-008 Staging Scope | Phase 2 | 🔲 |
| **Success Criteria** | | |
| SC-001 Full lifecycle | — | ✅ Done |
| SC-002 All-phases + skip | Phase 1 | 🔲 |
| SC-003 Audit-ready records | Phase 1 | 🔲 |
| SC-004 Circuit breaker + recovery | Phase 2 | 🔲 |
| SC-005 Help output | — | ✅ Done |
| SC-006 Staging rejects | Phase 2 | 🔲 |
| **Verification Reqts** | | |
| VR-001 E2E ship→manifest→PR | Phase 3 | 🔲 (partial — harvest deferred) |
| VR-002 Dry-run | — | ✅ Done |
| VR-003 Help contract | — | ✅ Done |
| VR-004 Staging validator | Phase 2 | 🔲 |
| **Data Model** | | |
| DM-001 Ship Run State | Phase 2 | 🔲 (failureContext) |
| DM-002 Execution Manifest | Phase 1 | 🔲 (digest[]) |
| DM-003 SQLite runs table | — | ✅ Done |
