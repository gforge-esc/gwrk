# Worktree and evidence routing repair

Phase 5 remains blocked by two reproduced routing defects. The next bounded repair must preserve primary checkout evidence ownership and active worktree prompt validation.

## Source

| Item | Source |
|---|---|
| Final reviewed model history | `25867f12` |
| Reviewed integration | `11e52fc9` |
| Preparation merge | `0c058497` |
| Review source | `2200ac60` |
| Review report | `code-review-phase-05-2200ac60.md` |
| Private archive | `047-model-qualification-ship-4fb883d8-20261123T220532642485Z` |
| Behavioral patch | `.runs/review-regressions-phase05-20261123T220200Z-bf520f03.patch` |

The preparation fast-forwarded the final model history and merged the reviewed integration with normal hooks. The merge hook build passed. The final source already contains both archived regression cases. Reverse application checking passed before the added coverage.

Patch SHA-256: `fba283527424dc09cf2c605c7bea555602e8708bf70b5e775e58c2f915bfdab6`.

## Findings

| Owner task | Reproduction | Actual result | Required result |
|---|---|---|---|
| Route resolution, T021 | Replace an evaluation bundle under its promoted evaluation ID after catalog drift | Pinned route | Stale diagnostic without a selected model |
| Workflow dispatch, T023 | Execute ship review in an isolated worktree with discovery only in its primary checkout | Stale model-unavailable error | Qualified pinned review in the active worktree |

`resolveQualifiedRouteFromStore` trusts `eligibleRoutesDigest` from the current bundle at the evaluation ID. It does not verify that bundle against the promoted `evaluationBundleHash` before trusting the digest. Replacement data can therefore make changed discovery appear fresh. Verify the promoted evidence before trusting the bundle or fail closed with a diagnostic.

`ShipOrchestrator.runNativeWorkflow` supplies its worktree as `projectRoot`. `WorkflowRuntime` uses that root for route resolution as well as rendering. Discovery then comes from the worktree even though the owning primary checkout stores runner evidence. Keep these roots separate. Use the primary checkout for runner discovery and evidence. Use the active worktree for prompt validation and execution.

The added case mirrors discovery into the worktree to isolate prompt freshness. It first verifies the worktree pin. It then changes the active review instructions and verifies the review hash changes. The primary pin stays fresh. Ship must reject the worktree pin with a prompt freshness diagnostic and dispatch nothing. A repair that redirects all validation to the primary checkout would violate this case.

## Verification

Both original regressions and the added prompt guard live in `src/application/models/resolve-route.test.ts`. The shared `gates/phase-05.sh` already requires and runs this file. No new test paths are needed. All five Phase 5 tasks retain their open status and shared gate.

| Check | Result | Log |
|---|---|---|
| Original focused regressions | FAIL: 2 failed, 42 passed | `/tmp/model-final-review-restored-red.log` |
| Focused tests with prompt guard | FAIL: 2 failed, 43 passed | `/tmp/model-final-review-strengthened-red.log` |
| Shared Phase 5 tests with inherited Git configuration | FAIL: 19 failed, 237 passed | `/tmp/model-final-review-phase05-red.log` |
| Shared Phase 5 tests with clean Git configuration | FAIL: 2 failed, 254 passed | `/tmp/model-final-review-phase05-clean-env-red.log` |
| Build | PASS | `/tmp/model-final-review-build.log` |
| Lint | PASS | `/tmp/model-final-review-lint.log` |

The first shared run inherited a malformed `GIT_CONFIG_COUNT` setting. Fixture setup produced 17 additional failures. The rerun removes that setting before launching the same tests.

Tests use the private bounded heavy-check wrapper. Fixtures simulate qualification and agent dispatch. Preparation performs no live inference or deployment. Production code remains at the ancestry merge. The added test and this brief remain uncommitted for review.

Private evidence copies and SHA-256 digests are in `.runs/model-worktree-evidence-repair-nov23/manifest.json`. The original archive remains unchanged. The committed source reverse-check log records that both reviewed cases were present before the added guard.
