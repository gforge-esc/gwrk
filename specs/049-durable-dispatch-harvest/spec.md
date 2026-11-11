# Durable dispatch and harvest

Persist accepted work before acknowledgement. Resume incomplete dispatch and harvest steps after restart. Blocked: implementation depends on project-scoped identity and recipients from 048.

## Requirements

- FR-001. Accept dispatch once per project and work key. Store the request and return a stable receipt before acknowledging HTTP or Slack. Recover queued work after restart and reconcile stale running leases before launching a worker.
- FR-002. Use one project-scoped harvest operation for the poller, signed GitHub webhook and manual CLI. Deduplicate transport deliveries separately from work. Verify enrolled repository, configured trunk, pull request identity and merge SHA.
- FR-003. Track reconciliation stages independently. Resume git sync, gate verification, learning records, Slack delivery and branch cleanup from durable receipts. Preserve git authority for task state and run manifests under ADR-002 and ADR-003.
- FR-004. Deliver receipts to the project, feature thread and recipient from the accepted operation. Reconcile uncertain external sends using stored message identity. Surface unresolved delivery and gate failure in status. Keep Telegram disabled for the hosted pilot.
- FR-005. Record closed unmerged pull requests as terminal attempts without advancing the phase. Only clean up branches with matching repository, branch and expected tip.
- FR-006. Use pure policy and injected storage, clock, GitHub, Git and notification ports. Preserve local CLI behavior and read historical records without claiming evidence they lack.

## Acceptance

- TR-001. Crash between durable acceptance and worker launch. Restart and execute the accepted request once. Reconcile a worker that may have started before the crash.
- TR-002. Deliver duplicate and out-of-order poller, webhook and manual events. Converge on one harvest for each merge. Isolate two repositories with the same feature and pull request numbers.
- TR-003. Inject failure after each durable write and external effect. Reconcile uncertain delivery and cleanup. Prevent stale lease owners from completing a successor's attempt.
- TR-004. Verify a closed unmerged pull request and a gate failure keep distinct status. Verify branch movement blocks cleanup.
- TR-005. Exercise an unattended restart with synthetic GitHub and Slack adapters. Record stable project receipt, run linkage and pending stages after failure. Reserve the real hosted proof for the integrated pilot.
