# Asynchronous acceptance repair

Repair the three reproduced ingress defects on the composed parent. Blocked: acceptance return ordering and unrunnable draining remain incorrect. Slack acknowledgment ordering also remains incorrect.

Preserve original implementation `e84474c7` and repair `88ecb636`. Preserve review `af9c2ad8` and evidence head `92febef0`. Composition `c19f14a3` carries reviewed Slack scope and runner repair. Parent `d2825b4a` also carries the branch-milestone CI fixture repair. Do not restart completed foundations or earlier durable phases.

Read `nov23-composed-ingress-repair.md` and the latest T026, T028 and T029 findings. The restored combined run passes 283 checks and fails exactly three reviewed cases. The original patch remains tracked beside that note. Preserve all assertions and source history.

## Required behavior

1. Persist acceptance synchronously and return the stable receipt before worker execution. Schedule draining after the current turn. Keep lease claiming and sandbox creation out of the acceptance call stack.
2. Stop after an unrunnable drain pass. Replace unconditional accepted-row recursion with an explicit pending-request mechanism or equivalent bounded scheduling. New acceptance and resume events must still release runnable work. Timers and close must remain usable.
3. Persist authorized slash commands before acknowledgment. Defer dispatch and ship draining until acknowledgment resolves. Reuse the existing deferred-drain option used by interactive actions. Preserve operation identity across retries.

Restore and run the retained regressions before production edits. Check already-active drain behavior as well as an idle queue. Preserve close and cancellation behavior when a drain is scheduled. Do not leave work that can launch after close.

Keep the approved application ports. Scheduling belongs in the server adapter. Preserve typed constructor compatibility for registry position eight and durable options position eight or nine. Preserve injected SQLite scope and the Git process environment. Keep the approved backend and project-scoped sandbox manager.

Preserve original caller recipients. Derive Slack destinations through approved project bindings and validated feature threads. Durable outbox delivery must remain the sole durable notification path. Keep local-only project recovery and outbox flushing. Preserve raw-body GitHub verification and both scoped and durable GitHub suites.

Use `gates/phase-05.sh` for every task. It now includes both GitHub test files and the Slack acknowledgment test. Require zero scoped and full-suite failures before fresh code and acceptance review. The operator uses repaired runner `b34a6b1d`. No incomplete run can count as a passing baseline.

Record nonblocking improvements separately. No live messages or project enrollment belong to this repair. Hosted deployment and Google authentication configuration remain subsequent work.
