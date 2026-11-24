# Durable ingress handoff

Phase 5 must persist accepted operations before acknowledging requests. Blocked: the real HTTP regression returns an acknowledgement without a SQLite operation.

The parent includes combined candidate `e36e6692`. Preserve bounded Slack transport and caller cancellation ownership. Durable coordination Phase 4 cleared at `eec2b080` with both continuous integration jobs passing in run 45247992333.

The failing regression is `src/server/durable-ingress.test.ts`. It uses a paused queue with a real temporary Git checkout and SQLite database. It enrolls a synthetic project through the approved registry. The response returns 201 but the project-scoped operation lookup returns null. Evidence is `/tmp/gwrk-nov23-durable-ingress-red-3.log`. Earlier fixture setup failures do not count as behavioral evidence.

Implement all eight Phase 5 tasks against `contracts/coordinators-routes-and-cli.md`. Keep this regression active in `gates/phase-05.sh`. Preserve durable receipts on retries. Preserve project authorization and lease fencing. Recover recorded worker state before launching work. Persist verified GitHub deliveries before acknowledgement. Persist watcher cursors and Slack receipts before effects.

Preserve the original HTTP or local recipient on the operation receipt. Derive any separate Slack destination from approved project bindings and validated feature threads. Keep durable outbox delivery as the sole durable notification path. Do not duplicate legacy notification delivery. Slack Phase 5 and Phase 6 continue independently. Final composition needs their cleared interfaces.

Add behavioral tests for the remaining ingress requirements before changing production behavior. Review against the agreed phase requirements. Record nonblocking improvements separately. Live deployment and project enrollment remain outside this phase.
