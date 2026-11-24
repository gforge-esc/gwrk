# Completed suite-load baselines

The private operator repair accepts completed Vitest suite-load failures only during initial baseline capture. Verification still rejects those failures. Independent review must clear this patch before the coordinator freezes its commit and distribution.

## Cause

The hosted pilot Phase 2 baseline completed with three suites that could not import their unimplemented modules. Two existing assertions passed. Vitest exited 1 with its terminal file and assertion summaries plus start time and duration. The frozen operator treated zero failed assertions as incomplete execution. It stopped before implementation.

The source receipt is `.runs/aws-hosted-pilot-nov23/ship-phase2.log` in the main checkout. This repair starts from frozen operator commit `b34a6b1d`. It changes no pilot runtime source or existing operator worktree.

## Boundary

The test command executor defaults to verification. Only `captureTestBaseline` requests the initial-baseline purpose. A baseline accepts normal exit 1 with the observed complete Vitest report. It requires the runner banner and failed-suite section. It also requires consistent terminal counts and the complete duration footer. Only the known capacity-wrapper release line may follow.

Failed suites remain separate from executed assertions. A report with three failed suites and no assertions has `failedSuites=3` and `ran=false`. Baseline totals include those three negative units. They never become passing assertions. Verification treats suite-load reports as execution errors even when an older baseline is larger.

Timeouts and process signals remain errors. Cancellation and buffer exhaustion remain errors too. Partial reports and trailing crash diagnostics cannot enter the baseline exception. Other framework parsing retains its existing behavior.

## Evidence

Private receipts reside under `.runs/suite-load-baseline/` in the new operator worktree.

| Receipt | Result |
|---|---|
| `test-only-red.log` | RED: 6 failed and 35 passed before production edits |
| `unterminated-duration-red.log` | RED: 1 failed and 20 skipped before footer tightening |
| `cancelled-red.log` | RED: 1 failed before cancellation ordering correction |
| `final-verified-green.log` | Final focused regression result |
| `build-verified.log` | Build result |
| `lint-verified-final.log` | Lint result |

The focused cases include an actual nested Vitest run. It loads three missing-module fixtures and executes two passing assertions. Other cases use real bounded child processes to exercise timeout and signal handling. Orchestrator cases verify baseline capture and strict scoped or whole-suite denial. Existing completion and diagnostic regressions remain active.

This patch changes baseline evidence classification. It does not establish Phase 2 implementation correctness or complete any task gate. The coordinator must resume the requested bounded ship call using the reviewed private operator.
