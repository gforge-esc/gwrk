# Contract: Gap Matrix — `gap-matrix.md`

**Source**: `specs/<feature>/gap-matrix.md`
**Spec**: FR-010, FR-011, ADR-005 §8

## Purpose

The gap matrix is a structured coverage audit that maps every acceptance criterion from the spec to a test type, a test file, and an existence status. It is produced by `gwrk define tests` and consumed by `gwrk define tasks` for deterministic gate generation.

## Schema

```markdown
| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
```

### Column Definitions

| Column | Type | Description |
|--------|------|-------------|
| AC | `string` | Acceptance criterion ID: `FR-###`, `US-###`, `TR-###`, or `SC-###` |
| Acceptance Criterion | `string` | Human-readable description from spec |
| Test Type | `enum` | `unit` \| `functional` \| `e2e` \| `structural` |
| Test File | `string \| —` | Relative path to test file, or `—` if none exists |
| Test Exists | `enum` | `✅` (file exists AND has matching describe/it block) \| `❌` (missing) |
| Gate | `string` | Task ID (`T###`) that this criterion gates, or `—` if not yet mapped |

### Test Type Classification

| Test Type | When to Use | Gate Strategy |
|-----------|------------|---------------|
| `unit` | Pure function, Zod schema, utility logic | `pnpm vitest run <file> --grep "<AC>"` |
| `functional` | API route, CLI command, integration point | `pnpm vitest run <file> --grep "<AC>"` |
| `e2e` | Shell script behavior, multi-step workflow | `pnpm vitest run <file> --grep "<AC>"` |
| `structural` | Document existence, config format, code pattern | `grep -q` / `test -f` / `jq` (transitional) |

## Behavior

| Input | Output |
|---|---|
| Spec with 9 FRs, all with tests | 9+ rows, all `Test Exists: ✅` |
| Spec with 9 FRs, 3 missing tests | 9+ rows, 3 with `Test Exists: ❌` |
| FR with multiple acceptance scenarios | One row per scenario (FR may span rows) |
| Non-code FR (documentation) | `Test Type: structural`, `Test File: —` or grep assertion |

## Invariants

1. Every `FR-###` from `spec.md` §4 MUST appear as at least one row
2. Every `TR-###` from `spec.md` §7 MUST appear as at least one row
3. Every row with `Test Exists: ❌` is a documented gap — `define tests` SHOULD fill it or document why
4. Test Type classification drives gate strategy:
   - `unit`/`functional`/`e2e` → deterministic vitest gate
   - `structural` → fallback assertion gate (transitional, not target state)
5. Gap matrix is regenerated on every `gwrk define tests` invocation (not append-only)
6. Gap matrix does NOT replace the spec — it is a derivative audit artifact

## Consumers

| Consumer | How It Uses Gap Matrix |
|----------|----------------------|
| `define tests` workflow | Produces it (Step 2b); uses it as the test writing plan |
| `define tasks` / `tasks-generate.ts` | Reads it to generate deterministic vitest gates |
| `author-gates` workflow | Checks it; skips LLM authoring for covered tasks |
| PE (human) | Reviews it as macro coverage audit |

## Example

```markdown
| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | Every gate has functional assertion | unit | gate-gen.test.ts | ✅ | T001 |
| FR-002 | define tasks calls LLM with GateBrief + contracts | functional | tasks-generate.test.ts | ✅ | T002 |
| FR-003 | define tests writes RED test files | functional | tests-generate.test.ts | ✅ | T003 |
| FR-008 | gwrk ship BLOCKED pre-flight if no tests | unit | ship.test.ts | ✅ | T005 |
| FR-010 | define tests produces gap-matrix.md | functional | tests-generate.test.ts | ❌ | T010 |
| FR-011 | Gap matrix is internally auditable | unit | gap-matrix.test.ts | ❌ | T011 |
| FR-012 | Gate generation deterministic for vitest tasks | unit | gate-gen.test.ts | ❌ | T012 |
```
