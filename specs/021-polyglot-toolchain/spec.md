# 021 — Polyglot Test-Toolchain

> **Status:** Specified · **Date:** 2026-07-23
> **Decision record:** ADR-005 §11
> **Reconciles:** ADR-005 §9/§10, 000-tdd-infrastructure FR-001/003/008/009, 004-ship-loop FR-022/023/024/025 + DM-003, 020-polyglot-monorepo DM-001

## 1. Overview

`gwrk` claims polyglot TDD support (ADR-005 §9) but only delivered it for TypeScript. `getTestExtension`
defaulted every non-Python/Go/Rust language — including **JavaScript** — to `.test.ts`, so a JS project's
co-located `env.test.js` was invisible to discovery and `gwrk ship` `[BLOCKED]` on a phase whose test existed.
The `.gwrkrc.json` toolchain override §9 relied on was never in `GwrkConfigSchema` (it survived only via a raw
`JSON.parse` in `detectProfile` bypassing Zod), `gwrk init` discarded it, and §10.2's "declared target" discovery
arm plus §10.4's integration auto-run were never built.

This feature makes test-toolchain support **honest, schematized, and polyglot**, in the `ProjectProfile` /
`GwrkConfig` / `toolchain-mapper` layer (not a plugin — ADR-006 scopes plugins to agent backends).

## 2. User Stories

- **US-001** — As a developer on a JavaScript project, `gwrk ship` discovers my `.test.js` tests (co-located,
  in a `tests/` tree, or declared) so a phase with real tests is not falsely `[BLOCKED]`.
- **US-002** — As a developer, I declare my project's test/build toolchain in `.gwrkrc.json` and it is validated
  by the config schema, written by `gwrk init`, and honored by ship/gate/test.
- **US-003** — As a developer whose tests are behavior-named and out-of-tree (or an integration `make` target),
  I point a phase at explicit test targets and ship gates them under liveness.
- **US-004** — As a developer with no build (or no test) toolchain, the corresponding gate skips with a clear
  message instead of forcing a false vitest invocation.
- **US-005** — As a developer in a polyglot monorepo, each workspace gates in its own language.

## 3. Functional Requirements

- **FR-001** (Phase 02) — `GwrkConfigSchema.project.toolchain` and `workspaces[].toolchain` MUST validate the
  `ToolchainConfig` shape (004 DM-003): `test` (harness enum, nullable), `testCommand`, `build` (nullable),
  `testExtension`, `sourceExtension`. `ProjectProfile.toolchain` MUST mirror it. `detectProfile` MUST merge the
  `.gwrkrc.json` override through `ToolchainConfigSchema.safeParse`, not raw JSON. *(closes 004 FR-024)*
- **FR-002** (Phase 03) — `getTestExtension`/`getSourceExtension` MUST consult `toolchain.testExtension`/
  `sourceExtension` first, then language inference, and MUST resolve **JavaScript** → `.test.js` / `.js`.
- **FR-003** (Phase 03) — `getTestCommand` MUST return `string | null`: `null` when `toolchain.test === null`
  (skip); `testCommand` verbatim when set (wins over `test`); else the inferred/declared harness (incl. `node-test`).
  *(closes 004 FR-023)*
- **FR-004** (Phase 03) — A new `getBuildCommand(profile, cwd): string | null` MUST resolve the build command from
  `toolchain.build` (null = skip) then package.json/cargo/go inference. *(closes 004 FR-022)*
- **FR-005** (Phase 04) — Test discovery MUST honor a **declared target** (`phase.testTargets`, sourced from the
  plan's Test Strategy table), checked existence-based before basename matching. *(closes ADR-005 §10.2 Invariant 4)*
- **FR-006** (Phase 05) — `gwrk ship` pre-flight, `BUILD_CHECK`, `TEST_GATE`, and `getPhaseTestFiles` MUST resolve
  every test/build/extension decision through the mapper; `BUILD_CHECK`/`TEST_GATE` MUST skip cleanly with a
  standard message on a `null` command. No `.test.ts`/`pnpm vitest run` literals outside a default fallback.
  *(completes ADR-005 §9.3)*
- **FR-007** (Phase 06) — `gate-gen` (`discoverTestFile`, `generateFilesystemGates`, functional-verb allowlist)
  MUST be profile-driven. *(completes ADR-005 §9.3)*
- **FR-008** (Phase 07) — `gwrk init` MUST persist the detected `project.toolchain` (incl. resolved
  `testExtension`/`sourceExtension`). *(closes 004 FR-025 scope for toolchain)*
- **FR-009** (Phase 08) — A phase's `Done-When` integration commands (`make test:*`, …) MUST compile to an
  executional gate that runs in `TEST_GATE` under liveness (`testsRun > 0`). *(closes ADR-005 §10.4)*
- **FR-010** (Phase 02/05) — Per-workspace `toolchain` MUST be consulted by `resolveWorkspaceProfile`.
  *(closes 020 DM-001)*

## 4. Data Model

`ToolchainConfig` as defined in [004-ship-loop DM-003](../004-ship-loop/spec.md). `PhaseSchema` gains
`testTargets?: string[]` (declared test files for a phase).

## 5. Test Requirements (RED-first)

- **TR-001** (FR-002) — `toolchain-mapper.test.ts`: `getTestExtension`/`getSourceExtension` JS → `.test.js`/`.js`;
  `testExtension` override wins; TS regression stays `.test.ts`.
- **TR-002** (FR-003/004) — `getTestCommand` returns `null` on `test:null`; `testCommand` verbatim; `node-test`
  case; `getBuildCommand` null-skip + inference.
- **TR-003** (FR-001) — `config.test.ts`: `project.toolchain` accepted, wrong types rejected (`ZodError`).
- **TR-004 (SEAM)** (FR-002/006) — a real JS fixture drives `detectProfile → getTestExtension → phaseHasTests`
  **with no injected extension**; co-located `env.test.js` is discovered / not `[BLOCKED]`. *(the coverage that hid the bug)*
- **TR-005** (FR-005) — ship pre-flight: JS phase with co-located `.test.js` is not `[BLOCKED]`; JS phase with no
  mapping is `[BLOCKED]` exit 1.
- **TR-006** (FR-003/006) — `BUILD_CHECK`/`TEST_GATE` skip with standard message when the mapped command is null.
- **TR-007** (FR-005) — declared-target discovery maps a behavior-named `tests/` suite to a phase.
- **TR-008** (FR-009) — integration `Done-When` target compiles to a gate that refuses `testsRun == 0`.

## 6. Acceptance / Success Criteria

- **SC-001** — On a JavaScript project (data-dashboard), every source-bearing phase has a discoverable test
  (co-located `.test.js` OR `tests/` tree OR declared target); pre-flight never false-blocks nor false-passes.
- **SC-002** — `.gwrkrc.json` with a `project.toolchain` block validates under `loadConfig` (Zod).
- **SC-003** — `npm run build` clean; `npm run test:ci` shows only the 3 pre-existing `server.test.ts` failures.
- **SC-004** — No literal `.test.ts` / `pnpm vitest run` outside a documented default fallback (grep-verifiable).

## 7. Scope

**In:** root + per-workspace `project.toolchain`, JavaScript, declared-target discovery, build/test null-skip,
integration auto-run, spec reconciliation. **Deferred:** AC-level test↔criterion mapping beyond existence +
declared-target; unifying the two `.gwrkrc.json` readers (`detectProfile` vs `loadConfig`) behind one
`resolveProfile(config)`.
