# Code Review: Phase 05 (Dispatch Queue & Orchestrator)
**Result**: NO-GO
**Date**: 2026-03-10

## Summary
The implementation of the Dispatch Queue (Phase 5) is incomplete and has introduced regressions in the build. Specifically, the `DispatchQueue` class is missing status-related methods required by the existing `status.ts` route, and it fails to correctly record task completion in the SQLite execution ledger as required by FR-009.

## Findings

### Blocking Findings
1. **Missing DispatchQueue Methods**: `DispatchQueue` lacks `getQueueDepth`, `getActiveCount`, `getCompletedCount`, and `getFailedCount`. This causes `pnpm build` to fail in `src/server/routes/status.ts`.
2. **Missing DB Recording**: `DispatchQueue.handleCompletion` does not call `finishRun`. This violates FR-009 which requires every attempt to be recorded in the SQLite execution ledger.
3. **Types/Schema Inconsistency**: `DispatchAttempt` (and `DispatchRecord`) is missing a `runId` or similar field to correctly link the in-memory record to the database record during completion handling.

### Non-Blocking Findings
- **Lint Errors**: Multiple `any` types and non-null assertions are present in `src/server/`. One auto-fixable lint error in `src/server/persistence.ts` was resolved.
- **Weak Gates**: `gates/T027-gate.sh` is too weak, only checking for file existence and a single keyword, failing to catch the missing methods.

## Task Status
- T027: **RE-OPENED** (Incomplete implementation)
- T028: PASS
- T029: PASS
- T030: **RE-OPENED** (Missing test coverage for status methods)
- T031: PASS
- T032: **RE-OPENED** (Regression in status.ts)
- T033: PASS
- T034: **RE-OPENED** (Verification failed to catch build regression)

## Next Steps
1. Implement the missing methods in `DispatchQueue`.
2. Update `DispatchAttempt` / `DispatchRecord` to track `runId`.
3. Call `finishRun` in `handleCompletion`.
4. Verify global `pnpm build` and `pnpm test` pass.
5. Run `/implement specs/002-build-server 05`.
