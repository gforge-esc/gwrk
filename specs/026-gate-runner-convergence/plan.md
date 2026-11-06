# 026 — Implementation Plan

## Approach

Two ports (resolution + execution), five verdict drivers routed through them, specs corrected to
match. Read-time accessor (no schema change, no re-`define`). Delivered by hand on
`feat/026-gate-runner-convergence` with TDD, PR → develop (bootstrap-safe: the gate fix is not
shipped through the gates it fixes).

## Phases

### Phase 1 — Spec De-Drift and Gate Quality Accessors (2 SP)
- `src/utils/gate-quality.ts` (MODIFY: Add `getPhaseVerificationGate` and `isUnauthoredGate`)

### Phase 2 — Unified Gate Execution Port (3 SP)
- `src/utils/gate-exec.ts` (NEW: Implement `runTaskGate` and `runInlineGate`)

### Phase 3 — Migrate Verdict Drivers (3 SP)
- `src/commands/gate.ts` (MODIFY: Route `runGateCheck` through `runTaskGate`)
- `src/engine/ship-orchestrator.ts` (MODIFY: Route `runPostFlightGates` and `readVerdict` through `runTaskGate`)
- `src/engine/reconcile-gates.ts` (MODIFY: Route `reconcileGates` through `runTaskGate`)

### Phase 4 — Read Unification and Seam Verification (2 SP)
- `src/utils/gate-exec.test.ts` (NEW: Seam test for `parsePlanMarkdown -> task.gateScript -> runTaskGate`)

## Critical files

`src/utils/gate-exec.ts` (new), `src/utils/gate-quality.ts`, `src/commands/gate.ts`,
`src/engine/ship-orchestrator.ts`, `src/engine/reconcile-gates.ts`. Tests: `gate-exec.test.ts`,
`gate-quality.test.ts`, `reconcile-gates.test.ts`, `ship-orchestrator*.test.ts` (green as-is).

## Verification

`pnpm run build` + `pnpm run test:ci` (only the 3 known local-only `server.test.ts` failures).
Parity (TR-005): `gwrk gate` == `readVerdict` == `reconcileGates` == TEST_GATE for one feature/phase
under `--worktree`.
