# Integration composition

The reviewed Slack server changes compose with the durable coordinator and Linux shutdown changes. Blocked: none.

| Check | Result | Target |
|---|---|---|
| Focused and real-adapter tests | Pass, 201 tests | Zero failures |
| Linux instance recovery | Unmeasured, 3 skipped | Linux execution |
| Build | Pass | Zero type errors |
| Lint | Pass | Zero findings |

The final command selected all seven scoped server suites. It also covered server integration and notification adapters. Policy and persistence suites passed. Both harvest paths passed. Linux instance recovery skips on macOS. The configuration retains the full test suite without the obsolete quarantine.

## Composition decisions

- Keep the positional dispatch ledger. Keep the Git environment and approved backend arguments. Append the registry argument.
- Keep watcher ledger and Git environment arguments. Append watcher options. Keep heartbeat ledger and append heartbeat options.
- Preserve dispatch recipient provenance. Derive a separate approved Slack recipient for completion cards.
- Preserve local notification routing only without a registry or explicit recipient. Registry-backed notifications retain project and thread authorization.
- Complete ledger writes and sandbox removal before awaiting Slack delivery. Persist terminal state and release the dispatch slot first. Close still cancels and drains delivery.
- Accept both the notification route's project-root argument and scoped route options. Preserve close cancellation and draining.
- Pass the project and database through webhook and watcher harvest. Pass the Git environment too. Keep both durable harvest service paths. Use the scoped record recipient when options omit it. Explicit null still suppresses delivery.
- Keep heartbeat alerts on the configured operations channel. The existing cancellation fixture now configures that channel and retains its cancellation assertions.

## Regression evidence

The first scoped run failed ten constructor and test composition assertions. The next focused run passed all 53 tests. The first real-adapter run exposed legacy notification routing and heartbeat fixture failures. The next run passed server integration and exposed explicit-null recipient suppression in durable harvest. The final run passed after preserving null as an explicit suppression value.

New regressions verify enrolled-project watcher and heartbeat draining. The dispatch scope test combines the registry with an injected database. It also verifies the Git environment and approved backend. A durable harvest test verifies the scoped record recipient reaches delivery.

Raw logs remain in `.runs/slack5-composition-nov23/`. The folder retains both failed runs and the final passing run. It also contains build and lint logs.
