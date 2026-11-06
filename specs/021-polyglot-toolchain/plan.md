# 021 — Polyglot Test-Toolchain · Plan

> Decision record: ADR-005 §11. Spec: [spec.md](./spec.md). Delivered on `feat/021-polyglot-toolchain` (PR #140 → develop).

Test-toolchain support lives in the `ProjectProfile` / `GwrkConfig` / `toolchain-mapper` layer, not the plugin system (ADR-006 scopes plugins to agent backends; ADR-005 §9 rejected a toolchain plugin). This completes §9 and reconciles §10.

## Phases

## Phase 1 — Spec Reconciliation and Toolchain Config Schema (3 SP)
- `src/utils/config.ts` (MODIFY: Add `ToolchainConfigSchema` and `TEST_HARNESSES`)
- `src/engine/profile-detector.ts` (MODIFY: Merge validated toolchain config)

## Phase 2 — Toolchain Mapper and Build/Test Commands (5 SP)
- `src/utils/toolchain-mapper.ts` (MODIFY: Add `getTestCommand`, `getBuildCommand`, and `TEST_INVOCATION_VERBS`)
- `src/utils/test-discovery.ts` (MODIFY: Support `declaredTargets` in `phaseHasTests`)

## Phase 3 — Ship Orchestrator and Gate Quality Integration (5 SP)
- `src/engine/ship-orchestrator.ts` (MODIFY: Route `BUILD_CHECK` and `TEST_GATE` through toolchain mapper)
- `src/utils/gate-quality.ts` (MODIFY: Wire `TEST_INVOCATION_VERBS` into hollow-gate check)
- `src/commands/init.ts` (MODIFY: Persist `project.toolchain` resolved extensions)

## Verification

`pnpm build` clean; `pnpm test:ci` passing except the 3 pre-existing `server.test.ts` start failures (present on develop). ~+44 tests across the branch, including the SEAM test (`toolchain-seam.test.ts`) driving the real `detectProfile → getTestExtension → phaseHasTests` chain with no injected extension.

## Deferred (tracked, non-JS-critical)

- `generateFilesystemGates` FM-fallback gate body still emits `pnpm vitest run` (works for `.test.js`; pytest/go would need the profile threaded into that generator).
- AC-level test↔criterion mapping beyond existence + declared-target (Invariant 4's stronger half).
- Unifying the two `.gwrkrc.json` readers (`detectProfile` raw read vs `loadConfig`) behind one `resolveProfile(config)`.
