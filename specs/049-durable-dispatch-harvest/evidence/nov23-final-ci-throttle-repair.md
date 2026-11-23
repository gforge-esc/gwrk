# Final CI throttle repair

Combined CI found a dispatch timestamp before its configured deadline. The retained regression reproduces the failure without lowering the minimum. Independent review returned GO. Both combined platform suites pass. Final-head CI controls merge readiness.

## Diagnosis

[Combined CI run 45290844550](https://github.com/gforge-esc/gwrk/actions/runs/45290844550) failed one test on Node 22. The linked-worktree throttle test observed 299 ms against a required minimum of 300 ms. The other 4475 tests passed. The log cannot distinguish an early timer callback from wall-clock movement.

The production path slept once and then persisted `Date.now()`. It did not recheck the deadline. A controlled early wake reproduces the observed result. The on-time control passes. The regression retains the primary-checkout state path and the worktree execution context. It also retains the grounding assertions and the original minimum.

## Repair

Test-only commit `63fe288a83efe43487d6d4f72572eedd1954f14f` retains the actual RED result. Source commit `f8d1f2d8c5fe2618fe8c209574ad7983e8c7e56c` rechecks the existing absolute deadline after every sleep. The adapter records its dispatch timestamp only after the deadline has elapsed.

| Check | Target | Result |
|---|---|---|
| Controlled early wake before repair | Reproduce premature dispatch | RED: one failure |
| On-time control before repair | Preserve valid dispatch | PASS: one case |
| Both deterministic cases after repair | Meet unchanged minimum | PASS: two cases |
| Eight related suites | Zero failures | PASS: 200 tests |
| Build and lint | Zero failures | PASS |

The diagnosis worktree retains `.runs/throttle-ci-diagnosis-nov23/manifest.json`. It records the actual RED and GREEN logs. Both commits used normal hooks and explicit Git identity. The repair changed no credential or authorization behavior. It introduced no clock or concurrency redesign.

The independent review passes build and lint plus both timing controls. The final macOS suite passes 4468 tests. Native Linux passes 4477 tests. Both have zero failures. See the consolidated review packet for source hashes and proof locations. Final-head CI must also pass.
