# Routing and dispatch test evidence

Four regressions reproduced in the routing worktree. Blocked: none for the routing policy and adapter phase.

| Requirement | Test | Observed failure |
|---|---|---|
| Exact definition model | `src/utils/resolve-model.test.ts` | Definition dispatch returned the registry label. |
| Pure route policy | `src/domain/agent-routing.test.ts` | The policy module did not exist. |
| Exact ship model | `src/server/backend-selector.test.ts` | Model failover returned the registry label. |
| Separate review route | `src/engine/ship-orchestrator.review-gate-divergence.test.ts` | Code review received the implementation model and no selected effort. |

The fixes passed the role, adapter, skill and boundary suites. Later phases cover unified prompt delivery and cross-provider terminal failures.
