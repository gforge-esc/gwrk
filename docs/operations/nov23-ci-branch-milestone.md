# Git and ADR fixture contracts

The Git-only fixture declares no test toolchain and waits for its actual setup event. The ADR race fixture coordinates both snapshots before either claim. Blocked: the corrected candidate needs both CI jobs.

## Git-only fixture

Node 22 CI run 45264917153 failed the branch-setup assertion in `src/server/integration.test.ts`. The fixture polled with a one-second budget. A controlled 1.2-second startup reproduces that failure. The test now awaits the activation-stage event and reports an error if ship exits first. All inherited-selector and worktree assertions remain active.

The stronger diagnostic exposed another cause in run 45267425000. The Git-only worktree had no package manifest but inherited the default Vitest command. The repaired runner rejected pnpm's missing-manifest error. The fixture now tracks a project configuration declaring `toolchain.test: null`. This matches its Git-only purpose without relaxing production execution checks.

## ADR overlap

The same CI run exposed a scheduling assumption in `src/engine/adr-scaffold.test.ts`. Two calls started together need not read the same corpus. A later read can allocate the next number successfully. The test had assumed both calls selected the same number.

The test now coordinates the two real directory snapshots before allowing claims. It verifies that both reads reached the barrier. Claims and writes still use the real filesystem. The original unique-number and rejected-loser assertions remain intact. The temporary module wrapper resets after the race.

## Evidence

| Check | Verdict | Target |
|---|---|---|
| Delayed startup before event synchronization | RED, one case | Reproduce the polling failure |
| Explicit event synchronization | PASS, two cases | Immediate and delayed startup |
| Snapshot barrier verification before wiring the default export | RED, one case | Confirm both reads use the barrier |
| Final integration and ADR suites | PASS, 67 cases | Zero failures |

Original CI evidence is `/tmp/gwrk-nov23-runner-b34-ci-failure.log` and `/tmp/gwrk-nov23-ci-branch-milestone-ci-failure.log`. Local reproduction is `/tmp/gwrk-nov23-ci-branch-milestone-red.log`. The barrier verification is `/tmp/gwrk-nov23-adr-snapshot-barrier-red.log`. Final passing output is `/tmp/gwrk-nov23-ci-fixture-contracts-green-2.log`.

These changes clarify test setup and synchronization. They do not change dispatch behavior or ADR allocation. No project-isolation assertion was removed.
