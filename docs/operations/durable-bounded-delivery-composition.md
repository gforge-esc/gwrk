# Durable delivery composition

Durable receipts retain bounded transport after integration with Linux readiness. The incoming adapter failed both added composition regressions. The repaired composition passes 27 focused checks and the durable adapter gate passes 112 checks. Blocked: independent clearance of the remaining feature phases.

## Transport

A bounded durable send verifies the workspace with the captured token. It then sends once with that token and the same abort signal. Thread and reconciliation metadata remain on the request. A timed-out workspace check performs no post and no webhook fallback.

The unbounded compatibility path keeps the reviewed Slack client configuration with zero automatic retries. Uncertain sends remain available for receipt reconciliation. Changing the configured token during workspace verification cannot change the token used for the accepted send.

## Gate reconciliation

The merged reconciliation options retain the injected project and database. Isolated merge checkouts can suppress local task-state updates. The caller can still pass the bounded process environment. Failed task identifiers remain explicit.

## Evidence

| Check | Result | Evidence |
|---|---|---|
| Incoming durable transport | Two regressions failed | `/tmp/gwrk-integration-durable-bounded-transport-red.log` |
| Focused composition | 27 checks passed | `/tmp/gwrk-integration-durable3-composition-green.log` |
| Durable adapter phase gate | 112 checks passed | `/tmp/gwrk-integration-durable3-full-phase-gate-green.log` |
| Lint | 432 files passed | `/tmp/gwrk-integration-durable3-merge-lint.log` |

Durable Phase 3 cleared code review and acceptance review at `679c6825`. Both required CI jobs passed in run 44447926701. No live Slack message was sent by these checks.
