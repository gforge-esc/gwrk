# Core implementation checkpoint

Durable adapters cleared Phase 3 and are integrated. Final completion still depends on model routing and scoped server behavior plus durable coordination.

## Jobs and capacity

Three inference slots are occupied. Heavy verification remains limited to two runs. Each feature branch has one writer in its own worktree. Worktrees below are under `/Users/gonzo/Code/gwrk-worktrees`.

| Job | Branch | Worktree | Stage |
|---|---|---|---|
| Governance seed 045 Phase 4 | `feat/045-workflow-governance` | `workflow-governance-plan/.runs/sandboxes/045-workflow-governance-ship-9ff860a1` | Code review after 43 checks |
| Model promotion 047 Phase 4 | `feat/047-model-qualification` | `model-phase4-red-nov18/.runs/sandboxes/047-model-qualification-ship-8c086713` | Second attempt with frontier implementation |
| Slack routing 048 Phase 4 | `feat/048-project-identity-slack` | `slack-phase4-prep-nov18/.runs/sandboxes/048-project-identity-slack-ship-4a26cf12` | Second attempt with frontier implementation |
| Combined verification | `codex/full-feature-integration-nov18` | `full-feature-integration-nov18` | Refreshed full suite |

## Cleared phases

Foundations 040 through 043 remain preserved. Onboarding 044 and hermetic CI 046 have cleared every phase. Linux packaging 050 has also cleared every phase. Governance 045 and model qualification 047 have cleared their first three phases. Slack identity 048 has cleared its first three phases.

Durable operations 049 now has three cleared phases at `679c6825`. Code and acceptance reviews passed. Both CI jobs passed in run 44447926701. The next preparation checkout includes cleared Slack Phase 3. Its build and lint pass with 114 composition checks.

## Blocking findings

Model promotion must recompute qualification evidence before accepting a pin. Ten retained regressions cover timing and handoff validation plus CLI input handling. The second attempt uses Neon. No promotion is claimed.

Slack review retained one new regression. Operations alerts reach presence handling with their old feature-channel recipient and are dropped. The second attempt must pass the canonical recipient through that boundary.

Governance seed awaits code and acceptance review. Its prepared implementation passes 43 checks with a clean repository baseline.

## Completion dependencies

Model promotion releases qualified routing. Slack routing releases scoped server routes and then enrollment interfaces. Durable adapters release dispatch and harvest coordinators. Durable ingress and status follow those coordinators and scoped authorization.

Assign the next released slot to durable Phase 4 with frontier implementation. Its handoff and approved ports are prepared at `specs/049-durable-dispatch-harvest/evidence/phase04-integration-handoff.md`. Carry the bounded transport composition before durable Phase 5.

Final completion requires every phase gate and blocking finding cleared. Both CI jobs must pass on each final PR head. The combined candidate still needs refreshed full and native Linux verification after its final composition. Companion plugins and ADR references must align.

## Evidence and scope

The combined candidate at `056498a2` passes 4,142 full-suite checks with 16 skipped and six todo. Native Linux verification passes 892 checks across 27 files with one todo. Its immutable archive matches `056498a2`. The durable merge passes its 112-check adapter gate and 27 focused composition checks. Two retained regressions first failed against the incoming transport. The composition preserves cancellation and metadata with the captured workspace-verified token.

The companion plugin candidate passes nine checks. All 16 registry digests match. Goose now advertises exact model forwarding to core qualification. Companion PRs have no configured CI jobs. Their local evidence does not establish live model qualification.

PR 222 remains merged on clean local and remote develop at `d3120324`. No user PR has been merged during this effort. Incomplete feature PRs remain drafts. Live deployment and DNS remain external. Google authentication configuration and project enrollment remain outside this completion claim. Hosted pilot 051 and rollout 052 follow core review.
