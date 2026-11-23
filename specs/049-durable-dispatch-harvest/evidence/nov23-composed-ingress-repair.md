# Composed ingress repair preparation

The durable parent includes the reviewed integration changes. Three review failures remain for the next bounded repair. Blocked: acceptance ordering, unrunnable-row draining and Slack acknowledgment ordering.

## Sources

| Source | Revision | Role |
|---|---|---|
| Durable parent | `92febef05192b0fbfec3955ca85cf5ec303c10ca` | Merge parent |
| Reviewed integration | `b34a6b1d0ecf4faa23265dd926159041e4b52ba5` | Slack scope and runner repair |
| Original durable implementation | `e84474c7` | Preserved ancestor |
| Second durable repair | `88ecb636` | Preserved implementation history |
| Latest durable review | `af9c2ad8` | Preserved NO-GO findings |

The merge remains uncommitted. It does not include unreviewed model-selection phase changes. No active worker checkout or operator output changed.

The archived regression patch came from `.runs/ship-review-archives/049-durable-dispatch-harvest-ship-2de95b05-20261123T205323457417Z/files/.runs/review-regressions-phase-05-iter2-nov23.patch` under the primary checkout. Its SHA-256 is `76ddd825931c50e54b781569392cf68a497b22ff6e7c59f5bfef5f7a2cd6eb24`.

The patch applied and passed its reverse check before formatting. The restored tests retain every review assertion. Formatting changed line layout. The original archive remains unchanged. A byte-identical tracked copy is `nov23-review-regressions-phase-05-iter2.patch` beside this note.

## Composition

The dispatch constructor accepts either the reviewed registry argument or durable options in position eight. Position nine accepts appended durable options. Typed property detection distinguishes the interfaces. A real registry and database still activate durable backing. A replay test exercises the registry argument with appended worker options.

The legacy registry test no longer uses a fake database cast. It still verifies the Git environment and approved backend. Real SQLite tests verify database injection and durable replay.

Durable intake uses the shared Slack recipient policy before persistence. Operations retain their original recipient. Completion notices derive a separate approved Slack destination. Interactive cards retain project and thread ownership. Stored-thread validation also preserves the durable feature identity check.

Legacy and durable queue views both filter by project. Completed and failed durable counts retain project identity. The composition preserves typed HTTP intake errors and local fallback when no enrolled project exists. Explicit unknown selectors still fail.

GitHub ingress retains raw-body signature verification and durable delivery deduplication. Scoped repository and issue routing remain available. The conflicting test suites now live in `github.test.ts` and `github.scoped.test.ts`. Both appear in the phase gate and plan test strategy.

The harvest watcher retains durable polling and outbox recovery. Its options also retain the scoped legacy polling dependencies. Notification shutdown and draining remain intact.

The phase gate now includes `src/server/slack.test.ts`. The plan lists that file and its acknowledgment-ordering coverage. The merge preserves reviewed cancellation and runner-completion handling.

## Known failures

| Task | Review defect | Observed RED |
|---|---|---|
| T026, dispatch intake | Worker starts before receipt returns | Worker event precedes acceptance return |
| T026, durable draining | Unrunnable accepted row retriggers draining | Safety breaker observes 15 queries |
| T028 and T029, Slack dispatch | Worker starts before acknowledgment | Pre-ack worker flag is true |

These production defects remain unchanged. Their tasks remain open. The next worker must reproduce these failures before repairing them.

## Verification

Raw logs remain under `.runs/durable-composed-ingress-nov23/` in this checkout.

| Check | Result | Target |
|---|---|---|
| Combined focused checks | Pass, 283 tests; expected RED, 3 tests | Only the three review failures |
| Real server integration and HTTP ingress | Pass, 52 tests | Zero failures |
| Build | Pass | Zero type errors |
| Lint | Pass | Zero findings |

`combined-final-red.log` contains the combined focused result. `integration-green.log` contains server lifecycle and HTTP checks. The stored-thread identity guard remains intact. `dispatch-final-red.log` repeats the affected queue suite after that restoration. Build and lint logs cover the final source.

The combined command selected all phase-five gate suites. It also selected watcher and heartbeat suites. Notification and health routes ran too. Server integration verified cancellation and draining.

New composition assertions cover durable recipient validation before persistence. They also cover project-filtered terminal counts and operation lookup. Existing review regressions remain active without skips or assertion suppression.
