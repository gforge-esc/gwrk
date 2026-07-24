# 021 — Polyglot Test-Toolchain · Plan

> Decision record: ADR-005 §11. Spec: [spec.md](./spec.md). Delivered on `feat/021-polyglot-toolchain` (PR #140 → develop).

Test-toolchain support lives in the `ProjectProfile` / `GwrkConfig` / `toolchain-mapper` layer, not the plugin system (ADR-006 scopes plugins to agent backends; ADR-005 §9 rejected a toolchain plugin). This completes §9 and reconciles §10.

## Phases

| Phase | Scope | FRs | Status |
|---|---|---|---|
| 01 | Spec reconciliation: ADR-005 §11 + §9/§10 corrections; 000-tdd FR-001/003/008/009; 004 FR-024/DM-003; 020 DM-001; this spec | — | ✅ `00cbdf2` |
| 02 | `ToolchainConfigSchema` + `TEST_HARNESSES`; `project.toolchain` + `workspaces[].toolchain` (Zod); widen `ProjectProfile.toolchain`; validated `detectProfile` merge | FR-001, FR-010 | ✅ `00cbdf2` |
| 03 | Mapper: JS extension + override; `getTestCommand → string\|null`; `getBuildCommand`; `TEST_INVOCATION_VERBS`; SEAM test | FR-002/003/004 | ✅ `00cbdf2` |
| 04 | `PhaseSchema.testTargets` (persisted); `declaredTargets` in `phaseHasTests`/`discoverTestsForSources` | FR-005 | ✅ `e1c0e81` |
| 05a | Wire `declaredTargets` into ship pre-flight + `getPhaseTestFiles` | FR-005/006 | ✅ `d92bcc0` |
| 05b | BUILD_CHECK → `getBuildCommand` + skip message; TEST_GATE null-skip; prompt de-hardcode | FR-004/006 | ✅ `bacf76f` |
| 06 | Polyglot hollow-gate lint (`FUNCTIONAL_VERBS` ← `TEST_INVOCATION_VERBS`) | FR-007 | ✅ `3d164ef` |
| 07 | `gwrk init` persists `project.toolchain` (resolved extensions) | FR-008 | ✅ `dbd7b41` |
| 08 | Integration `Done-When` auto-run gate under liveness (`isIntegrationTestCommand` + `runIntegrationGate`) | FR-009 | ✅ `74c26a7` |
| 09 | Docs close-out: this plan, 004 status flip, gap-matrix | — | ✅ (this commit) |

## Verification

`pnpm build` clean; `pnpm test:ci` passing except the 3 pre-existing `server.test.ts` start failures (present on develop). ~+44 tests across the branch, including the SEAM test (`toolchain-seam.test.ts`) driving the real `detectProfile → getTestExtension → phaseHasTests` chain with no injected extension.

## Deferred (tracked, non-JS-critical)

- `generateFilesystemGates` FM-fallback gate body still emits `pnpm vitest run` (works for `.test.js`; pytest/go would need the profile threaded into that generator).
- AC-level test↔criterion mapping beyond existence + declared-target (Invariant 4's stronger half).
- Unifying the two `.gwrkrc.json` readers (`detectProfile` raw read vs `loadConfig`) behind one `resolveProfile(config)`.
