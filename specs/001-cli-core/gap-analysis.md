# Gap Analysis: 001-cli-core Phase 14 (Project-Scoped DB Isolation)

**Feature**: 001-cli-core
**Phase**: 14
**Date**: 2026-06-01

## 1. Context Audit

- **Spec**: US-030 (Project-Scoped DB Isolation) and FR-036–FR-040. ✅ Updated in `spec.md`.
- **Plan**: Phase 14 section in `plan.md`. ✅ Updated in `plan.md`.
- **Contracts**:
    - `src/utils/project-id.ts`: Canonical MD5 derivation utility.
- **Actual Code**:
    - `src/utils/project-id.ts`: ✅ Implemented. Canonical `resolveProjectId` exists.
    - `src/db/migrations/009-project-scoping.sql`: ✅ Exists. Adds `project_id` and indexes to 8 tables.
    - `src/db/index.ts`: ⚠️ `safeAddColumn` exists but lacks `project_id` additions for the 8 target tables (safety net).
    - `src/db/plan.ts`: ❌ Query functions do NOT accept or filter by `projectId`.
    - `src/db/runs.ts`: ❌ `listRuns()`, `getStats()` lack project filter.
    - `src/db/gates.ts`, `src/db/compression.ts`, `src/db/issues.ts`, `src/db/plugins.ts`: ❌ Lack project filtering.
    - `src/engine/plan-store.ts`: ❌ Constructor does not accept `projectId`. Methods query globally via `db.listFeatures()`.
    - `src/engine/drift-detector.ts`: ❌ Lacks project scoping.
    - `src/commands/plan.ts`, `src/commands/stats.ts`, `src/commands/runs.ts`: ❌ Subcommands do not derive or pass `projectId`.

## 2. Findings

| Item | Status | Finding |
|---|---|---|
| `project-id.ts` | `completed` | Canonical utility exists and is correct. |
| `009-project-scoping.sql` | `completed` | Migration covers all 8 tables and adds indexes. |
| `db/index.ts` | `partial` | `safeAddColumn` needs backfill for `project_id` on 8 tables. |
| `db/plan.ts` | `missing` | All query functions need `projectId` parameter and WHERE clause. |
| `db/runs.ts` | `missing` | `listRuns()`, `getStats()` lack project filter. |
| `engine/plan-store.ts` | `missing` | Needs `projectId` state and pass-through to DB layer. |
| `engine/drift-detector.ts` | `missing` | Needs to only check features for the current project. |
| `commands/plan.ts` | `missing` | Needs to resolve `projectId` from `cwd` and pass to `PlanStore`. |
| `commands/stats/runs` | `missing` | Need to resolve `projectId` and pass to DB layer. |

## 3. Gap Details

### G-01: DB Layer Scoping (8 Tables)
The following tables are missing `projectId` filtering in their access logic: `plan_features`, `plan_phases`, `plan_edges`, `plan_proposals`, `gate_results`, `compression`, `issues`, and `routing_history`. Every list/get/insert function must be updated.

### G-02: PlanStore Engine Injection
`PlanStore` currently has no concept of a "current project". It must be refactored to accept a `projectId` in its constructor, which it then uses for all internal DB calls.

### G-03: Command-level Project Derivation
CLI commands currently execute without project context. Commands like `plan status`, `stats`, and `runs` must use `resolveProjectId(process.cwd())` to establish scope before calling the engine or DB layers.

### G-04: Idempotent Column Safety
`src/db/index.ts` should be updated with `safeAddColumn` calls for `project_id` to ensure DB integrity even if the migration file is not executed (e.g., in some test environments or stale local DBs).

## 4. Recommendations

1. Update `src/db/index.ts` to include `project_id` in `safeAddColumn`.
2. Update `src/db/*.ts` (plan, runs, gates, compression, issues, plugins) to scope queries.
3. Refactor `PlanStore` and `DriftDetector` to be project-aware.
4. Update CLI subcommands in `plan.ts`, `stats.ts`, and `runs.ts` to derive and pass the project ID.
5. Verify with new tests: `src/db/scoping.test.ts`, `src/engine/plan-store-scoping.test.ts`, `src/commands/project-scoped.test.ts`.
