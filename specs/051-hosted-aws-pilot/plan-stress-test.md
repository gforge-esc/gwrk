# Stress test: hosted AWS pilot implementation

APPROVE. The revised plan resolves the six ordering and contract findings. Blocked: nothing for task generation. The coordinator owns implementation readiness.

Reviewed source is `e65e73db`. This assessment covers the nine-phase implementation plan. The original REVISE assessment remains in [plan-review-first-pass.md](evidence/plan-review-first-pass.md). The deployment-only assessment remains separate.

## Finding clearance

| Finding | Resolution | Evidence | Status |
|---|---|---|---|
| Restricted callback prerequisites | Canonical DNS and TLS precede operator-restricted acceptance | Plan baseline and Phase 9 | Cleared |
| Coordinator authority | Authorized root operations permitted with observed receipts | Phase 9 ownership | Cleared |
| Session observation races | Atomic observation preserves revocation and original cap | Frozen port and session semantics | Cleared |
| Numeric policy and credential selection | Shared bounded defaults and explicit API precedence | Security policy and frozen policy section | Cleared |
| Store dependency | Phase 2 supplies storage and crypto before Phase 3 clearance | Dependency diagram and Phase 3 prose | Cleared |
| Installation and rollback | Reviewed artifacts and compatible code rollback retain authoritative ledger | Phase 9 and deployment rollback section | Cleared |

Session observation returns explicit revoked or metadata-conflict outcomes. Real two-connection tests must prove serialization and persistence after reopen. Observations never extend the original session deadline.

Caller Authorization selects API parsing before browser forwarding. A gwrk session cookie creates a credential conflict. Invalid bearer input cannot fall back to cookies. Missing browser sessions on API routes return JSON denials.

Worldwide application ingress remains closed until real acceptance passes. Canonical DNS and trusted TLS can support operator-restricted HTTPS after synthetic and native Linux gates. Human Google inputs and implementation merge approval remain prerequisites for live rollout.

## Dependencies

| Phase | Depends on | Blast radius | Rollback |
|---|---|---|---|
| 1 Ports and policy | Approved specification | Low | None stated for unexposed code |
| 2 API credentials and CLI | Phase 1 ports | Medium | None stated for isolated implementation |
| 3 Google and sessions | Phase 2 storage and Phase 1 ports | Medium | None stated for isolated implementation |
| 4 Origin guard and health | Phases 2 and 3 | Medium | None stated for isolated implementation |
| 5 CSRF and bounds | Phase 4 | Medium | None stated for isolated implementation |
| 6 Startup and CLI probes | Phase 5 | Medium | None stated for isolated implementation |
| 7 Gateway and runner | Phase 6 | Medium | Private installation rollback in deployment reference |
| 8 Combined verification | Phase 7 | Low | None stated for isolated fixtures |
| 9 Live acceptance | Phase 8 and human inputs | High | Close ingress and retain ledger during compatible code rollback |

| Phase | Inputs | Outputs | Owner as written |
|---|---|---|---|
| 1 Ports and policy | Specification and contract | Ports and pure policy plus Proposed ADR | Coordinator |
| 2 API credentials and CLI | Frozen ports | Auth storage and local administration | Coordinator |
| 3 Google and sessions | Ports plus store and crypto | Verifier and session orchestration | Coordinator |
| 4 Origin guard and health | Store and verifier | Verified HTTP context and filtered health | Coordinator |
| 5 CSRF and bounds | Guarded server | Mutation protection and secret-safe limits | Coordinator |
| 6 Startup and CLI probes | Protected server | Hosted factory and scoped client probes | Coordinator |
| 7 Gateway and runner | Working loopback origin | Synthetic edge and runner preflight | Coordinator |
| 8 Combined verification | Complete synthetic stack | Native proof and operator handoff | Coordinator |
| 9 Live acceptance | Reviewed release and human inputs | Observed receipts and exposure gate | Root coordinator |

The project owner David Gonzalez supplies Google inputs and implementation merge approval. Autonomous feature workers cannot execute or complete live acceptance.

## Critical path

Ports to storage to sessions to guard to protection to startup to gateway to verification to acceptance. Length: nine phases. The plan states no durations.

Verifier adapter preparation can overlap storage after ports freeze. Full session orchestration and Phase 3 clearance require Phase 2 outputs.

## Failure scenarios

| Root cause | Phase | Prevention | Early signal |
|---|---|---|---|
| Callback prerequisites blocked by exposure rules | Live acceptance | Restricted canonical HTTPS before real probes | Callback unavailable before probe execution |
| Session observation restores revoked access | Storage and sessions | Atomic insert-if-absent preserving revocation | Two-connection replay race test |
| Adapters disagree on security rules | Ports and gateway | Shared numeric policy and parser selection | Domain and synthetic edge gates |
| Workers integrate sessions before storage | Google and sessions | Explicit storage dependency | Phase clearance lacks store outputs |
| Rollback revives old credentials | Live acceptance | Ledger-preserving compatible code rollback | Revoked credential accepted after recovery |

## Alternatives

| Alternative | Critical path length | Top blast radius | Against the plan |
|---|---|---|---|
| Simplest combined auth and deployment | Three larger phases | High | Same dependent steps with fewer independent review boundaries |
| Most parallel adapter preparation | Nine clearance phases | High | Already allowed after frozen ports |
| Most conservative restricted rollout | Nine clearance phases | High | Already includes restricted acceptance and compatible rollback |

No alternative shortens the underlying dependency path while retaining every acceptance boundary. Combining phases changes labels rather than required work.

## Assumptions

- Review checks the six first-pass findings and regressions at `e65e73db`.
- All 18 authentication acceptance groups remain required. Initialization retains zero inference calls and zero auth secret reads.
- Project roles remain authoritative. Durable receipt continuity remains required across restarts.
- Existing projects retain target context without an initialization claim of conformance.
- The numerical defaults are coordinator-selected policy. They remain subject to behavioral implementation checks.
- Private infrastructure preparation remains distinct from public readiness. This approval does not authorize exposure before the recorded gates.
- Project rollout remains feature 052. OS isolation remains a separate residual trust boundary.
- The gateway has a separately verified artifact. The existing runner archive need not implicitly contain it.
- Only this assessment changed during review. No tests or external operations ran.
