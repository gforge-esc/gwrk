# Contract: test-discovery `isTestFile` predicate & declared-target arms

**Feature**: 025-gate-only-phases | **Module**: `src/utils/test-discovery.ts` (Phase 1) → consumed by `src/engine/ship-orchestrator.ts` (Phase 2)

This feature adds **one** new public symbol (`isTestFile`) and sharpens the *behavior* (not the signatures) of two existing exports. It changes no data model (DM-000) and no Zod schema. The contract below is method-level: what must exist, what it accepts, and what it returns.

---

## §1 `isTestFile` (NEW — FR-003)

```ts
export function isTestFile(relPath: string, testExt?: string): boolean
```

**Purpose.** The single definition of "what is a test file" for the module (TC-005). `listTestsTree`, `discoverTestsForSources` (§2), and `phaseHasTests` (§3) MUST all route through it — no duplicated or divergent regex.

**Accepts.**
- `relPath` — a repository-relative path (or basename); only the basename is inspected for the regex arm.
- `testExt` — optional profile test extension (e.g. `.test.ts`, `_test.go`); when provided, a path ending in it is a test file.

**Returns.** `true` iff the basename matches the module's multi-language test regex `/\.(test|spec)\.[jt]s$|_test\.(go|py)$|test_.*\.py$/` **OR** (`testExt` given and) `relPath` ends with `testExt`; otherwise `false`.

**Guarantees.**
- **Pure** — no filesystem read, no process spawn, no binary invocation to classify a file (TC-006, parity with PR #153). Deterministic and air-gapped (TC-001).
- Recognizes: `foo.test.ts`, `foo.spec.js`, `bar_test.go`, `x_test.py`, `test_x.py`, and any path ending in the profile `testExt`.
- Rejects: `.env.example`, `prisma/schema.prisma`, `config.yaml`, and any config/schema/migration path.

**Error states.** None — total function, no throw, no process exit.

---

## §2 `discoverTestsForSources` declared-target arm (BEHAVIOR CHANGE — FR-001)

```ts
export function discoverTestsForSources(opts: {
  sourceFiles: string[]; mentionedTests: string[]; testExt: string;
  fileExists: (relPath: string) => boolean; testsTreeFiles: string[];
  declaredTargets?: string[];
}): string[]
```

**Signature unchanged.** The declared-target loop (`:59`) becomes:
`for (const t of declaredTargets ?? []) if (fileExists(t) && isTestFile(t, testExt)) found.add(t);`

**Contract.** A `declaredTarget` is added to the result **iff** it exists **and** `isTestFile(t, testExt)` is `true`. A declared target that exists but is not a test file (`.env.example`, `schema.prisma`) MUST NOT appear in the result. The source-mapped, mentioned, co-located, and tests-tree arms are unchanged (a co-located real test still surfaces; the config target does not).

---

## §3 `phaseHasTests` declared-target arm (BEHAVIOR CHANGE — FR-002)

```ts
export function phaseHasTests(opts: { /* same shape as §2 */ }): boolean
```

**Signature unchanged.** The declared-target arm (`:114`) becomes:
`if ((declaredTargets ?? []).some((t) => fileExists(t) && isTestFile(t, testExt))) return true;`

**Contract.** A non-test declared target does NOT register as phase coverage; a real declared test that exists still does. Existence semantics are preserved (a declared/mentioned test that does not exist never counts).

---

## §4 Discriminator — test-less vs test-driven (CONSUMED — Phase 2, FR-004/FR-005/FR-006)

`getPhaseTestFiles()` (in `src/engine/ship-orchestrator.ts`) delegates to §2. **After Fix A**:
- **test-less phase** ⇔ `getPhaseTestFiles()` returns `[]` (no real test maps; e.g. a config/schema/migration phase whose only `testTargets` are non-test files).
- **test-driven phase** ⇔ `getPhaseTestFiles()` returns ≥1 real test file.

**Consumers.**
- `stageTestGate` — test-less **and** `phase.doneWhen` non-empty ⇒ run the full Done-When under `set -e`, pass **iff exit 0** (FR-004). Test-driven `testsRun === 0` ⇒ `handleNoGo("TEST_GATE")` (FR-006, unchanged).
- `stageActivateTests` — test-less ⇒ early-return success, no RED-liveness (FR-005, existing `:486`). Test-driven `red.testsRun === 0` ⇒ NO-GO (existing `:517`).

**Invariant.** Because §2/§3 filter only *declared targets*, a real `*.test.*` that cancels still maps → the phase stays test-driven → its liveness NO-GO is untouched (no false-pass). The `ran = testsRun > 0` rule (`test-runner.ts:113`, ADR-005 §10.2.1) is **not** modified (TC-004 / VR-006).
