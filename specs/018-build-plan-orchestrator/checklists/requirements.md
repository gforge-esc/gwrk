# Requirements Checklist: 018 Build Plan Orchestrator

**Purpose**: Verify all functional, data, and testing requirements are met for the Build Plan Orchestrator.
**Created**: 2026-04-02
**Feature**: [spec.md](../spec.md)

## Functional Integrity (FR-###)

- [ ] CHK-001: SQLite schema includes `plan_features`, `plan_phases`, `plan_edges`, and `plan_proposals` with correct fields (FR-001).
- [ ] CHK-002: `graphology` integration successfully loads DAG and computes topological sort (FR-002).
- [ ] CHK-003: Kahn's algorithm correctly identifies ready items sorted by critical path priority (FR-003).
- [ ] CHK-004: CPM forward/backward pass correctly computes slack and identifies critical path (FR-004).
- [ ] CHK-005: `gwrk plan status` displays all features/phases with health indicators (FR-005).
- [ ] CHK-006: `gwrk plan verify` detects drift (e.g., .agents/ references) (FR-006).
- [ ] CHK-007: `ShipOrchestrator` emits `plan:ship:complete` and updates SQLite (FR-007).
- [ ] CHK-008: Define commands emit `plan:define:complete` and update status (FR-008).
- [ ] CHK-009: `gwrk plan render` regenerates `000-build-plan.md` with Mermaid DAG (FR-009).
- [ ] CHK-010: `gwrk plan add/remove` commands update SQLite and cascade edges (FR-010).
- [ ] CHK-011: `gwrk plan dep add/remove` commands enforce cycle prevention (FR-011).
- [ ] CHK-012: `gwrk plan set` allows manual status/SP/health overrides (FR-012).
- [ ] CHK-013: `gwrk plan seed` correctly imports existing markdown build plan (FR-013).
- [ ] CHK-014: `gwrk plan viz` serves sigma.js visualization (FR-014).
- [ ] CHK-015: Heartbeat cron reports health to Slack (FR-015).
- [ ] CHK-016: `gwrk plan review` manages agent proposals (FR-016).

## User Acceptance (US-###)

- [ ] CHK-017: `gwrk plan next` shows critical ready items first (US-001).
- [ ] CHK-018: `gwrk plan critical` shows ordered chain of zero-slack items (US-002).
- [ ] CHK-019: `gwrk plan status --format json` produces valid, parseable JSON (US-003).
- [ ] CHK-020: Drift detection correctly flags inconsistent status/code state (US-004).

## Technical Constraints (TC-###)

- [ ] CHK-021: No external network calls or CDNs used (TC-001).
- [ ] CHK-022: Zod validation fails fast on missing configuration (TC-002).
- [ ] CHK-023: Implementation is 100% TypeScript ESM (TC-003).

## Verification & Testing (TR-###)

- [ ] CHK-024: Unit tests for Kahn's and CPM in `plan-solver.ts` (TR-018-001).
- [ ] CHK-025: Integration tests for recursive dependency queries in `plan-store.ts` (TR-018-002).
- [ ] CHK-026: E2E tests for CLI seed -> next flow (TR-018-003).
- [ ] CHK-027: Event emission tests in `ship-orchestrator.ts` (TR-018-004).

## Notes
- Items derived from F018 spec requirements.
- Linked to FR-###, US-###, and TR-### identifiers.
