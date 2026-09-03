# Implementation Plan: 025 Gate-Only Phases

**Branch**: `025-gate-only-phases` (feature branch created at `/implement`) | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)

## Summary

`gwrk ship` runs each phase through `IMPLEMENT → BUILD_CHECK → TEST_GATE`. TEST_GATE enforces **liveness** (ADR-005 §10.2.1): a phase that maps to test files must actually execute ≥1 test (`testsRun > 0`) or it NO-GOs. That rule is correct; the defect is **upstream** — `define tasks` copies the plan's Test-Strategy → Target column into `phase.testTargets`, and for a gate-type TR that column names the file the gate *asserts about* (`` `.env.example` ``, `` `prisma/schema.prisma` ``), not a runnable test. `src/utils/test-discovery.ts` then adds *any existing* declared target to the discovered test set (`:59`, and the parallel arm in `phaseHasTests` `:114`), so TEST_GATE scopes a "suite" to `.env.example`, runs 0 tests, and NO-GOs a phase whose code shipped correctly (Run #2207 — data-dashboard `004-github-project-adapter` P1 tripped the circuit breaker after 3 iterations).

Two coordinated, committed fixes — one per phase, split by module and functional boundary:

- **Phase 1 — Fix A (precise, test-discovery).** Export a single `isTestFile(relPath, testExt?)` predicate (the multi-language regex currently inline in `listTestsTree` at `:23`) and require a declared target to be an **actual test file** before it counts, at both call sites (`discoverTestsForSources` `:59`, `phaseHasTests` `:114`). Effect: `.env.example` / `schema.prisma` are dropped, a co-located real test (`src/config/env.test.js`) is retained, and a pure schema/migration phase yields `getPhaseTestFiles() === []`. `listTestsTree`, `discoverTestsForSources`, and `phaseHasTests` all route through the one predicate (TC-005). (FR-001, FR-002, FR-003)
- **Phase 2 — Fix B (positive verification, ship orchestrator).** In `stageTestGate`, when a phase is **test-less** (`getPhaseTestFiles()` empty after Fix A) **and** declares a Done-When gate, run `phase.doneWhen` as a `set -e` bare-clone gate and pass **iff exit 0** — an honest verification of config/schema/migration work — instead of relying on the weak baseline "no regression" path. Correspondingly, `stageActivateTests` scopes RED-liveness to **test-driven** phases (the existing `:486` test-less early return already provides the test-less pass; Fix A must not regress it), and the **test-driven** `testsRun === 0` NO-GO at `:857` is preserved verbatim (the discriminator lives in the test-less branch, resolving OQ-001). (FR-004, FR-005, FR-006)

**Dependency:** Phase 2 depends on Phase 1 — the test-less/test-driven discriminator *is* `getPhaseTestFiles()` post-Fix-A. Because Fix A removes only *non-test* declared targets, a real test that cancels still maps → the phase stays test-driven → its `testsRun === 0` still NO-GOs (FR-006 guard preserved).

**No data model / no schema change (DM-000, spec §5).** The feature operates on the existing `PhaseSchema` (`src/utils/state.ts:35`) — reading `phase.testTargets` (`:43`) and `phase.doneWhen` (`:40`), both already present — and on the existing test-discovery / ship-orchestrator contracts. No `tasks.json` shape change; Fix A makes the pipeline robust to the existing `testTargets` content. The liveness rule (`src/engine/test-runner.ts:113`, `ran = testsRun > 0`; ADR-005 §10.2.1) is **not modified** (TC-004 / VR-006).

