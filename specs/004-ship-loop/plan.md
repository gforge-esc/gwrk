# Implementation Plan: 004 Ship Loop

**Branch**: `feat/004-ship-loop` | **Date**: 2026-03-14 | **Spec**: [spec.md](./spec.md)

## Summary

The ship loop implements Pillar 3's autonomous execution kernel (Foxtrot Charlie: Shipping → Throughput). Core code exists (ship.ts, work-until-done.sh, support scripts) but applying the TDD mandate (**no test = not done**), only **4 of 18 FRs have behavioral test coverage**. The remaining 14 FRs need implementation, tests, or both. Three new FRs (019-021) establish the plugin dispatch boundary per ADR-006.

Seven phases, 18 tasks:
1. **Digest & Phase-Skip** — Structured event sidecar, digest assembly, log rehoming, phase-skip logic, pre-flight gate check
2. **Resilience & Bail** — Rip-cord bail, staging validator integration, dirty-tree fail-fast
3. **Verification & Artifacts** — Contracts, gap analysis, full suite + tests for all existing but untested FRs
4. **Plugin Dispatch Boundary** — Extract `dispatchToAgent()` facade, `TaskDispatch`/`TaskResult` types, stdin delivery, exit normalization
5. **DispatchOrchestrator — TypeScript Ship Loop (F004-R)** — Port state machine into native TypeScript `ShipOrchestrator`
6. **Profile-Aware Toolchain Skipping** — Skip build and test execution when unconfigured or null
7. **Schema-Compliant Init Block** — Ensure `gwrk init` generates valid `agents` block structure

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

Write **dedicated behavioral tests** for all existing-but-untested FRs. Update all contracts. Rewrite gap-analysis. Run full verification.

**Files (10):**
- `src/commands/ship.test.ts` (MODIFY: add tests for FR-004 state machine transitions, FR-005 review dispatch with GO/NO-GO, FR-006 PR creation, FR-008 crash recovery resume, FR-009 hierarchical agent config resolution, FR-012 manifest writes with correct fields, FR-015 Agent-Native output wrapper and `--format json`)
- `src/scripts-e2e.test.ts` (MODIFY: add tests for FR-002 branch creation + dirty-tree rejection, FR-004 stage transitions, FR-006 PR + CI wait, FR-010 log file creation)
- `specs/004-ship-loop/contracts/ship.md` (MODIFY: add `isPhaseComplete()`, `assembleDigest()`, manifest schema with `digest[]`)
- `specs/004-ship-loop/contracts/implement.md` (MODIFY: add `emit_event()`, staging validation call, log rehoming)
- `specs/004-ship-loop/contracts/branch.md` (MODIFY: add dirty-tree fail-fast contract)
- `specs/004-ship-loop/contracts/wud.md` (MODIFY: add `CIRCUIT_BREAK` → `failureContext` state machine transition)
- `specs/004-ship-loop/contracts/verdict.md` (VERIFY: GO/NO-GO format matches FR-005)
- `specs/004-ship-loop/contracts/pr.md` (VERIFY: PR creation + CI wait contract)
- `specs/004-ship-loop/gap-analysis.md` (REWRITE: reflect current implementation vs new spec)
- `specs/004-ship-loop/checklists/requirements.md` (REWRITE: against new 18 FRs)

