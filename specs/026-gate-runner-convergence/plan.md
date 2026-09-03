# 026 — Implementation Plan

## Approach

Two ports (resolution + execution), five verdict drivers routed through them, specs corrected to
match. Read-time accessor (no schema change, no re-`define`). Delivered by hand on
`feat/026-gate-runner-convergence` with TDD, PR → develop (bootstrap-safe: the gate fix is not
shipped through the gates it fixes).

## Phases

- **Phase 02 — execution port.** `src/utils/gate-exec.ts`: `runTaskGate` (3-strategy resolve +
  inline `set -e`/bash + hollow/unauthored reject) and `runInlineGate`. Tests: `gate-exec.test.ts`;
  `gate-quality.test.ts` gains `getPhaseVerificationGate` + `isUnauthoredGate` coverage.
- **Phase 03 — migrate drivers.** `gate.ts runGateCheck`, ship `runPostFlightGates` / `readVerdict` /
  `runGateScript`, and harvest `reconcileGates` all route through `runTaskGate` (per-phase dedupe).
  New `reconcile-gates.test.ts`. `stageImplement` pre-flight stays file-only (documented exception).
- **Phase 04 — read unification.** Seam test (`parsePlanMarkdown → task.gateScript → runTaskGate`).
  `runIntegrationGate` / `generateGateBrief` need no repoint (documented in spec §7).
- **Phase 05 — DEFERRED (OQ-001).** Gate-invoked-test liveness; rationale in spec §8.
- **Phase 01 — spec de-drift.** This spec + the drift ledger (§9). Bug-seeding lies fixed in place
  (023 §5, 025 banner, ADR-007, 011 + 004 addenda); wording/status/line-ref drift ledgered.
- **Phase 06 — verify + PR.** Build + `test:ci` green; parity check (TR-005); PR to develop.

## Critical files

`src/utils/gate-exec.ts` (new), `src/utils/gate-quality.ts`, `src/commands/gate.ts`,
`src/engine/ship-orchestrator.ts`, `src/engine/reconcile-gates.ts`. Tests: `gate-exec.test.ts`,
`gate-quality.test.ts`, `reconcile-gates.test.ts`, `ship-orchestrator*.test.ts` (green as-is).

## Verification

`pnpm run build` + `pnpm run test:ci` (only the 3 known local-only `server.test.ts` failures).
Parity (TR-005): `gwrk gate` == `readVerdict` == `reconcileGates` == TEST_GATE for one feature/phase
under `--worktree`.