**Cross-reference review (sister specs) — no conflicts.**
- **024-gate-assertion-contract** touches only the *define-time* layer (`plan-gate-validator.ts`, `define-plan.ts`, generator `PROMPT.md`). Fix B **depends on** 024's outcome: a Done-When line that verifies a command asserts on its exit code (run under `set -e`), which is exactly what makes trusting a gate-only phase's Done-When exit code sound. No file overlap; 025 does **not** modify `src/commands/gate.ts` or `set -e` semantics (owned by 023 §13 / PR #150 / 024 TC-005). 🟢
- **023-plan-format-contract** compiles a phase's fenced-bash Done-When into `phase.gateScript`/`phase.doneWhen`. 025 *consumes* `phase.doneWhen` for Fix B; it does not alter extraction (`plan-to-tasks.ts`). 🟢
- **021-polyglot-toolchain (FR-005)** introduced the "declared target" discovery arm 025 tightens. 025 keeps a *real* declared test (a behavior-named out-of-tree suite with no basename match) working and only drops declared targets that are not test files — TR-001/TR-002 assert the legitimate arm is preserved. 🟢
No shared Zod schema is changed (existing `PhaseSchema` reused), no contract-type conflict (the only new public symbol is `isTestFile`), and no phase-ordering dependency crosses a spec boundary.

---

## Phases and File Structure

### Phase 1: Fix A — test-discovery classifies only real test files (FR-001, FR-002, FR-003)

Give test-discovery a single definition of "what is a test file" and require declared targets to satisfy it, so a config/schema/migration file named in a plan's Test-Strategy → Target column is never returned as a discovered test.

1. **Single predicate (FR-003, TC-005).** Extract the multi-language test regex currently inline in `listTestsTree` (`src/utils/test-discovery.ts:23` — `/\.(test|spec)\.[jt]s$|_test\.(go|py)$|test_.*\.py$/`) into an exported `isTestFile(relPath: string, testExt?: string): boolean` that returns `true` when the path's basename matches that regex **or** the path ends with the profile's `testExt`. `listTestsTree` is refactored to call it, so "what is a test file" has exactly one definition. The predicate is a pure path/regex check — it never invokes a binary (TC-006, parity with PR #153).
2. **Filter the discovery declared-target arm (FR-001).** `discoverTestsForSources` `:59` — `for (const t of declaredTargets ?? []) if (fileExists(t)) found.add(t);` becomes `… if (fileExists(t) && isTestFile(t, testExt)) found.add(t);`. The source-mapped, mentioned, co-located, and tests-tree arms are unchanged.
3. **Filter the coverage declared-target arm (FR-002).** `phaseHasTests` `:114` — `if ((declaredTargets ?? []).some((t) => fileExists(t))) return true;` gains the same `isTestFile(t, testExt)` conjunct, so a non-test declared target does not register as phase coverage; existence semantics for real declared tests are preserved.

Add co-located Vitest unit tests with the exact `-t` names the spec's acceptance scenarios invoke (`"drops a non-test declared target"`, `"isTestFile"`, `"keeps a co-located real test, drops the config target"`).

**Files (2):**
- `src/utils/test-discovery.ts` — **amend** — export `isTestFile(relPath, testExt?)` built from the `:23` regex; refactor `listTestsTree` to use it; add the `&& isTestFile(t, testExt)` conjunct to the declared-target arms in `discoverTestsForSources` (`:59`) and `phaseHasTests` (`:114`); leave all other arms and the exported signatures unchanged
- `src/utils/test-discovery.test.ts` — **amend** — add TR-001 (`discoverTestsForSources` excludes an existing `.env.example`, still includes a real declared `tests/auth/human-flow.test.js`), TR-002 (`phaseHasTests` returns `false` for `schema.prisma`, `true` for `tests/x.test.js`), and TR-003 (the co-located mixed case + a direct `isTestFile` truth table)

**Requirements Addressed:** FR-001, FR-002, FR-003, US-001, US-002, TC-005, TC-006, SC-005, VR-003

**Dependencies:** None (foundational — provides the `getPhaseTestFiles() === []` discriminator Phase 2 consumes). 021-polyglot-toolchain FR-005 declared-target arm already exists in `test-discovery.ts`; this phase tightens it without removing the legitimate case.

**Contract Mapping:**
- `contracts/test-discovery.md` → §1 `isTestFile(relPath, testExt?): boolean` → `src/utils/test-discovery.ts`
- `contracts/test-discovery.md` → §2 `discoverTestsForSources` declared-target arm (existing signature, filtered behavior) → `src/utils/test-discovery.ts`
- `contracts/test-discovery.md` → §3 `phaseHasTests` declared-target arm (existing signature, filtered behavior) → `src/utils/test-discovery.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-005 §10.2 (tdd-gate architecture) | Fix A narrows the "declared target" discovery arm (ADR-005 §10.2 Invariant 4 / §11) so a non-test file cannot masquerade as phase test coverage; the liveness rule (§10.2.1) itself is untouched |
| TC-005 (single test-file predicate) | `listTestsTree`, `discoverTestsForSources`, and `phaseHasTests` MUST all route through the one `isTestFile` — no duplicated/divergent regex |
| TC-006 / PR #153 (bare-clone, which-only) | `isTestFile` is a pure path/regex check and MUST NOT invoke any binary to classify a file |
| TC-003 (TypeScript only) | ESM, ES2022, no `.js` added under `src/` |
| compile-gate | Always |

#### Test Strategy
| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-001 | unit | `src/utils/test-discovery.test.ts` | Test `"drops a non-test declared target"`: `discoverTestsForSources` with `declaredTargets: ['.env.example']` (existence-stubbed true) and no other coverage returns a set **excluding** `.env.example`; a parallel case with a real declared `tests/auth/human-flow.test.js` still **includes** it (021 FR-005 arm not regressed) |
| TR-002 | unit | `src/utils/test-discovery.test.ts` | `phaseHasTests` with `declaredTargets: ['schema.prisma']` (exists) and no source/co-located/tree test returns `false`; with `declaredTargets: ['tests/x.test.js']` (exists) returns `true` |
| TR-003 | unit | `src/utils/test-discovery.test.ts` | Test `"keeps a co-located real test, drops the config target"`: `discoverTestsForSources` with `declaredTargets: ['.env.example']`, `sourceFiles: ['src/config/env.js']`, both `.env.example` and `src/config/env.test.js` stubbed true → contains `src/config/env.test.js`, excludes `.env.example`. Plus a direct `isTestFile` unit: true for `foo.test.ts`/`bar_test.go`/`test_x.py`/(profile `testExt`); false for `.env.example`/`prisma/schema.prisma`/`config.yaml` |

#### Done When
```bash
pnpm run build
pnpm vitest run src/utils/test-discovery.test.ts
grep -qE 'export function isTestFile' src/utils/test-discovery.ts
test "$(grep -cE 'isTestFile\(' src/utils/test-discovery.ts)" -ge 2
```

### Phase 2: Fix B — TEST_GATE verifies test-less phases by Done-When; ACTIVATE_TESTS scopes RED-liveness (FR-004, FR-005, FR-006)

Make TEST_GATE positively verify a test-less gate-only phase, and confine liveness to phases that actually map a test — while preserving the liveness guard for test-driven phases exactly as-is.

1. **Done-When verification for test-less phases (FR-004).** In `stageTestGate` (`src/engine/ship-orchestrator.ts`), in the `phaseTestFiles.length === 0` branch, when `phase.doneWhen` is non-empty, run the **full** Done-When as a `set -e` bare-clone gate (the same `execSync(\`set -e\\n${script}\`, …)` shape used at `src/commands/gate.ts:276`; a new private `runDoneWhenGate()` helper, joining `phase.doneWhen` with newlines) and pass **iff exit 0** — emitting `✓ TEST_GATE: Done-When gate passed (<phase-id>)` → GO to CODE_REVIEW. A non-zero exit calls `handleNoGo("TEST_GATE")` after logging `✗ TEST_GATE: Done-When gate failed for <phase-id> ('<offending line>')`. This runs the whole Done-When (not only the `isIntegrationTestCommand` subset `runIntegrationGate` executes), so `grep` / `config:inspect` gates are actually verified. A test-less phase with **no** `doneWhen` retains the existing baseline "no regression" pass (Fix B strengthens, never weakens). The `testsRun > 0` liveness rule is **not** applied to a Done-When gate (a config gate asserts by exit code, not test count).
2. **RED-liveness scoped to test-driven phases (FR-005).** In `stageActivateTests`, the existing `:486` early return (`if (testFiles.length === 0) return { success: true }`) already gives a test-less phase a pass without a RED-liveness NO-GO; Fix A must **not** regress it. The RED-liveness NO-GO at `:517` (`red.testsRun === 0 → NO-GO`) continues to fire for **test-driven** phases (a genuinely-empty real RED suite still NO-GOs). Net: this is verified behavior + guard test, no new NO-GO path.
3. **Liveness guard preserved for test-driven phases (FR-006).** The `phaseTestFiles.length > 0` / `testsRun === 0` NO-GO at `:857` is left verbatim. Because Fix A filters only *declared targets*, a real `*.test.*` that cancels still maps → the phase stays test-driven → this NO-GO stands (resolving OQ-001: Fix B lives in the test-less branch, not at `:857`).

Add orchestrator-harness Vitest tests (stubbed phase + Done-When runner) with the spec's exact `-t` names.

**Files (3):**
- `src/engine/ship-orchestrator.ts` — **amend** — add a private `runDoneWhenGate()` that runs `phase.doneWhen` under `set -e` (reusing the `gate.ts:276` execution shape; imports only, no change to `test-runner.ts`); call it from the test-less branch of `stageTestGate` (pass iff exit 0, else `handleNoGo("TEST_GATE")` naming the offending line); keep the `:857` test-driven `testsRun === 0` NO-GO and the `stageActivateTests` `:486`/`:517` behavior intact
- `src/commands/ship.ts` — **amend** — Path A (pre-flight): the `phaseHasTests` block runs BEFORE the orchestrator, so a config phase (source file, no test) is hard-blocked at `~:178` before Fix B can run. Apply the same discriminator: when `phaseHasTests` is false but the phase declares a non-empty `doneWhen`, it is a gate-only phase — log and proceed (TEST_GATE/Fix B asserts it) instead of blocking. The block is preserved when the phase declares neither a test nor a Done-When gate (regression guard, `doneWhen: []`).
- `src/engine/ship-orchestrator.review.test.ts` — **amend** — add TR-004 (test-less phase: green Done-When → GO, red Done-When → NO-GO with the failing line), TR-005 (`stageActivateTests`: test-less → `{ success: true }` no RED-liveness NO-GO; test-driven 0-tests → `{ success: false }`), TR-006 (the Run #2207 SEAM: co-located `env.test.js` runs and no `scoped to: .env.example`; pure-schema phase passes via green Done-When), TR-007 (guard: a real `foo.test.js` running 0 tests still NO-GOs, `getPhaseTestFiles()` non-empty)

**Requirements Addressed:** FR-004, FR-005, FR-006, US-003, US-004, US-005, TC-001, TC-002, TC-004, SC-001, SC-002, SC-003, SC-004, VR-001, VR-002, VR-004, VR-005, VR-006, Agent-Native §12

**Dependencies:** Phase 1 (Fix A). The test-less/test-driven discriminator is `getPhaseTestFiles()` returning `[]` **after** Fix A drops non-test declared targets; without Fix A a config-only phase is mis-classified as test-driven and never reaches the Fix B branch. Also depends on 024-gate-assertion-contract (Done-When lines assert by exit code) making the exit-code trust in FR-004 sound — no code dependency, contract dependency only.

**Contract Mapping:**
- `contracts/test-discovery.md` → §4 Discriminator (`getPhaseTestFiles()` empty ⇒ test-less) → `src/engine/ship-orchestrator.ts` (`stageTestGate`, `stageActivateTests`)

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-005 §10.2.1 (liveness) / §10.4 (integration Done-When gates) | Fix B preserves §10.2.1 for test-driven phases (FR-006) and generalizes §10.4 — running the **full** Done-When for a test-less phase, not only the `isIntegrationTestCommand` subset `runIntegrationGate` runs |
| ADR-004 (agent-native output) | `gwrk ship` TEST_GATE/ACTIVATE_TESTS gain honest verifier behavior; a red Done-When gate names `<phase-id>` + offending line on stderr (error-as-navigation); the false `scoped to: <config file>` line is gone; inherits ship's existing `[exit:N | Xs]` wrapper and `--format` — no new command surface (§12) |
| ADR-003 (state contract) | Reads the existing `phase.doneWhen` / `phase.testTargets` on `PhaseSchema`; no schema change (DM-000) |
| `.gwrk/rules/workspace.md` (fail-fast config, TC-002) | A red Done-When on a test-less phase → `handleNoGo("TEST_GATE")` with a corrective message, never a silent pass; no `.default()` softening |
| TC-004 (liveness rule unchanged) | This phase does NOT modify `src/engine/test-runner.ts` (`ran = testsRun > 0`, `:113`); it only adds an exit-code path for phases with no test file |
| OQ-002 (deferred convergence) | Fix B runs the Done-When gate inline, overlapping `runGateCheck` (`gate.ts:160`); unifying onto the `gwrk gate` path is deferred, NOT done here |
| compile-gate | Always |

#### Test Strategy
| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-004 | integration | `src/engine/ship-orchestrator.review.test.ts` | A test-less phase (`getPhaseTestFiles() === []`, `testTargets: ['schema.prisma']`) whose `phase.doneWhen` exits 0 → TEST_GATE returns GO via the Done-When gate (no `0 tests` NO-GO); the same phase whose Done-When exits non-zero → `handleNoGo("TEST_GATE")` with the failing line named |
| TR-005 | integration | `src/engine/ship-orchestrator.review.test.ts` | `stageActivateTests` on a test-less phase returns `{ success: true }` via the `⏭ no phase-scoped test files found` path with **no** RED-liveness NO-GO; on a test-driven phase whose activated suite reports `testsRun === 0` it still returns `{ success: false }` |
| TR-006 | integration | `src/engine/ship-orchestrator.review.test.ts` | SEAM (Run #2207): (a) `testTargets: ['.env.example']` + co-located `env.test.js` → TEST_GATE runs `env.test.js`, prints no `scoped to: .env.example`, passes; (b) pure schema/migration, no test, green `doneWhen` → TEST_GATE passes via the Done-When gate |
| TR-007 | integration | `src/engine/ship-orchestrator.review.test.ts` | GUARD: a phase mapping a real `foo.test.js` whose suite reports `testsRun === 0` (cancelled) → TEST_GATE still `handleNoGo("TEST_GATE")`; assert `getPhaseTestFiles()` for that phase is non-empty (still test-driven) |

#### Done When
```bash
pnpm run build
pnpm vitest run src/engine/ship-orchestrator.review.test.ts
pnpm run test:ci
```

---

## Type Dependency Graph

| Shared Type / Symbol | Defined In | Consumed By |
|---|---|---|
| `isTestFile(relPath: string, testExt?: string): boolean` (new; pure path/regex predicate, single definition — TC-005) | `src/utils/test-discovery.ts` | `listTestsTree`, `discoverTestsForSources`, `phaseHasTests` (same file); `src/utils/test-discovery.test.ts` |
| `discoverTestsForSources(opts)` / `phaseHasTests(opts)` (existing signatures unchanged; declared-target arm now `isTestFile`-filtered) | `src/utils/test-discovery.ts` | `src/engine/ship-orchestrator.ts` (`getPhaseTestFiles`) |
| `getPhaseTestFiles() ⇒ [] ⇔ test-less` (the Fix-B discriminator; existing method, behavior sharpened by Fix A) | `src/engine/ship-orchestrator.ts` | `stageTestGate`, `stageActivateTests` |
| `phase.doneWhen` / `phase.testTargets` (existing `PhaseSchema` fields — read only, no change) | `src/utils/state.ts` (`PhaseSchema`, ADR-003) | `src/engine/ship-orchestrator.ts` (`runDoneWhenGate`, `getPhaseTestFiles`) |
| `ran = testsRun > 0` liveness (existing; **not modified** — TC-004 / VR-006) | `src/engine/test-runner.ts:113` (ADR-005 §10.2.1) | `stageTestGate` / `stageActivateTests` (unchanged usage) |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._ It is a deterministic test-discovery predicate + ship-orchestrator verifier change with no UI surface.

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| OQ-002 (spec §13) | Converge TEST_GATE's Done-When execution onto the `gwrk gate` command path (`runGateCheck`, `isHollowGate`) | Fix B runs the Done-When gate inline to keep this fix small and low-risk; unifying the two gate runners is a separate refactor | Future follow-up feature |
| Out of scope (spec §1) | Re-author existing specs' Test-Strategy tables so gate TRs stop naming config files as test targets | Content work, not a discovery/orchestrator change; Fix A makes the pipeline robust to those inputs without rewriting them | Per-spec definitional work |
| Out of scope (spec §1) | Change the liveness rule (`test-runner.ts:113`, ADR-005 §10.2.1) | Unchanged by design (TC-004 / VR-006); Fix A narrows what counts as a test *file*, Fix B adds an exit-code path only for test-less phases | specs/000 ADR-005 |
| OQ-003 (spec §13) | Extend `isTestFile` for unconventional real-test naming not covered by the regex or `testExt` | Acceptable edge; single-definition (TC-005) means one future edit covers all call sites if a real case surfaces | Future single-line extension |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 (config/schema file not classed as a test) | Phase 1 | Planned |
| US-002 (non-test target but real co-located test runs) | Phase 1 | Planned |
| US-003 (test-less phase verified by Done-When gate) | Phase 2 | Planned |
| US-004 (ACTIVATE_TESTS skips RED-liveness for test-less) | Phase 2 | Planned |
| US-005 (real test running 0 tests still NO-GOs — guard) | Phase 2 | Planned |
| FR-001 (`discoverTestsForSources` declared-target `isTestFile` filter) | Phase 1 | Planned |
| FR-002 (`phaseHasTests` declared-target `isTestFile` filter) | Phase 1 | Planned |
| FR-003 (single exported `isTestFile` predicate) | Phase 1 | Planned |
| FR-004 (test-less Done-When gate, pass iff exit 0) | Phase 2 | Planned |
| FR-005 (RED-liveness scoped to test-driven at ACTIVATE_TESTS) | Phase 2 | Planned |
| FR-006 (test-driven `testsRun === 0` still NO-GOs) | Phase 2 | Planned |
| FR-001/002/003 Error States (pure library, no exit contract) | Phase 1 | Planned |
| FR-004/006 Error States (TEST_GATE messages) | Phase 2 | Planned |
| FR-005 Error States (ACTIVATE_TESTS messages) | Phase 2 | Planned |
| TR-001 | Phase 1 | Planned |
| TR-002 | Phase 1 | Planned |
| TR-003 | Phase 1 | Planned |
| TR-004 | Phase 2 | Planned |
| TR-005 | Phase 2 | Planned |
| TR-006 (SEAM — would have caught Run #2207) | Phase 2 | Planned |
| TR-007 (liveness guard) | Phase 2 | Planned |
| TC-001 (air-gapped) | Phases 1–2 | Planned |
| TC-002 (fail-fast config) | Phase 2 | Planned |
| TC-003 (TypeScript only) | Phases 1–2 | Planned |
| TC-004 (liveness rule unchanged — `test-runner.ts` untouched) | Phases 1–2 (structural: no phase declares `src/engine/test-runner.ts`) | Planned |
| TC-005 (single test-file predicate) | Phase 1 (Done When greps `isTestFile` ≥2 sites) | Planned |
| TC-006 (bare-clone, no binary to classify) | Phase 1 (`isTestFile` pure; TR-003) | Planned |
| SC-001 (no `scoped to: <config>`, no `0 tests` NO-GO) | Phase 2 (TR-006, VR-004); enabled by Phase 1 | Planned |
| SC-002 (co-located real test runs, config never scoped) | Phase 2 (TR-006); Phase 1 (TR-003) | Planned |
| SC-003 (test-less phase positively verified by Done-When) | Phase 2 (TR-004) | Planned |
| SC-004 (liveness unchanged for test-driven; suites green) | Phase 2 (TR-005, TR-007, VR-005, VR-006); Phase 1 | Planned |
| SC-005 (one `isTestFile` definition; three call sites) | Phase 1 (TR-003, VR-003) | Planned |
| VR-001 (`pnpm run build` clean) | Phases 1–2 (Done When: `pnpm run build`) | Planned |
| VR-002 (`test-discovery.test.ts` + `ship-orchestrator.review.test.ts` exit 0) | Phase 1 + Phase 2 (Done When) | Planned |
| VR-003 (`isTestFile` exported + ≥2 call sites) | Phase 1 (Done When greps) | Planned |
| VR-004 (SEAM: no `scoped to: .env.example`; `Done-When gate passed`) | Phase 2 (TR-006) | Planned |
| VR-005 (`pnpm run test:ci` green — no regression) | Phase 2 (Done When: `pnpm run test:ci`) | Planned |
| VR-006 (`src/engine/test-runner.ts` not modified) | Phases 1–2 (structural: no phase declares that file; TC-004) | Planned |
| DM-000 (no new entities / no schema change) | Phases 1–2 | Leveraged (no data-model.md) |
| Agent-Native compliance (§12 — two ship stages, no new command) | Phase 2 | Planned |

Every US/FR/TR/TC/SC/VR item is assigned to a phase (or leveraged structurally). DM items: none (DM-000 — no schema change → no `data-model.md`). No unaccounted items.
