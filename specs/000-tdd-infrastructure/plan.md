---
type: implementation_plan
feature: 000-tdd-infrastructure
last_modified: "2026-03-17T01:10:00Z"
revision: 3
---

# Implementation Plan: 000 TDD Infrastructure

**Spec**: [spec.md](spec.md) (revision 3)
**ADR**: [ADR-005 TDD Gate Architecture](../../docs/decisions/ADR-005-tdd-gate-architecture.md) (§1–8)
**Status**: In Progress

---

## Phase 0: Prior Work (Complete)

Phase 0 represents work already shipped in revisions 1–2 of this feature. Preserved for traceability.

### Delivered
- `generateGateBrief()` in `gate-gen.ts` (was `generateGates()` → refactored per ADR-005)
- `tasks-generate.ts` updated for LLM dispatch and contracts guard
- `ship.ts` updated with pre-flight gate check
- `test.ts` command added
- `specs/000-tdd-infrastructure/contracts/` written (gate-gen.md, tasks-generate.md, ship-preflight.md)
- `specs/000-tdd-infrastructure/checklists/` written
- Phase 3 (003-slack remediation) attempted and UAT-reviewed

---

## Phase 1: ADR + Contracts (Document-Only)

**Status**: ✅ Complete

### Files

| Target | Action |
|--------|--------|
| `docs/decisions/ADR-005-tdd-gate-architecture.md` | Modify: add §8 Amendment |
| `specs/000-tdd-infrastructure/contracts/gap-matrix.md` | Create: gap matrix schema |
| `specs/000-tdd-infrastructure/contracts/gate-gen.md` | Modify: add `generateVitestGates()` |
| `specs/000-tdd-infrastructure/contracts/tasks-generate.md` | Modify: add gap matrix consumption flow |

### Requirements Addressed
- ADR-005 §8: Triad Model architecture, gate generation strategy, pipeline reorder
- FR-010: Gap matrix schema defined in contracts
- FR-012: `generateVitestGates()` contract specified
- FR-002: Updated gate authoring flow with gap matrix path

### Dependencies
- None — this phase is pure documentation

### Contract Mapping

| Contract | Methods/Sections Defined |
|----------|------------------------|
| `gap-matrix.md` | Schema, column definitions, test type classification, invariants, consumers |
| `gate-gen.md` | `generateVitestGates()` method, behavior table, generated gate format, invariants |
| `tasks-generate.md` | Updated gate authoring flow, `--no-llm` flag behavior with gap matrix |

### Test Strategy
- No tests — document-only phase
- Validated by manual review of ADR consistency and contract completeness

### Done When
- `test -f docs/decisions/ADR-005-tdd-gate-architecture.md && grep -q "§8" docs/decisions/ADR-005-tdd-gate-architecture.md` exits 0
- `test -f specs/000-tdd-infrastructure/contracts/gap-matrix.md` exits 0
- `grep -q "generateVitestGates" specs/000-tdd-infrastructure/contracts/gate-gen.md` exits 0
- `grep -q "gap-matrix" specs/000-tdd-infrastructure/contracts/tasks-generate.md` exits 0

---

## Phase 2: Spec + Workflows (Document + Config)

**Status**: In Progress

### Files

| Target | Action |
|--------|--------|
| `specs/000-tdd-infrastructure/spec.md` | Rewrite: new FRs 10-12, modified FRs 1-3, DM-004, TRs 10-12 |
| `.agents/workflows/define-tests.md` | Modify: add Step 2b (gap matrix generation) |
| `.agents/workflows/plan-to-tasks.md` | Modify: remove Step 4 (gap analysis), reference gap matrix |
| `.agents/workflows/author-gates.md` | Modify: add gap matrix preamble, vitest gate path |
| `specs/000-tdd-infrastructure/checklists/requirements.md` | Update: add FR-010/011/012 |

### Requirements Addressed
- FR-001 (modified): gate standard reframed — transitional vs target state
- FR-002 (modified): gap matrix consumption + LLM fallback
- FR-003 (modified): define tests now produces gap matrix + RED tests
- FR-010 (new): define tests produces gap-matrix.md
- FR-011 (new): gap matrix internally auditable
- FR-012 (new): deterministic vitest gate generation

### Dependencies
- Phase 1 (contracts must exist before spec references them)

### Contract Mapping

| Contract | Spec Sections Defined |
|----------|----------------------|
| `gap-matrix.md` | FR-010, FR-011, DM-004, SC-009 |
| `gate-gen.md` | FR-001, FR-012, TR-001, TR-010, TR-011 |
| `tasks-generate.md` | FR-002, TR-002 |

### Governance & Skills Contract

| Rule | Location |
|------|----------|
| Spec-first: no implementation before approved spec | `.agents/rules/operating-model.md` |
| RAGB governance for feature status | `.agents/rules/operating-model.md` |

### Test Strategy
- No code tests — document-only phase
- Validated by cross-artifact consistency check (all FRs in spec have matching TRs and USs)

