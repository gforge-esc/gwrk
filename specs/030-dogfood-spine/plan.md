# 030 — Implementation Plan

## Phases

### Phase 1 — Readiness Scanner, Drift Detector, and Build Plan Reconciliation (5 SP)
- `src/engine/readiness-scanner.ts` (MODIFY: Skip `_` directories, fall back `spTotal` to plan phase SP sum, and detect shipped phases from disk)
- `src/engine/plan-store.ts` (MODIFY: Promote phases from `shippedPhaseSeqs`)
- `src/engine/drift-detector.ts` (MODIFY: Skip `_` and `000-tdd-infrastructure` directories)
- `docs/decisions/ADR-011-hexagonal-and-agent-port.md` (NEW: Author ADR-011)
- `specs/000-build-plan.md` (MODIFY: Regenerate build plan with non-zero SPs and zero drift)

#### Done When
```bash
pnpm vitest run src/engine/readiness-scanner.test.ts src/engine/plan-store-init.test.ts src/engine/drift-detector.test.ts
```
