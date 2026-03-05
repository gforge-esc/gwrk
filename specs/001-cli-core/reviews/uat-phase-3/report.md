# UAT Review Report: Phase 3 — Task Engine — State, Gates & History — NO-GO

**Feature**: 001 CLI Core
**Date**: 2026-03-04
**Phase**: 3 (and 4)
**Verdict**: **NO-GO**

## Summary
While the core functionality of the Task Engine is implemented, a critical UX issue was identified: `gwrk tasks generate` is destructive and not idempotent. Running the command on an existing feature directory overwrites all task statuses back to `open`, causing loss of work/progress. This violates the implicit usability standards of the `gwrk` toolset, especially when compared to the idempotent behavior of `gwrk init` (US-001).

## User Story Testing
| US-### | Title | Result | Notes |
| :--- | :--- | :--- | :--- |
| US-004 | Task Decomposition | **FAIL** | Functionally works, but is destructive. Running it twice resets all task statuses to `open`. |
| US-005 | Task State Query | PASS | `gwrk tasks list` and `gwrk tasks next` work correctly. |
| US-006 | Hard Gate Enforcement | PASS | Gate enforcement is strict and reliable. |
| US-007 | Transition History | PASS | History logging is accurate and persistent. |

## Findings & Blockers
### 1. [BLOCKER] Non-Idempotent `tasks generate`
- **Description**: Running `gwrk tasks generate <feature>` on a feature that already has a `.gwrk/tasks.json` resets all task statuses to `open`.
- **Impact**: Any progress made on a feature is lost if the developer needs to re-run generation (e.g., after a plan update).
- **Expected Behavior**: `tasks generate` should load existing state and preserve the `status` and `completedAt` fields for tasks that still exist in the plan.

## Verification Details
- **Test Results**: All 30 unit/integration tests pass, but they do not cover the idempotency of the `generate` command.
- **Manual Evidence**: Completed task `T001` via `gwrk tasks done`, then ran `gwrk tasks generate`, and `T001` was reverted to `open`.

## Next Step
- **RE-OPEN** `T016: Implement src/commands/tasks.ts`.
- **RE-OPEN** Phase 3 in `tasks.json`.
- Remediate `tasks.ts` to implement state-preserving merge logic in the `generate` command.
