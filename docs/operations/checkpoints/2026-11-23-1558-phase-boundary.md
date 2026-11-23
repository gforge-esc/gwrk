# Core implementation checkpoint

Model qualification is complete at `543b6c2a`. All five phases have passing gates and independent reviews plus required CI. Thirty-four of thirty-five core phases are cleared. Blocked: durable recovery Phase 6 has eight reproduced integration failures. The coordinator owns final integration and verification.

## Active jobs

| Assignment | Branch | Worktree under its parent | State |
|---|---|---|---|
| Recovery repair Phase 6 | `feat/049-durable-dispatch-harvest` | `durable-next-phases-nov18/.runs/sandboxes/049-durable-dispatch-harvest-ship-0502526d` | Antigravity repair from preserved implementation |
| Integration | `codex/full-feature-integration-nov18` | `full-feature-integration-nov18` | Coordinator owns reviewed candidate |
| Preserved first recovery call | `codex/durable6-preserved-829-nov23` | `durable-next-phases-nov18/.runs/sandboxes/049-durable-dispatch-harvest-ship-fdcce79b` | Inactive and archived |

Parents live under `/Users/gonzo/Code/gwrk-worktrees`. Each branch has one writer. The repair uses one inference slot. Two worker slots are available. Heavy checks retain a separate two-slot limit. Final verification is the next assignment after repair clearance.

## Cleared phases

| Feature | Gates and reviews | Required CI |
|---|---|---|
| 044 Architecture policy | All four cleared | All four passed |
| 045 Workflow governance | All four cleared | All four passed |
| 046 Model discovery | All five cleared | All five passed |
| 047 Model qualification | All five cleared | All five passed |
| 048 Project identity and Slack | All six cleared | All six passed |
| 049 Durable dispatch and harvest | First five cleared | First five passed |
| 050 Linux lifecycle | All five cleared | All five passed |

Foundations 040 through 043 remain integrated. PR 222 remains present on develop at `d3120324`. Final merge approval remains David's decision.

## Remaining repair

The first recovery implementation at `82901eba` builds and passes 54 scoped tests. Its full-suite check found six integration failures. The coordinator held the retry when diagnosis lacked their context. It then archived the source and stopped that call before another repair agent ran.

Two retained actual-port cases reproduce foreign Git repository selectors in the GitHub child environment. They also reproduce a stalled enrolled poll exceeding the 6.5-second shutdown bound. Six earlier cases need coordinated fixture migration to durable ports. They must retain project scope and valid webhook identity. The expanded shared gate reproduces eight failures while 150 tests pass. One test is skipped and one remains a todo.

The fresh repair preserves the first implementation. Its scoped and full baselines both contain those eight failures. The integration file now belongs to the phase gate. No reproduced failure may remain grandfathered in the final candidate. [Diagnosis and repair boundary](../../../specs/049-durable-dispatch-harvest/evidence/nov23-integration-port-diagnosis.md)

## Verification and companions

Integration source `317835c5` passes both required jobs in run `45282165605`. Its model phase gate passes 256 tests. The webhook authentication repair has independent clearance and passes 85 boundary tests. It rejects missing or blank webhook secrets before writes. [Security readiness](../hosted-security-readiness.md)

The prior complete Linux CI run at `07cb062a` passed 4401 tests on both Node versions. Final recovery integration still requires refreshed full and native Linux verification. The final PR head must pass both required jobs.

Companion source `f40af40` passes nine adapter tests against core `317835c5`. All sixteen manifests validate and all sixteen digests match. Ten framework packs retain conditional architecture guidance. The companion repository has no configured CI. [Compatibility receipt](../companion-plugin-compatibility-nov23.md)

## Completion chain

Recovery repair must pass its expanded gate and full suite. Independent code and acceptance clearance follows. Final-head CI then releases combined integration. Final delivery needs combined checks and native Linux evidence plus documentation alignment. It also needs PR links and merge order.

The intended pilot target is David's AWS account at `gwrk.gforge.ai`. No deployment or DNS change has occurred. Production Google login and API credential security remain mandatory pilot gates. The Google CLI and Chrome are available setup paths. Preserve the existing skills-connection configuration. Alert David before Google-auth setup and verify costs before cloud changes. Give manual steps only when the CLI and browser cannot complete them.

Hosted pilot 051 and rollout 052 follow core completion. They remain outside this implementation completion claim. [Hosted handoff](../core-to-hosted-pilot-handoff.md)
