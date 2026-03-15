# Gap Analysis: 004 Ship Loop (2026-03-15)

## Overview
This document assesses the implementation deltas between the `ship` orchestration logic (`src/commands/ship.ts`, `scripts/dev/work-until-done.sh`, etc.) and the 18 Functional Requirements defined in `spec.md`.

## Summary Status
The core state machine (FR-004), UI, GitHub integrations (FR-006), agent review dispatch (FR-005), and basic SQLite/manifest recording (FR-011) are present and working. However, recent resilience, observability, and constraint enforcement requirements (FR-015 to FR-018) are entirely absent from the codebase, along with critical pre-flight gates.

## Detailed FR Mapping

| ID | Requirement | Implementation Status | Gaps & Files to Modify |
|---|---|---|---|
| **FR-001** | `gwrk ship` base + delegation | **Present** | None. `ship.ts` correctly invokes `work-until-done.sh`. |
| **FR-002** | Branch creation + Dirty-tree guard | **Partial** | `wud-branch.sh` implements branch creation, checkout, and push, but **fails to check for a dirty working tree**. |
| **FR-003** | Pre-flight gate check | **Missing** | `work-until-done.sh` jumps straight to `IMPLEMENT`. It never sources/executes the `gates/TXXX-gate.sh` defined in `tasks.json`. |
| **FR-004** | State machine (Implementation → Done) | **Present** | Handled correctly via bash loops and `save_state` calls. |
| **FR-005** | Agent review dispatch (`review-code/uat`) | **Present** | Implemented via `wud-verdict.sh` and `agent-run.sh`. |
| **FR-006** | PR creation and CI Wait | **Present** | Implemented via `gh pr` and `wud-ci-wait.sh`. |
| **FR-007** | Circuit Breaker (`MAX_ITERATIONS`) | **Present** | Implemented in `work-until-done.sh` loop counters. |
| **FR-008** | Crash Recovery | **Present** | `load_state` and `save_state` persist to JSON `.state` files. |
| **FR-009** | Agent resolution hierarchy | **Present** | CLI override → programmatic fallback → `.gwrkrc.json`. |
| **FR-010** | Timestamped local log file | **Partial** | Writes to `$WUD_LOG` in `$RUNS_DIR`. However, FR-017 mandates rehoming logs to the feature directory for git-tracking. |
| **FR-011** | SQLite Execution Ledger | **Present** | Handled via `db/runs.js` in `ship.ts`. |
| **FR-012** | JSON Execution Manifest | **Partial** | Manifests are written to `.gwrk/runs/*.json`, but they lack the required `digest[]` array payload defined in ADR-003. |
| **FR-013** | Sequential multi-phase execution | **Present** | `ship.ts` processes all available phases in `tasks.json`. |
| **FR-014** | Phase phase-skip execution | **Present** | `ship.ts` correctly skips phases where all tasks are `completed`. |
| **FR-015** | Agent-Native `[exit:N \| Xs]` wrapper | **Missing** | Missing entirely. `ship.ts` delegates to `utils/format.js` visual banners instead of structured output, and lacks the `--format json` fallback. |
| **FR-016** | Staging validation | **Missing** | `scripts/dev/validate-staging.sh` exists and is robust, but **it is never called** by `work-until-done.sh` before pushing commits. |
| **FR-017** | Three-tier logging (`.events` sidecar) | **Missing** | The `.events` sidecar file is never produced, meaning no structured digest exists to be merged into the execution manifest (FR-012). |
| **FR-018** | Rip-cord bail `failureContext` | **Missing** | Circuit breaker exits, but does not inject a structured `failureContext` object (open tasks, iteration timeline, digest) into the final state file. |

## Next Steps
This analysis serves as the blueprint for **Phase 2 (Resilience & Bail)** and **Phase 3 (Verification & Artifacts)** of the `004` TDD Hardening plan.

1. **Phase 2**: Inject the dirty-tree check into `wud-branch.sh` (FR-002), add the staging validation hook before `gh branch push` (FR-016), and implement `failureContext` state dumps on circuit-breaks (FR-018).
2. **Phase 3**: Wire the `.events` emission throughout `work-until-done.sh`, attach the `digest[]` to the manifest in `ship.ts` (FR-017, FR-012), build the pre-flight gate runner (FR-003), and wrap CLI output in the Agent-Native format (FR-015).
