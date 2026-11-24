# Throttle deadline repair review

GO for `f8d1f2d8`. Dispatch rechecks the existing throttle deadline after each timer wake. Blocked: none within this repair scope.

## Scope

The review compares `f1272d02` with `f8d1f2d8`. Two files change: the dispatch adapter and its tests. The repair adds no new concurrency policy. It preserves primary checkout throttle ownership and active worktree execution.

## Mechanical evidence

| Check | Result | Target | Evidence |
|---|---|---|---|
| Independent build | PASS | Zero type errors | `throttle-independent-build-lint.log` |
| Independent lint | PASS | Zero findings | `throttle-independent-build-lint.log` |
| Independent timing controls | PASS, two cases | No early dispatch | `throttle-independent-review.log` |
| Retained RED | One failure and one passing control | Reproduce the defect | `/tmp/throttle-ci-deterministic-red.log` |

The independent logs use the `/tmp/gwrk-nov23-` prefix. The focused command selected the primary-checkout throttle cases. The name filter excluded its 92 other tests. Both independent commands used the shared heavy-check wrapper.

The test-only RED commit is `63fe288a`. Its early-wake case observes 299 milliseconds against the unchanged 300-millisecond minimum. The on-time control passes. The production repair makes both cases pass.

## Boundary checks

The deadline remains the prior primary-checkout dispatch timestamp plus the configured throttle. Each wake recomputes the remaining interval. Dispatch continues after that interval reaches zero. The repair preserves non-throttled behavior.

The tests retain the primary state-file assertion. They retain the active worktree process directory and grounding assertions. They also retain the assertion that no worktree-local throttle state appears. The new sleep assertions distinguish an on-time wake from a wake one millisecond early.

The tests restore their timer and clock spies in a finally block. Each case uses its own temporary Git repository and linked worktree. The adapter change does not alter backend selection or prompt context.

## Findings

No blocking finding or additional coverage hole found within the approved deadline repair. No nonblocking note added. Final combined verification and CI remain the coordinator's responsibility.

This review made no source changes or live agent calls. No commit or push occurred.
