# Hosted lint enforcement

GitHub rejected an intentional formatting error after build and tests passed. The clean follow-up passed both supported Node versions. Blocked: none for this proof.

| Check | Required result | Observed result | Verdict |
|---|---|---|---|
| Node 22 build and tests with formatting fixture | Pass | Pass | Pass |
| Node 22 lint with formatting fixture | Fail | Exit 1 for the fixture | Pass |
| Node 20 lint after fixture removal | Pass | Pass | Pass |
| Node 22 lint after fixture removal | Pass | Pass | Pass |

The negative head was `23a7ed71`. [The failing run](https://github.com/gforge-esc/gwrk/actions/runs/44369802984) reported one formatting error in `src/ci-lint-negative-fixture.ts`. Matrix fail-fast canceled Node 20 after Node 22 failed at lint.

Commit `4484b570` removed the fixture. [The clean run](https://github.com/gforge-esc/gwrk/actions/runs/44370678999) passed both matrix jobs. [Draft pull request 237](https://github.com/gforge-esc/gwrk/pull/237) exists only for this proof and must remain unmerged.

The earlier ship invocation recorded a failed acceptance dispatch after Antigravity exhausted its credits. This hosted evidence supplements that record. It does not change the failed invocation into a successful ship run.
