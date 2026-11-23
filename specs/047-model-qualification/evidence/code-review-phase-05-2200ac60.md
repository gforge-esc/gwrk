# Phase 5 model routing review

NO-GO for `2200ac60`. Two routing defects block acceptance. The model qualification owner has two repairs.

## Findings

| Task | Reproduction | Result |
|---|---|---|
| T023, workflow dispatch | Ship worktree with discovery in the primary checkout | Fresh pin in primary checkout, `stale (model-unavailable)` in worktree |
| T021, route resolution | Changed catalog and replacement bundle under the original evaluation ID | `pinned` despite bundle and snapshot hashes that differ from the lock |

Ship passes the worktree as the root for both prompt rendering and runner evidence. Resolve runner evidence from the owning checkout. Keep prompt validation and execution in the worktree. [Ship workflow dispatch](../../../src/engine/ship-orchestrator.ts)

The store-backed resolver accepts the eligible catalog digest from any bundle at the primary evaluation ID. Verify the bundle against the promoted hash before trusting that digest. Use the lock's snapshot evidence or report a stale pin when verification fails. [Store-backed route resolution](../../../src/application/models/resolve-route.ts)

## Verification

The original Phase 5 gate passed all 253 tests. This includes the four retained failures from the previous review. The build and repository lint passed. All 44 additional ship routing and review gate tests passed.

The expanded gate failed both new cases and passed the other 253. All five tasks remain open because they share this gate. The previous tests used one checkout for ship dispatch and a missing evaluation bundle for catalog drift. [Routing regression tests](../../../src/application/models/resolve-route.test.ts)

Regression patch against `2200ac60` is `.runs/review-regressions-phase05-20261123T220200Z-bf520f03.patch`. The review used synthetic inputs. Live qualification remains an operator task.