**Requirements Addressed:** FR-002 (test), FR-004 (test), FR-005 (test), FR-006 (test), FR-008 (test), FR-009 (test), FR-010 (test), FR-012 (test), FR-015, all TRs validated, all VRs exercised

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
| TR-001 | E2E | `src/scripts-e2e.test.ts` | Full WUD lifecycle with stage transitions verified |
| TR-002 | E2E | `src/scripts-e2e.test.ts` | Branch creation verified; dirty tree rejected |
| TR-003 | E2E | `src/scripts-e2e.test.ts` | Verdict GO/NO-GO triggers correct next stage |
| TR-004 | E2E | `src/scripts-e2e.test.ts` | CI wait + PR creation |
| TR-005 | Unit | `src/commands/ship.test.ts` | Config hierarchical resolution (--agent > .gwrkrc > crash) |
| TR-005 | Unit | `src/commands/ship.test.ts` | Crash recovery: resume from state file |
| TR-005 | Unit | `src/commands/ship.test.ts` | Manifest written with all required fields |
| TR-006 | CLI | `src/cli.e2e.test.ts` | `gwrk ship --help` correct |
| TR-012 | Integration | `pnpm test` | Full suite passes |

#### Done When
- `pnpm test` exits 0
- `pnpm build` exits 0
- `bash specs/004-ship-loop/gates/run-all-gates.sh` exits 0 (12/12 pass)
- All contracts in `specs/004-ship-loop/contracts/` reference current implementation

---

### Phase 4: Plugin Dispatch Boundary

Extract the dispatch facade per ADR-006. Today it wraps `spawn(cli, args)`. When F014 ships, the internals are replaced by `pluginRegistry.getAgentBackend().dispatch()` — no other F004 code changes.

**Files (5):**
- `src/utils/agent.ts` (MODIFY: extract `dispatchToAgent()` function with `TaskDispatch → TaskResult` signature. Move existing CLI spawn logic into this facade. Add exit code normalization: map raw process codes to gwrk standard. Add stdin delivery via `child.stdin.write()` instead of inline `-p`.)
- `src/utils/agent.test.ts` (NEW: unit tests for `dispatchToAgent()` — mock child process spawn, verify exit code normalization, verify stdin delivery, verify `TaskResult` shape.)
- `src/commands/ship.ts` (MODIFY: replace direct `agent-run.sh` invocation with `dispatchToAgent()`. Consume `TaskResult.exitCode` and `TaskResult.errorType` instead of raw exit codes.)
- `specs/004-ship-loop/contracts/dispatch.md` (NEW: `TaskDispatch → TaskResult` interface contract. Documents the dispatch facade signature, error types, and exit code mapping.)
- `scripts/dev/work-until-done.sh` (MODIFY: replace direct CLI invocation with `gwrk dispatch` call where feasible. Existing `agent-run.sh` call site is the primary target.)

**Requirements Addressed:** FR-019, FR-020, FR-021, US-001, US-008

**Dependencies:** Phase 3 (contracts finalized)

