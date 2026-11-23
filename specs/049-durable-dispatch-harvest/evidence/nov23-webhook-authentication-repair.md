# Webhook authentication repair

Webhook intake now rejects an absent or blank configured secret before writes or effects. Both the HTTP adapter and durable harvest service enforce this boundary. Independent review is GO at `89ac728b`. Blocked: final integration checks and required CI remain pending.

## Reproduction

The security audit found a violation of feature 049 requirement FR-002. At source `07cb062a`, an unsigned request for a hosted-policy enrolled project returned HTTP 200. It persisted one harvest operation and one delivery. The fixture disabled automatic resume and used real SQLite. No Git or notification effects ran.

Direct application calls also accepted absent and whitespace-only secrets. The original combined probe failed three tests. The root retained its tests in commit `f1459296` before production changes. Expanded coverage adds empty-secret cases and legacy HTTP effects. The resulting matrix failed seven tests while two already denied correctly. See `/tmp/gwrk-nov23-webhook-nine-case-red.log`.

## Repair

The HTTP handler requires a configured secret and a valid raw-body signature before processing events. The application service independently requires both before durable intake. Missing or whitespace-only secrets receive HTTP 401. Nonblank secrets retain their original bytes for signature verification.

Legacy handler fixtures now supply real synthetic signatures. Invalid-signature assertions remain active. The new legacy cases prohibit issue updates and notifications when the endpoint lacks a valid secret. The application cases require zero operation and delivery rows. They also prohibit Git and gate effects.

Phase 6 task T035 and its shared gate now require both authentication regression files. The task's startup wiring already includes raw-body webhook parsing. This repair closes that existing contract without adding production login or API credential verification.

## Verification

| Check | Result | Target |
|---|---|---|
| Expanded authentication matrix before repair | Reproduced, seven failed and two passed | Observe the authentication bypass |
| Complete route and application suites after repair | Pass, 48 tests | Zero failures |
| Production authentication adapter | Pilot prerequisite | Google sessions and API credentials |

The GREEN log is `/tmp/gwrk-nov23-webhook-guard-focused-green.log`. The original audit evidence remains in the security review worktree. No live webhook or cloud deployment occurred. Final source integration retains these regressions. Both complete platform suites pass. Required final-head CI controls merge readiness.

## Independent clearance

Independent build and lint pass. Three complete suites pass 48 tests. The wider server integration selection passes 85 tests. The review receipt is `nov23-webhook-authentication-review.md`. Final candidate checks include this repair after recovery integration. The complete macOS suite passes 4468 tests. Native Linux passes 4477 tests. Both have zero failures.
