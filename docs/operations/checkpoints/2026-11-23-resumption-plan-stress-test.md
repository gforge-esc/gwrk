# Stress test: Core completion plan

APPROVE. Independent feature writers can repair the blocking boundaries while cleared work joins the integration branch. Blocked: nothing in the execution order.

## Dependencies

| Phase | Depends on | Blast radius | Rollback |
|---|---|---|---|
| Server repair and enrollment | Preserved server heads | Medium | Retain source heads |
| Durable coordinator repair | Preserved coordinator head | Medium | Retain source head |
| Durable ingress and CLI | Coordinators and approved ports | Medium | Stop isolated branch |
| Governance acceptance | Cleared seed implementation | Low | Preserve review evidence |
| Model routing | Cleared promotion and unified routing | Medium | Retain promotion head |
| Combined verification | Every cleared final head | Medium | Keep develop unchanged |

## Critical path

Durable coordinator repair to durable ingress to durable CLI to combined verification. Four stages by phase count. Durations remain unknown. Server authorization composition may become a parallel completion dependency.

## Failure scenarios

| Root cause | Phase | Prevention | Early signal |
|---|---|---|---|
| Passing legacy gates hide missing behavior | Server repair | Restore all six review regressions | Review and gate divergence |
| Shared checkout collisions | All writers | One feature writer and worktree | Worktree inventory |
| Recipient identity changes across adapters | Ingress composition | Test verified project and thread boundaries | Cross-project fault cases |
| Earlier CI result mistaken for final clearance | Final verification | Check each final head | Head mismatch |
| Old operator environment breaks Git | Dispatch | Remove malformed transient Git config count | Preflight Git failure |

## Alternatives

| Alternative | Critical path | Top blast radius | Assessment |
|---|---|---|---|
| Sequential | Seven feature phases before integration | Medium | Longer than the selected plan |
| Most parallel | Four dependent stages | Medium | Matches the selected three-worker plan |
| Most conservative | Four dependent stages | Medium | Branch isolation and no deployment already apply |

## Assumptions

- Independent adapters may implement approved ports before final composition.
- No live rollout or durable production data changes occur in this effort.
- Native Linux verification and final CI remain mandatory.