**Contract Mapping:**
- `contracts/dispatch.md` → `dispatchToAgent()` → `src/utils/agent.ts`
- `contracts/dispatch.md` → `TaskDispatch` type → `src/utils/agent.ts`
- `contracts/dispatch.md` → `TaskResult` type → `src/utils/agent.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-006 | Agent backends abstracted behind facade |
| TC-002 Fail-Fast Config | No graceful defaults in dispatch config |
| TC-003 TypeScript Only | All new code is `.ts` |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-009 | Unit | `src/utils/agent.test.ts` | `dispatchToAgent()` returns `TaskResult` with normalized exit code |
| TR-009 | Unit | `src/utils/agent.test.ts` | Gemini exit 53 → `exitCode: 1, errorType: "turn_limit"` |
| TR-009 | Unit | `src/utils/agent.test.ts` | Unknown exit code → `exitCode: 1, errorType: "unknown"` |
| TR-009 | Unit | `src/utils/agent.test.ts` | CLI not found → `exitCode: 127` |
| TR-009 | Unit | `src/utils/agent.test.ts` | Context delivered via stdin, not inline args |
| TR-005 | Unit | `src/commands/ship.test.ts` | Ship loop consumes `TaskResult`, not raw exit codes |

#### Done When
- `pnpm vitest run src/utils/agent.test.ts` exits 0 with all TR-009 assertions
- `grep -q 'dispatchToAgent' src/commands/ship.ts` exits 0
- `grep -q 'TaskResult' src/utils/agent.ts` exits 0
- `grep -q 'errorType' src/utils/agent.ts` exits 0
- `test -f specs/004-ship-loop/contracts/dispatch.md` exits 0
- `pnpm build` exits 0

---

### Phase 5: DispatchOrchestrator — TypeScript Ship Loop (F004-R)

Port the `work-until-done.sh` state machine into a native TypeScript `ShipOrchestrator`. This is the F004-R rework mandated by cascade §2.5 item 6. The new orchestrator consumes `dispatchToAgent()` (Phase 4) and prepares the architecture for F014's `WorkflowRuntime` JSON intent execution. Built **alongside** the existing bash scripts — only the final task wires `gwrk ship` to use the new TS orchestrator.

> **TC-007 Override:** This phase explicitly supersedes TC-007 ("Shell Scripts ARE the Product") for the ship loop state machine. The bash scripts remain operational until the TS orchestrator is verified and wired in.

**Files (6):**
- `src/engine/ship-orchestrator.ts` (NEW: TypeScript state machine — BRANCH_SETUP → IMPLEMENT → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE. Consumes `dispatchToAgent()`, `assembleDigest()`, gate runner. Persists state to `.runs/` per FR-008. Circuit breaker per FR-007. Staging validation per FR-016.)
- `src/engine/ship-orchestrator.test.ts` (NEW: Unit tests — state machine transitions, crash recovery resume, circuit breaker, staging validation, pre-flight gate skip, digest assembly.)
- `src/engine/ship-types.ts` (NEW: `ShipStage`, `ShipState`, `ShipRunConfig`, `StageResult` types. Shared between orchestrator and CLI.)
- `src/utils/gate-runner.ts` (NEW: Programmatic gate execution — runs gate scripts and returns structured pass/fail. Replaces inline bash gate checks.)
- `src/commands/ship.ts` (MODIFY: Replace `work-until-done.sh` spawn with `ShipOrchestrator.run()` call. Keep bash fallback behind `--legacy` flag for safety.)
- `specs/004-ship-loop/contracts/orchestrator.md` (NEW: `ShipOrchestrator` interface contract — state machine stages, config, recovery, circuit breaker.)

**Requirements Addressed:** FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-010, FR-016, FR-017, FR-018, US-001 through US-011, cascade §2.5 item 6

**Dependencies:** Phase 4 (`dispatchToAgent()` facade)

**Contract Mapping:**
- `contracts/orchestrator.md` → `ShipOrchestrator` → `src/engine/ship-orchestrator.ts`
- `contracts/orchestrator.md` → `ShipState` → `src/engine/ship-types.ts`
- `contracts/orchestrator.md` → `runGate()` → `src/utils/gate-runner.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-006 | Agent dispatch through `dispatchToAgent()` facade |
| TC-002 Fail-Fast Config | No graceful defaults in orchestrator config |
| TC-003 TypeScript Only | All new code is `.ts` |
| TC-006 Crash Safety | State flushed before every stage transition |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-010 | Unit | `src/engine/ship-orchestrator.test.ts` | State machine completes: BRANCH_SETUP → IMPLEMENT → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE |
| TR-010 | Unit | `src/engine/ship-orchestrator.test.ts` | CODE_REVIEW NO-GO → loops back to IMPLEMENT, increments iteration |
| TR-010 | Unit | `src/engine/ship-orchestrator.test.ts` | Circuit breaker trips after MAX_ITERATIONS |
| TR-010 | Unit | `src/engine/ship-orchestrator.test.ts` | Crash recovery: resumes from persisted state file |
| TR-010 | Unit | `src/engine/ship-orchestrator.test.ts` | Pre-flight gate pass → skips implementation |
| TR-010 | Unit | `src/engine/ship-orchestrator.test.ts` | Staging validation failure → re-runs implementation |
| TR-010 | Unit | `src/engine/ship-orchestrator.test.ts` | `CIRCUIT_BREAK` writes `failureContext` to state file |
| TR-011 | Unit | `src/utils/gate-runner.test.ts` | `runGate()` returns pass/fail with exit code and output |
| TR-005 | Unit | `src/commands/ship.test.ts` | Ship CLI invokes `ShipOrchestrator` instead of spawning bash |

