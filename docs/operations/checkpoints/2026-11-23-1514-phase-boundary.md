# Core implementation checkpoint

Enrollment is complete at `11e52fc9`. All six phases have gates and review clearance plus passing required CI. Blocked: model routing remains under repair. Durable ingress awaits CI. Durable recovery and status follows ingress clearance.

## Jobs and ownership

| Assignment | Branch | Worktree under its parent | State |
|---|---|---|---|
| Model routing Phase 5 | `feat/047-model-qualification` | `model-phase4-red-nov18/.runs/sandboxes/047-model-qualification-ship-b59cb63a` | Antigravity repair, two retained failures |
| Durable ingress Phase 5 | `feat/049-durable-dispatch-harvest` | `durable-next-phases-nov18/.runs/sandboxes/049-durable-dispatch-harvest-ship-f1f51365` | Code GO and acceptance GO, CI pending |
| Recovery parent preparation | `codex/durable-next-phases-nov18` | `durable-next-phases-nov18` | Compose reviewed enrollment interfaces |

Parents live under `/Users/gonzo/Code/gwrk-worktrees`. The coordinator owns integration branch `codex/full-feature-integration-nov18`. One writer owns each branch. CI waits use no inference capacity. Model repair and parent preparation use two worker slots. One slot is available. Heavy checks retain a separate two-slot limit.

## Cleared phases

| Feature | Gates and reviews | Required CI |
|---|---|---|
| 044 Architecture policy | All four cleared | All four passed |
| 045 Workflow governance | All four cleared | All four passed |
| 046 Model discovery | All five cleared | All five passed |
| 047 Model qualification | First four cleared | First four passed |
| 048 Project identity and Slack | All six cleared | All six passed |
| 049 Durable dispatch and harvest | First five cleared | First four passed |
| 050 Linux lifecycle | All five cleared | All five passed |

Foundations 040 through 043 remain integrated. Clean develop still contains PR 222 at `d3120324`. Worker checkouts remain unchanged by integration operations.

## Findings and evidence

Model review retained two failures. Runner evidence belongs to the primary checkout. Prompt validation must use the active worktree. A replaced evaluation bundle must match its promoted hash before route resolution trusts it. The prepared shared gate reproduces two failures while 254 tests pass. An added prompt-freshness guard passes. Completed qualification work remains preserved.

Durable ingress passes 357 scoped tests and its full suite. Code and acceptance reviews are GO at `c748517a`. Required CI run 45277163353 is pending. The preparation branch composes that source with cleared enrollment interfaces. Its manual route conflict retains authorization and durable receipt semantics. [Durable PR 235](https://github.com/gforge-esc/gwrk/pull/235)

Enrollment final head `11e52fc9` passes both required jobs in run 45275912718. The application source matches the reviewed head. Its complete phase gate passes 95 tests with one skipped. A native fixture repair passes 45 tests with no skips. Integration head `a0ca16c0` passes both jobs in run 45275838895. [Enrollment PR 231](https://github.com/gforge-esc/gwrk/pull/231)

Complete combined verification passed 4,335 tests at `8b0e7134`. Native Linux passed 4,320 tests at `fa002ca4`. Both precede final worker integration. Final composition requires both runs again. [Integration PR 240](https://github.com/gforge-esc/gwrk/pull/240)

## Completion chain

Durable ingress CI releases final recovery and status Phase 6. The prepared parent must preserve enrollment authorization and readiness. Model routing proceeds independently. Final worker integration then requires full gates and native Linux verification. Companion plugin alignment and final-head CI also remain required.

The next worker assignment is durable recovery after the CI-waiting worker releases its feature checkout. Its handoff is prepared. Every new ship call remains asynchronous and single-phase with `--worktree --max-iterations 2`.

Final delivery requires PR links and a merge order. David retains merge approval. No live deployment or DNS change has occurred. Google authentication configuration and live enrollment remain outside core completion. Hosted pilot 051 and project rollout 052 follow core review.
