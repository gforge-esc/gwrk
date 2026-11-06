# 030 — Dogfooding and Build Plan Spine Reconciliation

> **Status:** Defined · **Anchored to:** ADR-010, ADR-011

## 1. Problem
`specs/000-build-plan.md` stopped at `020-polyglot-monorepo` with `0 SP` on all rows, breaking `I-GW-S05` and causing `gwrk plan verify` to report drift across features `021` through `029`.

## 2. Functional Requirements
- **FR-001:** `scanReadiness` MUST ignore `specs/_fixtures` and `000-tdd-infrastructure` and fall back `spTotal` to the sum of phase SPs from `plan.md` when `tasks.json` is absent or zero.
- **FR-002:** `scanReadiness` and `PlanStore.initFromSpecs` MUST promote phases to `SHIPPED` when all tasks in `tasks.json` are terminal or when `.gwrk/runs/*_ship_phase-NN_*.json` records `exitCode === 0`.
- **FR-003:** `DriftDetector.verify` MUST ignore `specs/_fixtures` and `000-tdd-infrastructure`.
- **FR-004:** `ADR-011` MUST be indexed in `.gwrk/decisions/index.md` and pass `gwrk define adr --check`.