#### Done When
- `pnpm vitest run src/engine/ship-orchestrator.test.ts` exits 0
- `pnpm vitest run src/utils/gate-runner.test.ts` exits 0
- `grep -q 'ShipOrchestrator' src/commands/ship.ts` exits 0
- `pnpm build` exits 0
- `gwrk gate 004-ship-loop` exits 0

---

#### Deferred from Phase 5
| Item | Reason | Target |
|---|---|---|
| `define-until-solid.sh` replacement | Different pipeline (define, not ship). Separate rework track. | F004-R2 or standalone |
| `WorkflowRuntime` integration | Requires F014 Layer 2.5 to be production-ready. ShipOrchestrator is _prepared_ but does not consume JSON Intents yet. | Post-F014 L2.5 |

---

### Phase 6: Profile-Aware Toolchain Skipping

Support skipping `BUILD_CHECK` and/or `TEST_GATE` execution stages in the `ShipOrchestrator` when build or test commands are unconfigured or explicitly set to `null` (FR-022, FR-023, FR-024).

**Files (6):**
- `src/utils/config.ts` (MODIFY: Extend `GwrkConfigSchema` Zod model to parse `project.toolchain.build` and `project.toolchain.test` as optional, nullable strings.)
- `src/utils/toolchain-mapper.ts` (MODIFY: Implement `getBuildCommand(profile: ProjectProfile): string | null` function. Default Node.js project type to "pnpm build" or return `null` if explicitly null or unconfigured.)
- `src/engine/ship-orchestrator.ts` (MODIFY:
  - In `stageBuildCheck`, resolve the build command using `getBuildCommand(profile)`. If it returns `null`, skip build verification and output `✓ build skipped (no build toolchain)`.
  - In `stageTestGate` (or `runTestSuite`), if the test command resolves to `null` or test runner is not configured, skip test suite verification, output `✓ tests skipped (no test toolchain)`, and proceed.)
- `src/utils/config.test.ts` (MODIFY: Add unit tests validating `GwrkConfigSchema` parsing of optional, nullable build/test toolchain configurations.)
- `src/utils/toolchain-mapper.test.ts` (NEW: Add unit tests for `getBuildCommand` verifying correct string or null returns across profiles.)
- `src/engine/ship-orchestrator.test.ts` (MODIFY: Add unit tests verifying `stageBuildCheck` and `stageTestGate` gracefully skip build checking and testing when configured to `null`.)

**Requirements Addressed:** FR-022, FR-023, FR-024, US-012

**Dependencies:** Phase 5 (`ShipOrchestrator` operational)

