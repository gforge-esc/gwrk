# Test suite completion repair

The ship loop rejects interrupted test runs before comparing assertion counts. Blocked: none.

## Evidence sources

All raw logs below remain under `.runs/ship-suite-completion-nov23/` in the repair checkout.

| Source | Population | Contents | Use |
|---|---|---|---|
| `regression-red.log` | Original ship runner | Controlled execution regressions | Reproduction |
| `execution-red.log` | First runner repair | Actual child processes | Stderr capture |
| `final-green.log` | Repaired ship runner | Orchestration and gate tests | Verification |
| `independent-model.log` | Separate model worker | Complete repository run | Timing evidence |
| `independent-enrollment.log` | Separate enrollment worker | Complete repository run | Timing evidence |

## Cause

The old runner imposed a 120-second deadline. It discarded the process failure and parsed captured output as completed test results. Without a terminal summary, the generic parser accepted fixture text such as `Gate reconciliation: 2/5 passed (3 failed)`. That produced three alleged assertion failures. An older baseline of eight then permitted an interrupted run to pass comparison.

The deadline also included verification-capacity waiting. The wrapper permits a bounded 300-second wait before test execution. The independent model run passed 4,208 tests in 117.04 seconds. The separate enrollment run passed 4,324 tests in 92.24 seconds. Those runs provide timing evidence for their respective checkouts. They do not verify this repair.

## Changes

The shared test executor captures process failure separately from assertion results. Timeout and cancellation produce an execution error. Output-buffer exhaustion does too. Nonzero execution without completed failing-test results cannot become a baseline comparison. Shell-encoded signal exits remain execution failures even when captured output contains a passing summary.

The parser accepts recognized runner summaries. It preserves completed results from Vitest and Jest. It also preserves pytest and Node summaries. Go and Cargo parsing remain available. Fixture gate logs no longer supply assertion counts.

The executor captures successful stderr output because Jest writes its summary there. It merges streams before executing the command. This avoids adding a wrapper subshell. Captured output has a 16 MiB bound. Timeout termination uses SIGKILL.

Scoped runs allow 360 seconds. Whole-repository runs allow 600 seconds. These bounds include verification-capacity waiting. Authored integration commands retain their existing 300-second bound.

Baseline capture stops on execution failure and publishes neither baseline. Test verification rejects execution failure before checking liveness or comparing counts. An authored passing gate cannot override an interrupted scoped runner. Test activation also rejects interrupted execution as RED evidence.

The ship state retains the complete captured diagnostic output. DIAGNOSE reads that state even when every task gate passed. The repair does not reopen completed tasks or change their gate results.

## Verification

| Check | Result | Target |
|---|---|---|
| Original controlled regressions | Reproduced, 12 failures | Observed failure before repair |
| Final related suites | Pass, 243 tests | Zero failures |
| Independent completion and parser review | Pass, 53 tests | Zero failures |
| Build | Pass | Zero type errors |
| Lint | Pass | Zero findings |

The controlled regressions call the real ship suite method with controlled child-process outcomes. They verify that old baselines cannot accept incomplete execution. They also verify diagnostic retention with completed tasks.

Four actual child-process tests verify successful stderr summaries. They exercise a real timeout and a signal after a passing summary. They also exercise nonzero partial output. The stderr test failed before stream capture changed.

Existing lifecycle and branch fixtures now emit completed summaries for their mocked test commands. Their assertions remain unchanged.

The final verification command ran through the shared heavy-check wrapper:

```sh
python3 /Users/gonzo/Code/gwrk/.runs/run-heavy-check.py pnpm exec vitest run src/engine/ship-orchestrator*.test.ts src/engine/test-runner*.test.ts src/utils/gate-exec.test.ts src/utils/gate-runner.test.ts src/polyglot-canary.e2e.test.ts
```

`final-green.log` retains the complete result. `build.log` and `lint.log` retain the remaining checks. The repair checkout contains no changes to active worker outputs.
