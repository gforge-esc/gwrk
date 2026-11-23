# Branch setup milestone fixture

The Git-isolation fixture waits for the actual branch setup event. Blocked: the new candidate still needs both CI jobs.

Node 22 CI run 45264917153 failed one assertion in `src/server/integration.test.ts`. The test polled for the branch setup spy with the default one-second budget. The other 4,345 tests passed. Matrix fail-fast cancelled Node 20. Evidence is `/tmp/gwrk-nov23-runner-b34-ci-failure.log`.

A controlled 1.2-second startup reproduces the same assertion failure. The immediate startup case passes. Evidence is `/tmp/gwrk-nov23-ci-branch-milestone-red.log`.

The fixture now records the explicit activation-stage event after branch setup. It also records an error if ship ends before that event. The test awaits this result under its normal test deadline. It retains all worktree and inherited-Git-selector assertions. Both immediate and delayed startup cases pass. Evidence is `/tmp/gwrk-nov23-ci-branch-milestone-green.log`.

This changes test synchronization. It does not change dispatch behavior or reduce project-isolation coverage. The full integration and Git-manager suites pass in `/tmp/gwrk-nov23-ci-branch-milestone-full-green.log`.