**Contract Mapping:**
- `contracts/orchestrator.md` → state machine build/test skipping → `src/engine/ship-orchestrator.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| TC-002 Fail-Fast Config | GwrkConfigSchema Zod validation retains strict parsing |
| TC-003 TypeScript Only | All files modified/created are `.ts` |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-024 | Unit | `src/utils/config.test.ts` | Schema parses `project.toolchain.build/test` as null, string, or undefined |
| TR-022 | Unit | `src/utils/toolchain-mapper.test.ts` | `getBuildCommand` returns `null` when profile build is null or missing for non-TypeScript |
| TR-022 | Unit | `src/utils/toolchain-mapper.test.ts` | `getBuildCommand` returns `pnpm build` for typescript type |
| TR-023 | Unit | `src/engine/ship-orchestrator.test.ts` | `stageBuildCheck` transitions to `TEST_GATE` and logs build skipped message |
| TR-023 | Unit | `src/engine/ship-orchestrator.test.ts` | `stageTestGate` transitions to `CODE_REVIEW` and logs tests skipped message |

#### Done When
- `pnpm vitest run src/utils/config.test.ts` exits 0
- `pnpm vitest run src/utils/toolchain-mapper.test.ts` exits 0
- `pnpm vitest run src/engine/ship-orchestrator.test.ts` exits 0
- `pnpm build` exits 0

---

### Phase 7: Schema-Compliant Init Block

Ensure that the default configuration output generated by `gwrk init` includes a schema-compliant `agents` block to prevent schema validation failures in downstream commands (FR-025).

**Files (2):**
- `src/commands/init.ts` (MODIFY: Update the `agents` block default configuration template output written to `.gwrkrc.json` to write valid properties: `define`, `implement`, `registry` (containing provider/model details), and `fallbackOrder`.)
- `src/commands/init.test.ts` (MODIFY: Add integration tests verifying that `gwrk init --non-interactive` creates a `.gwrkrc.json` configuration file containing the Zod-compliant `agents` structure, and that running a configuration-dependent command like `gwrk project info` parses the resulting file successfully.)

**Requirements Addressed:** FR-025, US-013

**Dependencies:** Phase 6 (schema updated)

**Contract Mapping:**
- `specs/001-cli-core/contracts/config.md` → schema validation compliance → `src/commands/init.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| TC-002 Fail-Fast Config | Default properties write valid objects without relying on Zod fallbacks |
| TC-003 TypeScript Only | CLI implementations written in TypeScript |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-025 | Unit | `src/commands/init.test.ts` | Created `.gwrkrc.json` contains `agents.define`, `agents.implement`, `agents.registry`, `agents.fallbackOrder` |
| TR-025 | E2E | `src/commands/init.test.ts` | `gwrk project info` loads the newly initialized config successfully without validation errors |

