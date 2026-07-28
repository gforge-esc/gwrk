# Requirements Checklist: 025-gate-only-phases

**Purpose**: Verify the gate-only-phases spec is complete, traceable, and free of orphans before planning.
**Created**: 2026-07-27
**Feature**: [spec.md](../spec.md)

## User Stories

- [ ] US-001 A gate-only phase's config/schema/migration file is not classified as a test (P0)
- [ ] US-002 A phase with a non-test target but a real co-located test runs the real test (P0)
- [ ] US-003 A test-less gate-only phase is verified by its Done-When gate, not by "no regression" (P0)
- [ ] US-004 ACTIVATE_TESTS skips RED-liveness for test-less phases, enforces it for test-driven (P1)
- [ ] US-005 Liveness stays honest: a real test that runs 0 tests still NO-GOs (P0, guard)

## Functional Requirements

- [ ] FR-001 `discoverTestsForSources` declared-target arm (`test-discovery.ts:59`) filters via `isTestFile` (US-001, US-002)
- [ ] FR-002 `phaseHasTests` declared-target arm (`test-discovery.ts:114`) filters via `isTestFile` (US-001)
- [ ] FR-003 export single `isTestFile(relPath, testExt?)` predicate (regex `:23` + `testExt`); one definition (US-001, US-002)
- [ ] FR-004 TEST_GATE verifies a test-less phase via its Done-When gate, pass iff exit 0; red → NO-GO (US-003)
- [ ] FR-005 ACTIVATE_TESTS skips RED-liveness for test-less phases; enforces it for test-driven (US-004)
- [ ] FR-006 GUARD: test-driven phase whose real suite runs 0 tests still NO-GOs (US-005)

## Testing Requirements

- [ ] TR-001 POSITIVE: `discoverTestsForSources` drops `.env.example`, keeps a real declared test (FR-001/FR-003)
- [ ] TR-002 POSITIVE: `phaseHasTests` false for `schema.prisma`, true for a real declared test (FR-002/FR-003)
- [ ] TR-003 MIXED: config target dropped, co-located real test kept; `isTestFile` unit true/false cases (FR-001/FR-003)
- [ ] TR-004 FR-004: test-less phase — green Done-When passes, red Done-When NO-GOs (names line) (FR-004)
- [ ] TR-005 FR-005: ACTIVATE_TESTS passes test-less phase; NO-GOs test-driven 0-tests phase (FR-005)
- [ ] TR-006 SEAM: Run #2207 — `.env.example` target no longer scoped; pure-schema phase passes via Done-When (FR-001/FR-003/FR-004)
- [ ] TR-007 GUARD: real `foo.test.js` running 0 tests still NO-GOs; `getPhaseTestFiles()` non-empty (FR-006)

## Error States

- [ ] FR-001/FR-002/FR-003 filter behavior table (non-test dropped; real test retained)
- [ ] FR-004/FR-006 TEST_GATE table (red Done-When → NO-GO; green → GO; 0-tests real suite → NO-GO)
- [ ] FR-005 ACTIVATE_TESTS table (test-less → success; test-driven 0 tests → fail)

## Technical Constraints

- [ ] TC-001 Air-Gapped; TC-002 Fail-Fast; TC-003 TypeScript-Only present
- [ ] TC-004 Liveness rule unchanged (`test-runner.ts:113`) — verified by VR-006
- [ ] TC-005 Single test-file predicate; all three call sites use it — verified by VR-003
- [ ] TC-006 Bare-clone: `isTestFile` invokes no binary (PR #153 parity)

## Quality Gate

- [ ] Every US maps to ≥1 FR; every FR maps to ≥1 US (no orphans)
- [ ] Every FR maps to ≥1 TR in the coverage matrix
- [ ] Every acceptance-scenario Then clause has an executable shell assertion
- [ ] Coverage matrix includes the Tested-by-TR column with zero orphans
- [ ] Changed stages (TEST_GATE, ACTIVATE_TESTS) have type classification, exit codes, error-as-navigation
- [ ] Cross-references to the brief, 024 (assertion), 023 (extraction), 021/ADR-005 §11 (declared targets) recorded; no contract conflict
- [ ] Must-not-regress guards explicit (FR-005, FR-006); liveness honest for test-driven phases
- [ ] Deferred TEST_GATE ↔ `gwrk gate` convergence captured (OQ-002)

## Notes
- Check items off as completed: `[x]`
- Items are numbered per the spec's FR-###, US-###, and TR-### identifiers
- Authoritative source: [`docs/ISSUE-ship-testgate-gate-only-phases.md`](../../../docs/ISSUE-ship-testgate-gate-only-phases.md)