### Done When
- `grep -c "FR-012" specs/000-tdd-infrastructure/spec.md` returns `>= 1`
- `grep -q "gap.matrix\|gap-matrix" .agents/workflows/define-tests.md` exits 0
- `grep -q "gap.matrix\|gap-matrix" .agents/workflows/plan-to-tasks.md` exits 0
- `grep -q "vitest\|gap.matrix" .agents/workflows/author-gates.md` exits 0

---

## Phase 3: Source Code (Implementation)

**Status**: Not Started

### Files

| Target | Action |
|--------|--------|
| `src/utils/gate-gen.ts` | Modify: add `generateVitestGates()` function |
| `src/commands/tasks-generate.ts` | Modify: read gap matrix, call `generateVitestGates()`, LLM fallback |
| `src/utils/gate-gen.test.ts` | Modify: add tests for `generateVitestGates()` |
| `src/commands/tasks-generate.test.ts` | Modify: add tests for gap matrix consumption |

### Requirements Addressed
- FR-002: Gap matrix consumption in `tasks-generate.ts`
- FR-012: `generateVitestGates()` implementation in `gate-gen.ts`

### Dependencies
- Phase 1 (contracts define method signatures)
- Phase 2 (spec defines requirements; workflows define agent patterns)

### Contract Mapping

| File | Contract | Methods |
|------|----------|---------|
| `gate-gen.ts` | `contracts/gate-gen.md` | `generateVitestGates()` |
| `tasks-generate.ts` | `contracts/tasks-generate.md` | Gap matrix check, vitest gate path, LLM fallback |

### Governance & Skills Contract

| Rule | Location |
|------|----------|
| No magic values — config flows from .env | `workspace.md` |
| Fail-fast — missing config crashes immediately | `workspace.md` |
| TypeScript only in src/ — no .js files | `workspace.md` |

### Type Dependency Graph

```
gap-matrix.md (file on disk)
  └── parseGapMatrix() [new function in gate-gen.ts]
       └── GapMatrixRow interface [new type in gate-gen.ts]
            └── generateVitestGates() [new function in gate-gen.ts]
                 └── tasks-generate.ts (calls generateVitestGates before LLM dispatch)
```

### Test Strategy (TR-001, TR-002, TR-010, TR-011)
- `gate-gen.test.ts`: Test `generateVitestGates()` with mock gap matrix files — vitest gates generated for ✅ rows, structural rows skipped, AUTHORED gates preserved
- `tasks-generate.test.ts`: Test gap matrix consumption — deterministic gates generated when matrix exists, LLM fallback when matrix absent, `--no-llm` flag generates vitest gates but skips LLM

### Done When
- `pnpm vitest run src/utils/gate-gen.test.ts --reporter=verbose` exits 0
- `pnpm vitest run src/commands/tasks-generate.test.ts --reporter=verbose` exits 0
- `pnpm build` exits 0
- `pnpm lint` exits 0
- `grep -q "generateVitestGates" src/utils/gate-gen.ts` exits 0
- `grep -q "gap-matrix\|gapMatrix" src/commands/tasks-generate.ts` exits 0

---

## Phase 4: Verification + Dogfood (Audit)

**Status**: Not Started

### Files

| Target | Action |
|--------|--------|
| `specs/000-tdd-infrastructure/gap-matrix.md` | Create: produce gap matrix for 000 itself |
| `specs/000-tdd-infrastructure/checklists/requirements.md` | Update: verify all FRs covered |

### Requirements Addressed
- FR-010: Gap matrix produced for this feature (dogfooding)
- FR-011: Gap matrix auditable — every FR-### has ≥1 row
- SC-002: Full test suite green
- SC-007: Biome clean
- SC-009: Gap matrix exists for 000

### Dependencies
- Phase 3 (implementation must be complete before dogfooding)

### Test Strategy
- Full test suite: `pnpm test` exits 0
- Full build: `pnpm build` exits 0
- Lint: `pnpm lint` exits 0
- Gate runner: `bash specs/000-tdd-infrastructure/gates/run-all-gates.sh` exits 0

### Done When
- `pnpm test 2>&1 | tail -1 | grep -q "0 failed"` exits 0
- `pnpm build` exits 0
- `pnpm lint` exits 0
- `test -f specs/000-tdd-infrastructure/gap-matrix.md` exits 0
- `grep -c "FR-" specs/000-tdd-infrastructure/gap-matrix.md` returns `>= 12`

---

## Coverage Matrix

| FR | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|----|---------|---------|---------|---------|
| FR-001 | | ✅ spec | | |
| FR-002 | ✅ contracts | ✅ spec | ✅ impl | |
| FR-003 | | ✅ spec + workflows | | |
| FR-004 | | ✅ spec | | |
| FR-005 | | ✅ spec | | ⬜ audit |
| FR-006 | | ✅ spec | | ⬜ audit |
| FR-007 | | ✅ spec | | |
| FR-008 | | ✅ spec | | |
| FR-009 | | ✅ spec | | |
| FR-010 | ✅ contracts | ✅ spec + workflows | | ✅ dogfood |
| FR-011 | ✅ contracts | ✅ spec | | ✅ dogfood |
| FR-012 | ✅ contracts | ✅ spec | ✅ impl | ✅ verify |
