# Stable pagination repair

The earlier repair assumed consecutive PR numbers across update-ordered pages. It rejected normal number gaps and missed backward shifts with non-ascending PR numbers. Both retained reviewer regressions failed before this repair.

The adapter now enumerates all repository PR states in creation order. Reopening a PR or changing its base does not remove an entry from that query. The API supports these parameters in the [GitHub pull request listing contract](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests).

A complete first pass records ordered PR identities per page. A second pass must match those identities before its current terminal facts are returned. Changed identities retry within the existing five-attempt bound. The page limit remains enforced. Repeated changes fail without returning a partial batch.

The verified pass filters open PRs and other base branches locally. It preserves exact repository checks and the inclusive terminal timestamp boundary. Number gaps require no special case. The coordinator must derive its watermark from verified terminal timestamps across the batch. Array order does not define terminal timestamp order.

All 13 adapter cases pass. The full Phase 3 gate passes 101 tests with build and lint. Added cases cover continuous scan changes and a reopened PR whose identity stays in place. Another case verifies local filtering of open PRs and other branches.

The logs are `/tmp/gwrk-durable-pagination-boundary-red.log` and `/tmp/gwrk-durable-stable-pagination-phase3-green.log`. Build and lint logs use the `/tmp/gwrk-durable-stable-pagination-` prefix. Prior reviews remain retained. Independent clearance is still required.
