# Integration port diagnosis

Phase 6 needs a narrow repair against its preserved implementation. The original six integration failures reproduce. Two added tests confirm defects in the actual durable GitHub effect port. Diagnosis changed no production files.

Source: `82901eba8cb525a12975b4498620b036e50b3752` in `codex/durable6-regression-diagnosis-nov23`.

## Findings

| Original case | Actual failure | Cause |
|---|---|---|
| Two live servers | Empty poll-root list | Empty enrollment enters explicit durable watcher path |
| Bounded GitHub poll shutdown | Local child marker absent | Fixture expects legacy `execCommand` polling |
| Startup terminal persistence | Legacy sync spy called zero times | Fixture has no enrolled durable target |
| Signed merged webhook | HTTP 400 | Missing GitHub delivery ID |
| Scoped webhook Git selectors | HTTP 400 | Missing GitHub delivery ID |
| Scoped watcher Git selectors | Poll options absent | Fixture observes legacy polling function |

The startup fixture registers a historical project row in SQLite. It does not enroll a canonical project in the registry. Phase 6 now supplies explicit durable dependencies to `HarvestWatcher`. That path polls enrolled projects and resumes durable work. It does not call the legacy polling function for an empty registry. The old spies cannot prove the new path's effect isolation.

The webhook fixtures also omit repository identity and use abbreviated synthetic merge SHAs. Keep delivery identity, enrolled repository checks and full commit validation. Migrate successful webhook fixtures to the durable input contract. Preserve root and ledger assertions through the approved ports. Retain run and gate evidence. Keep caller and thread ownership checks. Preserve explicit legacy compatibility tests separately if that behavior remains required.

## Actual effect ports

Two new cases in `src/server/integration.test.ts` use a local synthetic `gh` executable. Neither case performs a network request.

| Case | Expected | Actual |
|---|---|---|
| Durable GitHub repository selectors | Foreign selectors absent | `GIT_DIR`, `GIT_WORK_TREE` and `GH_REPO` inherited |
| Enrolled durable poll shutdown | Drain within 6.5 seconds | Still running at the deadline |

`createGitHubHarvestAdapter` supplies the child environment from `process.env`. It does not use the repository Git environment helper. Preserve the caller's checkout root and remove inherited repository selectors at this boundary. The new test observes the actual child environment rather than a replaced polling function.

The adapter sets a 12-second timeout and exposes no cancellation signal. `HarvestWatcher.stop` aborts its controller and awaits in-flight work. The durable GitHub port does not consume that cancellation. Its child can ignore the timeout's termination signal. Preserve bounded cancellation and escalation through the real effect port. Do not satisfy the test by adding a sleep or removing the shutdown assertion.

The shutdown fixture enrolls a verified synthetic repository in real SQLite before starting its watcher. It waits for the actual child marker before closing. Cleanup kills only that fixture child after recording the failed drain assertion. The test leaves no child behind.

## Verification

| Check | Result | Log |
|---|---|---|
| Original integration file | FAIL: 6 failed, 31 passed | `/tmp/durable6-integration-red.log` |
| New actual-port cases | FAIL: 2 failed, 37 skipped | `/tmp/durable6-actual-ports-red.log` |
| Expanded integration file | FAIL: 8 failed, 31 passed | `/tmp/durable6-integration-expanded-red.log` |
| Build | PASS | `/tmp/durable6-diagnosis-build.log` |
| Lint | PASS | `/tmp/durable6-diagnosis-lint.log` |

The proposed Phase 6 gate now requires and runs the integration file. Phase 6 test targets include it. This gives the held operator a failing task gate with error context instead of only an outside-suite summary.

The coordinator applied the test, gate and task-target patch during an exclusive handoff. The production repair must address the two actual-port failures. It must also migrate the six retained integration cases without weakening their behavior checks. Run the expanded integration file and shared gate before resuming independent review. No production repair or automatic retry occurred here.

## Coordinated repair boundary

The first implementation at `82901eba` remains preserved. The coordinator archived the held call before stopping it at the failed-suite boundary. No second repair agent ran. Its checkout remains on `codex/durable6-preserved-829-nov23`. The next call uses the existing implementation and these retained regressions. It does not restart completed foundation phases.

The parent also includes reviewed integration `317835c5`. Model qualification and enrollment are cleared there. Webhook authentication guards are reviewed and must remain intact. Positive webhook fixtures must provide configured secrets and valid raw signatures. Preserve delivery IDs and enrolled repository identity. Use full commit hashes.

Repair the two actual effect-port defects before migrating obsolete fixture observers. Keep the existing project-root and caller receipt assertions. Poll cancellation must stop the owned child within the existing bound. Include escalation when that child ignores termination. Remove inherited repository selectors from the actual GitHub transport. Keep public GitHub and repository scoping explicit.

The strengthened shared Phase 6 gate now includes `src/server/integration.test.ts`. Its existing authentication regression suites remain required. The final scoped and full suites must pass with zero failures. Do not grandfather the reproduced failures from this baseline. Independent code and acceptance reviews remain required.

The composed parent gate reproduces eight failures while 150 tests pass. One test is skipped and one remains a todo. The log is `/tmp/gwrk-nov23-durable6-prepared-gate-red.log`. All other selected suites pass with the reviewed model routing and webhook security fixes present.

Preserve the existing implementation of T033 and T034 plus T036 and T037. Their shared gate exposes these cross-cutting regressions. Repair the process adapter and cancellation boundary. Migrate the six retained fixtures to the approved durable ports without weakening assertions. Do not reapply archived patches that are already present.
