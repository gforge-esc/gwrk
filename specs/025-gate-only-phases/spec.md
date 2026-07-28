# Feature Specification: 025 Gate-Only Phases

**Feature Branch**: `025-gate-only-phases`
**Created**: 2026-07-27
**Status**: Draft
**Input**: `gwrk ship`'s TEST_GATE crashes and then blind-passes gate-only phases (schema/migration/config). Fix A: stop classifying non-test files (the Test-Strategy Target column, e.g. `.env.example` / `prisma/schema.prisma`) as tests in test-discovery. Fix B: verify a gate-only phase by running its Done-When gate (pass iff exit 0), and skip RED-liveness at ACTIVATE_TESTS for test-less phases — keeping liveness honest for test-driven phases. Full problem, evidence, both fixes, must-not-regress guards, acceptance tests, and a deferred TEST_GATE/gwrk-gate convergence are in the referenced brief.
**Authoritative source**: [`docs/ISSUE-ship-testgate-gate-only-phases.md`](../../docs/ISSUE-ship-testgate-gate-only-phases.md) — the pinpointed root-cause brief (repro: data-dashboard `004-github-project-adapter`, Run #2207). Every symptom, file/line, fix, guard, and acceptance test below is drawn from that brief and verified against the current source.

---

## 1. Overview

`gwrk ship` runs each phase through `IMPLEMENT → BUILD_CHECK → TEST_GATE`. TEST_GATE enforces **liveness** (ADR-005 §10.2.1): when a phase maps to test files, at least one test MUST actually execute (`testsRun > 0`) — a suite that discovered nothing or all-cancelled is a FAIL, never a vacuous pass. That rule is correct. The defect is **upstream of it**: a non-test file gets classified as a test, so TEST_GATE runs a "suite" that can never execute a test, reports `testsRun === 0`, and NO-GOs a phase whose code shipped correctly.

### The failure (observed — Run #2207)

Shipping `004-github-project-adapter` Phase 1 (a **gate-only** phase: config readers + a Prisma schema, verified by bare-clone greps + `config:inspect`, with no runnable unit test), TEST_GATE printed `scoped to: .env.example`, ran zero tests, and NO-GO'd — tripping the circuit breaker after 3 iterations even though `feat/004` already contained a correct `feat(004): implement Phase 1`.

```
▸ TEST_GATE
    scoped to: .env.example
  ✗ TEST_GATE: phase tests executed 0 tests (none discovered / all cancelled) — not a pass
  ↻ NO-GO → DIAGNOSE → IMPLEMENT ...
  ✗ CIRCUIT_BREAK — Circuit breaker tripped after 3 iterations
```

### Root cause (pinpointed, verified in source)

1. `define tasks` extracts the phase's `testTargets` from the plan's **Test Strategy → Target** column. For a gate-type TR (e.g. TR-011) that column names the file the gate *asserts about* — `` `.env.example`, `prisma/schema.prisma` `` — not a runnable test. So `tasks.json` phase-01 carries `"testTargets": [".env.example"]`.
2. `src/utils/test-discovery.ts:59` — `discoverTestsForSources` adds **any** declared target that exists, with no test-file check:
   ```ts
   for (const t of declaredTargets ?? []) if (fileExists(t)) found.add(t);
   ```
   `.env.example` exists → it is added to the discovered "tests". The parallel declared-target arm in `phaseHasTests` (`src/utils/test-discovery.ts:114`) has the same hole.
3. `src/engine/ship-orchestrator.ts:1010–1049` — `getPhaseTestFiles()` passes `declaredTargets: phase.testTargets` into `discoverTestsForSources`, so it returns `['.env.example']`.
4. `src/engine/ship-orchestrator.ts:850–861` — `stageTestGate()` sees `phaseTestFiles.length > 0`, runs the suite scoped to `.env.example`, gets `r.testsRun === 0`, and NO-GOs:
   ```ts
   if (phaseTestFiles.length > 0) {
     console.log(`    scoped to: ${phaseTestFiles.join(", ")}`);
     const r = await this.runTestSuite(phaseTestFiles);
     ...
     if (r.testsRun === 0) { return this.handleNoGo("TEST_GATE"); }  // ← the failure
   ```

The liveness rule itself (`src/engine/test-runner.ts:113`, `ran = testsRun > 0`; ADR-005 §10.2.1) is correct. The defect is that **a config file was classified as a test**.

### Why it did not bite before

`001-platform-foundation` shipped earlier with `echo "Phase 1: ..."` **stub gates**, before `testsRun > 0` liveness was enforced. Now that liveness is enforced, every gate-only phase whose `testTargets` name a non-test file (config / schema / migration) hits this. `003` P1 survives because it maps real logic (`windows.js`) with a bare-clone `node --test` (a real test runs, `testsRun > 0`).

### Blast radius

- **Blocks**: `004` P1 (config/schema) and P2 (migration); `cdo-success`; **any** config / schema / migration phase whose TRs target config/schema files.
- **Survives**: phases that map at least one real `*.test.*` with a live suite.

### The two coordinated fixes

- **Fix A — precise (test-discovery).** Only accept a declared target as a discovered test when it is an **actual test file**, using the module's own test-file predicate (the multi-language regex currently inline at `src/utils/test-discovery.ts:23`, reused as an exported `isTestFile`). Applied at both call sites (`:59` and `:114`). Effect: `.env.example` / `schema.prisma` are dropped; a co-located real test (e.g. `src/config/env.test.js`) is retained; a pure schema/migration phase yields `getPhaseTestFiles() === []`.
- **Fix B — positive verification (ship TEST_GATE / ACTIVATE_TESTS).** For a **test-less** phase (no real test maps after Fix A), verify the phase by **running its Done-When gate** (`phase.doneWhen` as a `set -e` bare-clone gate) and pass **iff exit 0** — an honest verification of the config/schema/migration work — instead of relying only on the weak "no regression" baseline. Correspondingly, ACTIVATE_TESTS skips RED-liveness for test-less phases (there is no test to make RED). For **test-driven** phases (≥1 real test maps), liveness stays exactly as-is: `testsRun === 0` NO-GOs at TEST_GATE and RED-liveness is enforced at ACTIVATE_TESTS.

**Discriminator (test-less vs test-driven).** A phase is **test-driven** when `getPhaseTestFiles()` (post-Fix-A) returns ≥1 real test file; otherwise it is **test-less**. Because Fix A removes only *non-test* declared targets, a real test that cancels still maps → the phase stays test-driven → its `testsRun === 0` still NO-GOs (guard preserved). This is why Fix B lives in the **test-less branch**, not at the brief's suggested line-857 (see [OQ-001](#13-open-questions)).

### Out of scope

- **Repairing the plans/tasks.json of existing specs.** Re-authoring Test Strategy tables so gate TRs stop naming config files as test targets is content work, not a discovery/orchestrator change. Fix A makes the pipeline robust to those inputs; it does not rewrite them.
- **Changing the liveness rule.** `testsRun > 0` (`test-runner.ts:113`; ADR-005 §10.2.1) is unchanged. Fix A narrows what counts as a test *file*; Fix B adds a Done-When exit-code path only for phases with **no** test file.
- **TEST_GATE ↔ `gwrk gate` convergence.** Fix B runs a phase's Done-When gate directly inside the orchestrator, overlapping `runGateCheck` (`src/commands/gate.ts:160`) and `isHollowGate` (`src/utils/gate-quality.ts`). Unifying TEST_GATE's gate execution with the `gwrk gate` command is a **deferred** follow-up ([OQ-002](#13-open-questions)); this feature does not refactor `runGateCheck`.

---

## 2. User Scenarios & Testing

### US-001 - A gate-only phase's config/schema/migration file is not classified as a test (Priority: P0)
As `gwrk ship` shipping a config/schema/migration phase whose `testTargets` name a non-test file (`.env.example`, `prisma/schema.prisma`), TEST_GATE no longer "scopes to" that file and no longer NO-GOs on `0 tests` — because test-discovery drops declared targets that are not actual test files.

**Implements**: FR-001, FR-002, FR-003

**Independent Test**: Call `discoverTestsForSources` with `declaredTargets: ['.env.example']` (existence-stubbed true) and no source test; assert the result does **not** contain `.env.example`. Call `phaseHasTests` with `declaredTargets: ['schema.prisma']` (exists) and no other coverage; assert it returns `false`.

**Acceptance Scenarios**:
1. **Given** a phase with `testTargets: ['.env.example']` and no source test, **When** discovery runs, **Then**:
   - `pnpm vitest run src/utils/test-discovery.test.ts -t "drops a non-test declared target"` exits 0
2. **Given** the current test-discovery module, **When** its predicate is inspected, **Then**:
   - `grep -qE 'export function isTestFile' src/utils/test-discovery.ts` exits 0
   - `pnpm vitest run src/utils/test-discovery.test.ts -t "isTestFile"` exits 0

### US-002 - A phase with a non-test target but a real co-located test runs the real test (Priority: P0)
As `gwrk ship` shipping a phase whose `testTargets` include a non-test file **and** whose source has a co-located real test (e.g. `src/config/env.js` → `src/config/env.test.js`), TEST_GATE runs the real test — not the config file — and passes.

**Implements**: FR-001, FR-003

**Independent Test**: Call `discoverTestsForSources` with `declaredTargets: ['.env.example']`, `sourceFiles: ['src/config/env.js']`, with both `.env.example` and `src/config/env.test.js` existence-stubbed true; assert the result contains `src/config/env.test.js` and excludes `.env.example`.

**Acceptance Scenarios**:
1. **Given** `declaredTargets: ['.env.example']` and an existing co-located `src/config/env.test.js`, **When** discovery runs, **Then**:
   - `pnpm vitest run src/utils/test-discovery.test.ts -t "keeps a co-located real test, drops the config target"` exits 0
2. **Given** the Run #2207 repro (a phase whose only declared target is `.env.example` alongside a co-located `env.test.js`), **When** TEST_GATE runs, **Then**:
   - `pnpm vitest run src/engine/ship-orchestrator.review.test.ts -t "runs the real co-located test, not the config target"` exits 0

### US-003 - A test-less gate-only phase is verified by its Done-When gate, not by "no regression" (Priority: P0)
As `gwrk ship` shipping a pure schema/migration/config phase with no test file, TEST_GATE **positively verifies** the phase by running its Done-When gate (`phase.doneWhen` under `set -e`) and passes **iff exit 0** — so the phase is proven done by its own bare-clone gate, and a red Done-When NO-GOs instead of silently passing on "tests didn't get worse".

**Implements**: FR-004

**Independent Test**: Drive TEST_GATE on a phase with `testTargets: ['schema.prisma']`, no source test, and a `doneWhen` whose commands exit 0; assert TEST_GATE passes via the Done-When gate (not a `0 tests` NO-GO). Repeat with a `doneWhen` command that exits 1; assert TEST_GATE NO-GOs.

**Acceptance Scenarios**:
1. **Given** a test-less phase whose `doneWhen` gate exits 0, **When** TEST_GATE runs, **Then**:
   - `pnpm vitest run src/engine/ship-orchestrator.review.test.ts -t "test-less phase passes via green Done-When gate"` exits 0
2. **Given** a test-less phase whose `doneWhen` gate exits non-zero, **When** TEST_GATE runs, **Then**:
   - `pnpm vitest run src/engine/ship-orchestrator.review.test.ts -t "test-less phase NO-GOs on red Done-When gate"` exits 0

### US-004 - ACTIVATE_TESTS skips RED-liveness for test-less phases, enforces it for test-driven phases (Priority: P1)
As `gwrk ship` at ACTIVATE_TESTS, a **test-less** phase (no real test maps) does not fail the RED-liveness check (there is no test to make RED), while a **test-driven** phase still must establish RED — so the `testsRun === 0` liveness hole cannot sneak in through ACTIVATE_TESTS, and a gate-only phase is not falsely blocked there.

**Implements**: FR-005

**Independent Test**: Drive ACTIVATE_TESTS on a test-less phase (`getPhaseTestFiles() === []`); assert it returns success without a RED-liveness NO-GO. Drive it on a test-driven phase whose activated suite runs 0 tests; assert it NO-GOs on RED-liveness.

**Acceptance Scenarios**:
1. **Given** a test-less phase at ACTIVATE_TESTS, **When** the stage runs, **Then**:
   - `pnpm vitest run src/engine/ship-orchestrator.review.test.ts -t "ACTIVATE_TESTS passes a test-less phase without RED-liveness"` exits 0
2. **Given** a test-driven phase whose activated suite runs 0 tests, **When** ACTIVATE_TESTS runs, **Then**:
   - `pnpm vitest run src/engine/ship-orchestrator.review.test.ts -t "ACTIVATE_TESTS NO-GOs a test-driven phase that runs 0 tests"` exits 0

### US-005 - Liveness stays honest: a real test that runs 0 tests still NO-GOs (Priority: P0, guard)
As `gwrk ship` on a **test-driven** phase mapping a real `*.test.*` whose suite discovers nothing or all-cancels (a before-hook threw → `testsRun === 0`), TEST_GATE **still** NO-GOs — Fix A filters only *declared targets*, so a genuinely-empty or cancelled real suite is untouched and cannot false-pass.

**Implements**: FR-006

**Independent Test**: Drive TEST_GATE on a phase mapping a real `foo.test.js` whose run reports `testsRun === 0` (cancelled); assert TEST_GATE NO-GOs. Confirm `getPhaseTestFiles()` for that phase is non-empty (the real test still maps).

**Acceptance Scenarios**:
1. **Given** a phase mapping a real `foo.test.js` whose suite runs 0 tests (cancelled), **When** TEST_GATE runs, **Then**:
   - `pnpm vitest run src/engine/ship-orchestrator.review.test.ts -t "still NO-GOs a real test suite that runs 0 tests"` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: `src/utils/test-discovery.ts` `discoverTestsForSources` MUST only add a `declaredTarget` to the discovered test set when it both exists **and** is an actual test file — i.e. the current `:59` line `for (const t of declaredTargets ?? []) if (fileExists(t)) found.add(t);` MUST become `… if (fileExists(t) && isTestFile(t, testExt)) found.add(t);`. A declared target that exists but is not a test file (`.env.example`, `prisma/schema.prisma`, any config/schema/migration file) MUST NOT be returned. Source-mapped, mentioned, co-located, and tests-tree discovery arms are unchanged. (Implements: US-001, US-002)
- **FR-002**: The parallel declared-target arm in `phaseHasTests` (`src/utils/test-discovery.ts:114`, `if ((declaredTargets ?? []).some((t) => fileExists(t))) return true;`) MUST apply the same `isTestFile` filter, so a non-test declared target does **not** register as phase coverage. Existence-based semantics for real tests are preserved (a mentioned/declared test that does not exist still does not count). (Implements: US-001)
- **FR-003**: `src/utils/test-discovery.ts` MUST export a single `isTestFile(relPath: string, testExt?: string): boolean` predicate that recognizes a path as a test file when its basename matches the module's multi-language test regex (currently inline in `listTestsTree` at `:23` — `/\.(test|spec)\.[jt]s$|_test\.(go|py)$|test_.*\.py$/`) **or** the path ends with the profile's `testExt`. `listTestsTree`, FR-001, and FR-002 MUST all route through this one predicate so "what is a test file" has exactly one definition. (Implements: US-001, US-002)
- **FR-004**: In `stageTestGate` (`src/engine/ship-orchestrator.ts`), when a phase is **test-less** (`getPhaseTestFiles()` returns `[]` after Fix A) **and** the phase declares a Done-When gate (`phase.doneWhen` non-empty), TEST_GATE MUST run that Done-When gate as a `set -e` bare-clone gate and pass **iff its exit code is 0**; a non-zero exit MUST NO-GO (`handleNoGo("TEST_GATE")`) with a message naming the failing Done-When line. This runs the **full** Done-When (not only the `isIntegrationTestCommand` subset that `runIntegrationGate` executes today), so config/schema/migration gates (`grep`, `config:inspect`) are actually verified. A test-less phase with **no** `doneWhen` retains the existing baseline "no regression" pass — Fix B strengthens, never weakens, the test-less path. The `testsRun > 0` liveness rule MUST NOT be applied to a Done-When gate (a config gate asserts by exit code, not by test count). (Implements: US-003)
- **FR-005**: In `stageActivateTests` (`src/engine/ship-orchestrator.ts`), RED-liveness (`red.testsRun === 0 → NO-GO`, `:517`) MUST apply only to **test-driven** phases. A **test-less** phase (`getPhaseTestFiles()` returns `[]`) MUST return success at ACTIVATE_TESTS without a RED-liveness failure — the existing early return at `:486` (`if (testFiles.length === 0)`) already provides this, and Fix A MUST NOT regress it (a genuinely-empty *real* RED suite for a test-driven phase MUST still NO-GO at `:517`). (Implements: US-004)
- **FR-006**: `stageTestGate` MUST keep liveness honest for **test-driven** phases: a phase mapping ≥1 real test file whose suite reports `testsRun === 0` (nothing discovered / all cancelled) MUST still `handleNoGo("TEST_GATE")` (the current `:857–861` behavior). Fix A MUST NOT alter the source-mapped / mentioned / co-located / tests-tree arms, so a real cancelled suite is untouched by this feature and cannot false-pass. (Implements: US-005)

#### FR-001/FR-002/FR-003 Error States
_Pure library functions — no process exit. They return filtered results; no stderr/exit-code contract._
| Condition | Behavior | Return |
|---|---|---|
| `declaredTargets` contains an existing non-test file | Filtered out of results | Excluded from `discoverTestsForSources`; does not satisfy `phaseHasTests` |
| `declaredTargets` contains an existing real test file | Retained | Included in `discoverTestsForSources`; satisfies `phaseHasTests` |

#### FR-004/FR-006 Error States (TEST_GATE)
| Condition | stdout/stderr contains | Exit code / result |
|---|---|---|
| Test-less phase, Done-When gate exits non-zero | `✗ TEST_GATE: Done-When gate failed for <phase-id> ('<offending line>')` | `handleNoGo("TEST_GATE")` |
| Test-less phase, Done-When gate exits 0 | `✓ TEST_GATE: Done-When gate passed (<phase-id>)` | GO → CODE_REVIEW |
| Test-less phase, no `doneWhen` declared | (existing) `✓ tests passed (0 failures)` / no-regression message | GO → CODE_REVIEW (baseline path) |
| Test-driven phase, real suite runs 0 tests (cancelled) | (existing) `✗ TEST_GATE: phase tests executed 0 tests (none discovered / all cancelled) — not a pass` | `handleNoGo("TEST_GATE")` |

#### FR-005 Error States (ACTIVATE_TESTS)
| Condition | stdout/stderr contains | Exit code / result |
|---|---|---|
| Test-less phase (no test files) | (existing) `⏭ no phase-scoped test files found` | `{ success: true, exitCode: 0 }` |
| Test-driven phase, activated suite runs 0 tests | (existing) `✗ ACTIVATE_TESTS: activated tests executed 0 tests — cannot establish RED (ADR-005 §10.2.1)` | `{ success: false, exitCode: 1 }` |

---

## 5. Data Model Requirements

_No new database entities. See DM-000._

This feature adds no schema and no new persisted state. It operates on the existing `PhaseSchema` (`src/utils/state.ts:35`) — reading `phase.testTargets` (`:43`) and `phase.doneWhen` (`:40`), both already present — and on the existing test-discovery / ship-orchestrator contracts. No `tasks.json` shape change is required; Fix A makes the pipeline robust to the existing `testTargets` content.

---

## 6. Technical Constraints

- **TC-001**: Air-Gapped — No external network calls at runtime. No CDN. No telemetry. Test-discovery filtering and the Done-When gate run locally.
- **TC-002**: Fail-Fast Config — Zod validation with no `.default()` calls. Fix B is itself fail-fast: a red Done-When gate on a test-less phase → `handleNoGo("TEST_GATE")` with a corrective message, never a silent pass.
- **TC-003**: TypeScript Only — No `.js`/`.jsx` in `src/`. ESM modules, ES2022 target.
- **TC-004**: Liveness rule unchanged — `test-runner.ts:113` (`ran = testsRun > 0`; ADR-005 §10.2.1) and its use for test-driven phases MUST NOT be modified. Fix A narrows what counts as a test *file*; Fix B adds an exit-code path only for phases with **no** test file. No test-driven phase becomes a vacuous pass.
- **TC-005**: Single test-file predicate — "what is a test file" MUST have exactly one definition (`isTestFile`, FR-003). `listTestsTree`, `discoverTestsForSources`, and `phaseHasTests` MUST all use it; no duplicated/divergent regex.
- **TC-006**: Bare-clone discovery — test-discovery is existence-based and MUST NOT invoke any binary to classify a file (parity with the which-only extension-detection rule, PR #153). `isTestFile` is a pure path/regex check.

---

## 7. Testing Requirements

- **TR-001** (FR-001/FR-003, POSITIVE): `src/utils/test-discovery.test.ts` — `discoverTestsForSources` with `declaredTargets: ['.env.example']` (existence-stubbed true) and no other coverage returns a set that **excludes** `.env.example`. A parallel case with `declaredTargets: ['tests/auth/human-flow.test.js']` (a real test, existence-stubbed true) still **includes** it (no regression to the legitimate declared-target arm from 021 FR-005). Vitest.
- **TR-002** (FR-002/FR-003, POSITIVE): `src/utils/test-discovery.test.ts` — `phaseHasTests` with `declaredTargets: ['schema.prisma']` (exists) and no source/co-located/tree test returns `false`; with `declaredTargets: ['tests/x.test.js']` (exists) returns `true`. Confirms a non-test declared target is not counted as coverage while a real one still is. Vitest.
- **TR-003** (FR-001/FR-003, MIXED): `src/utils/test-discovery.test.ts` — `discoverTestsForSources` with `declaredTargets: ['.env.example']`, `sourceFiles: ['src/config/env.js']`, and both `.env.example` and `src/config/env.test.js` existence-stubbed true returns a set containing `src/config/env.test.js` and **not** `.env.example` (the co-located real test survives, the config target is dropped). Plus a direct `isTestFile` unit: true for `foo.test.ts`/`bar_test.go`/`test_x.py`/(profile `testExt`); false for `.env.example`/`prisma/schema.prisma`/`config.yaml`. Vitest.
- **TR-004** (FR-004, POSITIVE + NEGATIVE): `src/engine/ship-orchestrator.review.test.ts` — a test-less phase (`getPhaseTestFiles() === []`, `testTargets: ['schema.prisma']`) whose `phase.doneWhen` commands exit 0 → TEST_GATE returns GO via the Done-When gate (no `0 tests` NO-GO); the same phase whose Done-When exits non-zero → TEST_GATE `handleNoGo("TEST_GATE")` with the failing line named. Vitest (orchestrator harness with a stubbed phase + Done-When runner).
- **TR-005** (FR-005): `src/engine/ship-orchestrator.review.test.ts` — `stageActivateTests` on a test-less phase (`getPhaseTestFiles() === []`) returns `{ success: true }` with the `⏭ no phase-scoped test files found` path and **no** RED-liveness NO-GO; on a test-driven phase whose activated suite reports `testsRun === 0` it still returns `{ success: false }` (RED-liveness enforced). Vitest.
- **TR-006** (SEAM, FR-001/FR-003/FR-004): `src/engine/ship-orchestrator.review.test.ts` — the exact Run #2207 case end-to-end: a phase with `testTargets: ['.env.example']` (a) with a co-located `env.test.js` → TEST_GATE runs `env.test.js`, prints no `scoped to: .env.example`, and passes; (b) pure schema/migration with no test but a green `doneWhen` → TEST_GATE passes via the Done-When gate. This is the coverage that would have caught Run #2207. Vitest.
- **TR-007** (GUARD, FR-006): `src/engine/ship-orchestrator.review.test.ts` — a phase mapping a real `foo.test.js` whose suite reports `testsRun === 0` (cancelled) → TEST_GATE still `handleNoGo("TEST_GATE")`; assert `getPhaseTestFiles()` for that phase is non-empty (the real test still maps, so it stays test-driven). This is the must-not-regress guard for liveness. Vitest.

---

## 8. Success Criteria

- **SC-001**: Shipping a gate-only phase whose `testTargets` name only non-test files (`.env.example`, `prisma/schema.prisma`) no longer prints `scoped to: <config file>` and no longer NO-GOs on `0 tests` — the Run #2207 circuit-break does not recur.
- **SC-002**: A phase with a non-test target **and** a co-located real test runs the real test and passes; the config file never appears in the scoped suite.
- **SC-003**: A pure test-less gate-only phase is **positively verified** — TEST_GATE passes iff its Done-When gate exits 0, and a red Done-When NO-GOs (no blind "no regression" pass over a broken gate).
- **SC-004**: Liveness is unchanged for test-driven phases — a real test suite that runs 0 tests (cancelled) still NO-GOs at TEST_GATE and RED-liveness still fires at ACTIVATE_TESTS; existing gate/liveness tests remain green under `pnpm run test:ci`.
- **SC-005**: "What is a test file" has exactly one definition (`isTestFile`); `listTestsTree`, `discoverTestsForSources`, and `phaseHasTests` all use it.

---

## 9. Verification Requirements

- **VR-001**: `pnpm run build` is clean (no TypeScript errors) after the `test-discovery.ts` and `ship-orchestrator.ts` changes.
- **VR-002**: `pnpm vitest run src/utils/test-discovery.test.ts` and `pnpm vitest run src/engine/ship-orchestrator.review.test.ts` exit 0.
- **VR-003**: `grep -qE 'export function isTestFile' src/utils/test-discovery.ts` exits 0, and the two declared-target sites route through it: `grep -qE 'isTestFile\(' src/utils/test-discovery.ts` returns ≥2 matches (`grep -c` ≥ 2).
- **VR-004**: On the SEAM fixture (TR-006), TEST_GATE output for the config-only phase contains **no** `scoped to: .env.example` line, and the pure-schema phase passes via a `Done-When gate passed` message.
- **VR-005**: `pnpm run test:ci` is green — existing TEST_GATE / ACTIVATE_TESTS / liveness suites (`ship-orchestrator.test.ts`, `ship-orchestrator.e2e.test.ts`, `test-runner` tests) confirm Fix A/B introduce no regression to test-driven phases (SC-004 guard).
- **VR-006**: `git diff --name-only` shows `src/engine/test-runner.ts` is **not** modified (TC-004 — the liveness rule is untouched).

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-002, FR-003 | FR-001 | US-001, US-002 | TR-001, TR-003, TR-006 |
| US-002 | FR-001, FR-003 | FR-002 | US-001 | TR-002 |
| US-003 | FR-004 | FR-003 | US-001, US-002 | TR-001, TR-002, TR-003 |
| US-004 | FR-005 | FR-004 | US-003 | TR-004, TR-006 |
| US-005 | FR-006 | FR-005 | US-004 | TR-005 |
|  |  | FR-006 | US-005 | TR-007 |

All FRs map to ≥1 US and ≥1 TR. All TRs trace to an FR. No orphans.

| Other spec item | Verified by |
|---|---|
| TC-001…TC-006 | VR-001, VR-006; TC-005 by VR-003; TC-006 by TR-003 (pure predicate, no binary) |
| SC-001 | TR-006, VR-004 |
| SC-002 | TR-003, TR-006 |
| SC-003 | TR-004 |
| SC-004 | TR-005, TR-007, VR-005, VR-006 |
| SC-005 | TR-003, VR-003 |
| DM-000 | No new entities (§5) |

---

## 11. Cross-References

- **`docs/ISSUE-ship-testgate-gate-only-phases.md`** (authoritative) — the root-cause brief. This spec implements its Fix A (test-discovery declared-target filter) and Fix B (Done-When gate verification + ACTIVATE_TESTS RED-liveness scoping), adds its three named acceptance tests (TR-004/TR-006/TR-007), and honors its must-not-regress guards (FR-005, FR-006).
- **024-gate-assertion-contract** — established that a Done-When gate line verifying a command asserts on its **exit code** (run directly under `set -e`), not by grepping output. Fix B **depends on** that contract: running a gate-only phase's Done-When and trusting its exit code is sound precisely because 024 made Done-Whens exit-based. No conflict — 025 changes discovery + orchestrator; 024 changed the generator prompt + `plan-gate-validator`. 025 does **not** modify `gate.ts` / `set -e` semantics (owned by 023 §13 / PR #150 / 024 TC-005).
- **023-plan-format-contract** — Layer 1 (extraction) compiled a phase's fenced-bash Done-When into `gateScript`. 025 consumes the resulting `phase.doneWhen` for Fix B; it does not alter extraction.
- **021-polyglot-toolchain (FR-005) / ADR-005 §10.2 Invariant 4, §11** — the "declared target" discovery arm 025 tightens. 025 keeps a *real* declared test (021's use case: a behavior-named out-of-tree suite with no basename match) working; it only drops declared targets that are not test files. TR-001/TR-002 assert the legitimate arm is preserved.
- **ADR-005 §10.2.1 (liveness) / §10.4 (integration Done-When gates)** — 025 preserves §10.2.1 for test-driven phases (FR-006) and generalizes §10.4: `runIntegrationGate` runs only the `isIntegrationTestCommand` subset of Done-When; Fix B runs the **full** Done-When for a test-less phase so config/schema/migration gates are actually verified.
- **PR #153 (which-only extension detection)** — TC-006 parity: test-discovery never invokes a binary to classify a file; `isTestFile` is a pure path check.

---

## 12. Agent-Native Compliance

No new CLI commands. Two existing `gwrk ship` stages change behavior (no new user-facing command surface):

| Stage / command | Type | New behavior | Exit codes / result | Error-as-navigation | `--format json` |
|---|---|---|---|---|---|
| `gwrk ship` → TEST_GATE (`stageTestGate`) | verifier | Non-test declared targets no longer scoped as tests (Fix A); a test-less phase verified by its Done-When gate, pass iff exit 0 (Fix B) | GO (→ CODE_REVIEW) / `handleNoGo("TEST_GATE")` | On a red Done-When gate, stderr names the `<phase-id>` and the offending Done-When line; the false `scoped to: <config file>` line is gone | inherits ship's existing `--format`/event stream; no new flag |
| `gwrk ship` → ACTIVATE_TESTS (`stageActivateTests`) | verifier | RED-liveness scoped to test-driven phases; test-less phases pass without a RED-liveness NO-GO (Fix B) | `{ success: true, exitCode: 0 }` (test-less) / `{ success: false, exitCode: 1 }` (test-driven, 0 tests) | Test-driven 0-tests message unchanged (`cannot establish RED`); test-less phases take the `⏭ no phase-scoped test files found` path | inherits ship's existing output protocol |

---

## 13. Open Questions

- **OQ-001 (resolved → test-less branch, not line-857)**: The brief suggests Fix B at `ship-orchestrator.ts:857` (inside the `phaseTestFiles.length > 0` / `testsRun === 0` branch). Placing an unconditional "green Done-When ⇒ pass" there would **collide** with the must-not-regress guard (FR-006): a real `*.test.*` that cancels (`testsRun === 0`) must still NO-GO. Resolved by gating Fix B on the phase being **test-less** (`getPhaseTestFiles()` empty after Fix A). Because Fix A removes only *non-test* declared targets, a real cancelled test still maps → the phase stays test-driven → the `:857` NO-GO stands. Fix B therefore lives in the test-less path, honoring both the brief's intent (positively verify gate-only phases) and the guard.
- **OQ-002 (deferred — TEST_GATE ↔ `gwrk gate` convergence)**: Fix B runs a phase's Done-When gate directly in the orchestrator (a `set -e` bare-clone execution), duplicating logic already in `runGateCheck` (`src/commands/gate.ts:160`, including its `set -e` inline path and `isHollowGate` guard). A future feature should converge TEST_GATE's gate execution onto the `gwrk gate` command path so there is one gate runner. Out of scope here to keep this fix small and low-risk; tracked for a follow-up.
- **OQ-003**: Fix A's `isTestFile` uses the existing multi-language regex plus the profile `testExt`. A project whose real tests use an unconventional naming scheme not covered by either would have its declared target dropped. Acceptable: such a target should be reachable via `testExt` or a conventional name; if a real-world case surfaces, extend `isTestFile` (single-definition, TC-005, so one edit covers all call sites).
