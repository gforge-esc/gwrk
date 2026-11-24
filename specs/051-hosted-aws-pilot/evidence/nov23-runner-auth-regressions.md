# Runner authentication regressions

The Phase 7 preparation reproduces 31 failing regressions and 11 passing controls against source `c52436c5`. Hosted authentication validation and worker environment isolation remain open. The Phase 7 implementation owner must resolve these cases before completion.

## Contract

The tests use the frozen deployment boundary from commit `399d4b4d`. Its source is `specs/051-hosted-aws-pilot/contracts/deployment-boundary.md` on the hosted pilot parent branch. This preparation reads that contract without merging the active Phase 1 implementation.

Only two test files and this evidence note change. Production code remains unchanged.

## Results

| Check | Observed result | Receipt |
|---|---|---|
| Initial runner cases | RED: 1 failed, 7 passed | `.runs/runner-auth-prep/contract-independent-red.log` |
| Expanded runner and worker cases | RED: 31 failed, 11 passed | `.runs/runner-auth-prep/expanded-red.log` |
| Final malformed CSRF fixtures | RED: 3 failed, 36 skipped | `.runs/runner-auth-prep/csrf-final-red.log` |
| Build | PASS | `.runs/runner-auth-prep/build.log` |
| Lint | PASS: 459 files | `.runs/runner-auth-prep/lint.log` |

The expanded run has no fixture errors or unhandled errors. The final CSRF run covers a later change to a synthetic short-secret value. It prevents a future diagnostic containing “short” from resembling disclosure of that value.

Run the focused cases through the private capacity wrapper:

```sh
unset GIT_CONFIG_COUNT
python3 /Users/gonzo/Code/gwrk/.runs/run-heavy-check.py pnpm exec vitest run tests/linux-runner/preflight-auth.test.ts src/utils/agent.auth-env.test.ts
```

## Findings

`tests/linux-runner/preflight-auth.test.ts` executes the release preflight and credential scripts against controlled temporary files. Missing hosted configuration passes preflight and reaches the intercepted server startup command. The runner also accepts invalid hosted settings and origin authentication files. Cases cover required settings and public origin. Other cases check bind addresses and file containment. File checks cover symlinks and ownership metadata. Content checks cover the allowlist and CSRF value. Permission checks reject public access.

Passing controls preserve outbound credential handling and Telegram denial. A valid hosted fixture completes the expected Git and provider availability probes. The credential loader retains origin settings without exporting the raw CSRF value.

`src/utils/agent.auth-env.test.ts` uses the shared dispatch path to launch a real Node child. Cases cover inherited environment and explicit task environment. A third case combines both. All three expose inbound authentication or gateway values to the child. Assertions require removal after environment merging. They also require outbound provider settings and safety flags to survive. Parent and task environments must remain unchanged.

## Limits

Runner fixtures simulate Linux identity and ownership metadata. They use real permission bits. They execute release scripts and embedded Node. They do not prove native Linux ownership enforcement or gateway directory isolation. Worker cases use a real local child process with a synthetic backend. No provider inference or network request occurs.

Earlier receipts retain the corrected Bash 3 incompatibility. They also retain the mock restoration error and synchronous fixture reporting timeout. Those logs are diagnostic history. The expanded receipt above supplies the regression counts.

The private receipt manifest records hashes for the tests and frozen contract. It also records log hashes. The preparation uses synthetic credentials throughout. It performs no deployment or authentication operation.
