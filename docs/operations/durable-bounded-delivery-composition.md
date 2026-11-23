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

Durable Phase 3 cleared code review and acceptance review at `679c6825`. Both required CI jobs passed in run 44447926701. These checks sent no live Slack messages.

## Scoped delivery integration

The November 23 composition preserves the canonical Slack delivery resolver from project identity Phase 4. It retains durable reconciliation and transport cancellation. Project recipient validation applies before delivery. Pilot Telegram remains disabled by default.

The caller owns a queued away-user notification until its abort signal ends. Each network request has a separate timeout. An expired presence lookup must not remove a notification queued for later delivery. Pending batches partition by project and caller ownership. Private ephemeral replies retain the validated thread and recipient.

The incoming composition failed four transport regressions. Two private-reply regressions then proved the missing network bounds. One away-user regression proved that a request timeout incorrectly canceled queued ownership. All retained cases pass after repair. The affected integration file also passes after updating its explicit legacy pilot fixtures.

| Check | Verdict | Evidence |
|---|---|---|
| Transport composition baseline | FAIL, four regressions | `/tmp/gwrk-nov23-slack4-durable-composition-red.log` |
| Private reply baseline | FAIL, two regressions | `/tmp/gwrk-nov23-private-reply-bounds-red.log` |
| Away-user ownership baseline | FAIL, one regression | `/tmp/gwrk-nov23-away-owner-lifetime-red.log` |
| Ownership and server integration | PASS, 65 checks | `/tmp/gwrk-nov23-owner-lifetime-integration-green-3.log` |
| Durable coordination composition | PASS, 84 checks | `/tmp/gwrk-nov23-durable4-merge-gate-2.log` |

Durable coordination integration retains injected project identity and database scope. Recursive harvest calls preserve the process environment and local-state suppression. The Git adapter exposes its implemented harvest methods through the full VCS port. Consumers that need project methods retain the narrower port.