#### Done When
- `pnpm vitest run src/commands/init.test.ts` exits 0
- `pnpm build` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `TaskState` | `src/utils/state.ts` | `ship.ts`, `tasks.ts` |
| `TaskDispatch` | `src/utils/agent.ts` | `ship.ts`, `dispatch.ts` |
| `TaskResult` | `src/utils/agent.ts` | `ship.ts`, `dispatch.ts`, F014 `AgentBackend` (future) |
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
| **User Scenarios** | | ✅ Done |
| US-001 Ship Single Phase | Phase 3 | ✅ Done |
| US-002 Hard Gate Pre-flight | Phase 1 | ✅ Done |
| US-003 Ship All Phases | Phase 1 | ✅ Done |
| US-004 Circuit Breaker | Phase 2 | ✅ Done |
| US-005 Crash Recovery | Phase 3 | ✅ Done |
| US-006 PR Creation & CI | Phase 3 | ✅ Done |
| US-007 Manifest + Digest | Phase 1 | ✅ Done |
| US-008 Agent Config | Phase 3, 4 | ✅ Done |
| US-009 Phase-Skip | Phase 1 | ✅ Done |
| US-010 Staging Validation | Phase 2 | ✅ Done |
| US-011 Rip-Cord Bail | Phase 2 | ✅ Done |
| US-012 Profile Skipping | Phase 6 | ✅ Done |
| US-013 Zod Init Config | Phase 7 | ✅ Done |
| **Functional Requirements** | | ✅ Done |
| FR-001 ship command | — | ✅ Done |
| FR-002 branch + dirty-tree | Phase 2 | ✅ Done |
| FR-003 pre-flight gates | Phase 1 | ✅ Done |
| FR-004 state machine | Phase 3 | ✅ Done |
| FR-005 review dispatch | Phase 3 | ✅ Done |
| FR-006 PR + CI | Phase 3 | ✅ Done |
| FR-007 circuit breaker | — | ✅ Done |
| FR-008 crash recovery | Phase 3 | ✅ Done |
| FR-009 agent config | Phase 3 | ✅ Done |
| FR-010 timestamped log | Phase 1 | ✅ Done |
| FR-011 SQLite recording | — | ✅ Done |
| FR-012 execution manifest | Phase 1 | ✅ Done |
| FR-013 all-phases sequential | — | ✅ Done |
| FR-014 phase skip | Phase 1 | ✅ Done |
| FR-015 agent-native output | Phase 3 | ✅ Done |
| FR-016 staging validator | Phase 2 | ✅ Done |
| FR-017 logging (3-tier) | Phase 1 | ✅ Done |
| FR-018 rip-cord bail | Phase 2 | ✅ Done |
| FR-019 dispatch facade | Phase 4 | ✅ Done |
| FR-020 exit normalization | Phase 4 | ✅ Done |
| FR-021 stdin delivery | Phase 4 | ✅ Done |
| FR-022 build command null skip | Phase 6 | ✅ Done |
| FR-023 test command null skip | Phase 6 | ✅ Done |
| FR-024 optional build/test schema | Phase 6 | ✅ Done |
| FR-025 schema-compliant init config | Phase 7 | ✅ Done |
| **Testing Requirements** | | ✅ Done |
| TR-001 E2E WUD lifecycle | Phase 2, 3 | ✅ Done |
| TR-002 wud-branch validation | Phase 2 | ✅ Done |
| TR-003 wud-verdict validation | Phase 3 | ✅ Done |
| TR-004 wud-ci-wait validation | Phase 3 | ✅ Done |
| TR-005 ship.test.ts | Phase 1, 4 | ✅ Done |
| TR-006 CLI help | Phase 3 | ✅ Done |
| TR-007 E2E manifest + digest | Phase 1, 3 | ✅ Done |
| TR-008 staging validator | Phase 2 | ✅ Done |
| TR-009 dispatch facade tests | Phase 4 | ✅ Done |
| TR-022 getBuildCommand test | Phase 6 | ✅ Done |
| TR-023 skip check skip tests | Phase 6 | ✅ Done |
| TR-024 validation schema test | Phase 6 | ✅ Done |
| TR-025 init agent block verification | Phase 7 | ✅ Done |
| **Technical Constraints** | | ✅ Done |
| TC-001 Air-Gapped | All | ✅ Done |
| TC-002 Fail-Fast Config | Phase 1 | ✅ Done |
| TC-003 TypeScript Only | All | ✅ Done |
| TC-004 Gate Integrity | All | ✅ Done |
| TC-005 Branch Isolation | — | ✅ Done |
| TC-006 Crash Safety | Phase 2 | ✅ Done |
| TC-007 Shell = Product | Phase 1, 2 | ✅ Done |
| TC-008 Staging Scope | Phase 2 | ✅ Done |
| **Success Criteria** | | ✅ Done |
| SC-001 Full lifecycle | — | ✅ Done |
| SC-002 skips compilation/tests | Phase 6 | ✅ Done |
| SC-003 Zod init verification | Phase 7 | ✅ Done |
| SC-004 Circuit breaker + recovery | Phase 2 | ✅ Done |
| SC-005 Help output | — | ✅ Done |
| SC-006 Staging rejects | Phase 2 | ✅ Done |
| **Verification Reqts** | | ✅ Done |
| VR-001 E2E ship→manifest→PR | Phase 3 | ✅ Done |
| VR-002 build check skip on python | Phase 6 | ✅ Done |
| VR-003 init Zod output check | Phase 7 | ✅ Done |
| VR-004 Staging validator | Phase 2 | ✅ Done |
| **Data Model** | | ✅ Done |
| DM-001 Ship Run State | Phase 2 | ✅ Done |
| DM-002 Execution Manifest | Phase 1 | ✅ Done |
| DM-003 config schema toolchain | Phase 6 | ✅ Done |
