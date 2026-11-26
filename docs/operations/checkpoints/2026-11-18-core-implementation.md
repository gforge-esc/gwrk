# Core implementation checkpoint

PR #222 is present on develop. The integration checkout contains the reviewed foundations from features 040 through 043. Core completion remains blocked by the phases below. The implementation coordinator owns these repairs. The user retains final merge approval.

## Repository state

| Checkout | Branch | Verified state |
|---|---|---|
| Main gwrk | develop | Clean at d3120324 |
| Integration | codex/full-feature-integration-nov18 | Clean at 13d8eb41 before this checkpoint |
| Main plugins | main | Clean at d8d09e1 |

PR #222 merged on November 11, 2026. Its merge commit is d3120324eff80f3601c42d27486e20f9efa14d8b. That commit is an ancestor of origin/develop. Synchronizing the integration checkout reported already up to date. Active worker checkouts were preserved.

The integration candidate contains the final reviewed foundation heads. The heads are 040 at afd5a85a and 041 at 2352af83. They also include 042 at 544e2cc8 and 043 at 08f129e6. Their recorded phase runs passed gates and review.

## Workers

Worker parents are under /Users/gonzo/Code/gwrk-worktrees. Each ship invocation creates its own nested worktree. Each feature branch has one writer.

| Feature | Parent worktree | Job state | Blocking work |
|---|---|---|---|
| 044 Architecture onboarding | onboarding-policy-review-repair | Phase 2 review, iteration 2 | Manifest compatibility finding |
| 047 Model qualification | model-qualification-frontier-repair | Phase 3 review, iteration 2 | Promotion and workflow evidence findings |
| 049 Durable harvest | durable-phase2-review-repair | Phase 2 implementation, iteration 1 | Storage consistency and scope findings |
| 048 Slack | slack-phase3-review-repair | Queued review resumption | Phase 3 regression repaired and tested |
| 050 Linux packaging | linux-phase4-review-fixes | Queued acceptance resumption | Phase 4 acceptance and phase 5 |
| 046 Hermetic checks | hermetic-ci-phase5-red-nov18 | Phase 5 ship finished | Final-head CI verification and phase 1 clearance audit |

Active branches are feat/044-architecture-aware-policy, feat/047-model-qualification and feat/049-durable-dispatch-harvest. Slack resumes on feat/048-project-identity-slack when a worker becomes available. Linux resumes on feat/050-linux-runner-deploy-packaging. Hermetic checks use feat/046-hermetic-ci.

## Clearance

| Feature | Cleared phases | Remaining phases |
|---|---|---|
| 044 Architecture onboarding | 1 | 2–4 |
| 045 Workflow governance | None | 1–4 |
| 046 Hermetic checks | 2–5 gates and reviews | Phase 1 clearance audit and final-head CI |
| 047 Model qualification | 1–2 | 3–5 |
| 048 Slack | 1–2 | 3–6 |
| 049 Durable harvest | 1 | 2–6 |
| 050 Linux packaging | 1–3 | Phase 4 acceptance and phase 5 |

Feature 046 phase 1 has completed tasks but its latest phase-specific ship record failed review. Later phases contain related repairs. The existing implementation needs clearance evidence before core completion.

Feature 044 phase 2 has 93 passing targeted tests. Review still found a whitespace-only legacy framework compatibility defect. Feature 047 phase 3 has 613 passing targeted tests. Separate review probes reproduced promotion and workflow evidence failures. Passing gates do not clear those findings.

Slack phase 3 passed 118 phase checks before the full suite found five notification compatibility failures. The repaired parent subsequently passed 2,002 tests. It still needs the resumed phase reviews.

## Dependencies

| Sequence | Completion dependency |
|---|---|
| Architecture | Finish onboarding 044, then workflow governance 045 |
| Model qualification | Finish qualification 047 against reviewed agent routing 043 |
| Slack | Finish routing 048 independently of durable storage repairs |
| Durable harvest | Storage 049, then adapters, application flow, ingress and status |
| Linux packaging | Acceptance 050, then repeatable packaging evidence |
| Final candidate | All phases, companion plugins, combined tests and native Linux verification |

Approved ports allow adapter preparation before downstream implementations finish. Slack and durable harvest keep separate workers when capacity permits.

## Capacity

Three inference workers are active. The worker limit is three. A separate limiter allows two concurrent heavy checks. A three-job smoke check verified that limit. Future worker calls inherit the limiter through the private package-manager wrapper.

Codex weekly usage was 57 percent at the last quota check. Antigravity models reported exhausted credits. Claude authentication was unavailable. The current workers use gpt-6.2-sol with high reasoning. No additional provider capacity is assumed.

When a worker finishes or enters a CI wait, Slack review resumption is next. Linux acceptance follows. Hermetic phase 1 requires a separate clearance run after phase 5.

## Verification

| Evidence | Result | Source |
|---|---|---|
| Combined full suite | Pass, 2,938 tests | /tmp/gwrk-full-latest-ci.log |
| Native Linux tests at 13d8eb41 | Pass, all 230 tests | /tmp/gwrk-full-fixed-native-linux-tests.log |
| Installed Linux release at d562dfdc | Pass | /tmp/gwrk-full-latest-linux-container.log |
| Heavy-check concurrency | Pass, peak two workers | Private limiter smoke check |

These results cover the recorded candidates. Later feature changes require combined verification again. Individual ship success does not replace required CI on each final PR head.

The companion plugin candidate is db6d175 in plugin-cascade-merge-proof. Its nine checks pass. Plugin PR 2 covers Goose forwarding. PR 3 covers model discovery. PR 4 covers framework guidance. External CLI qualification remains separate from synthetic checks.

## Completion boundary

Initialization must make no LLM inference calls. Existing projects receive target context without a conformance claim. Policy selection must agree across architecture and language. Framework and workflow guidance must use the same selection. Authorization and receipts must preserve project scope. Model promotion requires the agreed evidence and independent judges.

Features 051 and 052 remain a later hosted pilot and rollout stage. Live deployment and DNS remain external prerequisites. Google authentication configuration and project enrollment also remain external prerequisites. No live deployment has occurred. No final merge approval has been granted.
