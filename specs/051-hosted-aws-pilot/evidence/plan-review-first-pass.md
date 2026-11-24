# Stress test: hosted AWS pilot implementation

REVISE. The live acceptance sequence blocks the DNS needed for its Google callback. Blocked: task generation until the coordinator fixes ordering and frozen contract ambiguities.

Review source is implementation plan `dd75666a`. This assessment replaces the earlier deployment-only assessment. The separate deployment assessment remains in [deployment-plan-stress-test.md](../deployment-plan-stress-test.md).

## Required changes

1. Permit restricted live acceptance before worldwide ingress. Phase 9 live acceptance. Owner: root coordinator. [Plan lines 30 and 562](https://github.com/gforge-esc/gwrk/blob/dd75666a/specs/051-hosted-aws-pilot/plan.md#L30) keep DNS closed until all live checks pass. Real `https://gwrk.gforge.ai/oauth2/callback` requires canonical DNS and trusted TLS first. After Phase 8 gates, install the reviewed release privately. Then configure canonical DNS and TLS with HTTPS ingress restricted to the operator address. Keep worldwide ingress closed. Run real Google and API checks through that restricted path. Open worldwide HTTPS only after recorded acceptance. Close restricted ingress on failure. Update the matching deployment and contract gate wording together.
2. Preserve root coordinator authority while blocking autonomous workers. Phase 9 live acceptance. Owner: coordinator. [Plan line 562](https://github.com/gforge-esc/gwrk/blob/dd75666a/specs/051-hosted-aws-pilot/plan.md#L562) assigns root ownership and forbids every agent from executing the phase. Root is an agent coordinator. Permit explicitly authorized coordinator operations and observed receipts. Forbid worker execution and synthetic receipts claiming live acceptance. Keep Google policy acceptance and allowlist selection human-owned. Keep final merge approval human-owned.
3. Specify atomic session observation before freezing ports. Phases 1 ports and 2 storage. Owner: coordinator. [AuthStorePort lines 106 to 118](https://github.com/gforge-esc/gwrk/blob/dd75666a/specs/051-hosted-aws-pilot/plan.md#L106) separates record and revoke without defining conflict behavior. Require insert-if-absent observation that preserves an existing revocation marker and original cap. Reading an existing session must never extend its deadline. Reject mismatched principal or expiry metadata for an existing digest. Revocation must commit before proxy logout. Add real SQLite interleaving tests for observation racing revocation. A replay beginning after revocation commits must remain denied after reopen. This clarifies the existing logout requirement without adding cancellation of accepted work.
4. Freeze parser selection and numeric policies with Phase 1 ports. Owner: coordinator. [Gateway chains](https://github.com/gforge-esc/gwrk/blob/dd75666a/specs/051-hosted-aws-pilot/plan.md#L475) omit a discriminator for browser and opaque bearer requests sharing `/api/*`. State that an Authorization header selects the API chain before browser forwarding. Invalid bearer input must reach an API denial without cookie fallback. Reject a bearer combined with a browser session credential. Strip caller auth-mode headers before setting internal metadata. For browser requests without caller Authorization, get the signed proxy ID token. Preserve provider webhooks on their separate HMAC path. Test valid and invalid bearer requests with cookies at the real synthetic edge. Define finite defaults and validation ranges in one policy record. Later adapters must consume that record.
5. Correct the dependency graph. Phase 3 Google and sessions. Owner: coordinator. [Phase 3 prose](https://github.com/gforge-esc/gwrk/blob/dd75666a/specs/051-hosted-aws-pilot/plan.md#L314) correctly requires composition after Phase 2 storage. The graph at lines 15 to 23 omits that edge. Add Phase 2 to Phase 3. Keep independent Google verifier preparation available after Phase 1. Full Phase 3 clearance needs the store and crypto implementations.
6. State live installation and rollback actions. Phase 9 live acceptance. Owner: root coordinator. The deployment reference supplies ingress closure and release rollback. The implementation phase must explicitly order installation before real probes. Preserve the auth ledger on rollback. Never restore an older database merely to downgrade code because it can resurrect revoked credentials. Respect `rollback-check` migration compatibility. If a compatible rollback is unavailable, stop the service and keep ingress closed. Keep backup restoration testing isolated from the authoritative live ledger.

Suggested bounded defaults belong in Phase 1 for coordinator review. They are recommendations rather than previously approved settings.

| Policy | Proposed default | Required denial |
|---|---|---|
| Browser session | One hour or token expiry, whichever comes first | Expired session |
| JWT clock skew | 60 seconds | Future issued-at beyond skew |
| API lifetime maximum | 90 days | Missing or excessive expiry |
| JWKS request | Five seconds | Unavailable verifier |
| JWKS cache | Ten minutes with 100 cached keys | Unknown key after bounded refresh |
| Proxy logout | Five seconds | Committed revocation retained |
| Remote CLI request | Ten seconds without redirects | Timeout or redirect |
| Request bounds | 16 KiB headers and 1 MiB body | HTTP 431 or 413 |
| Anonymous login attempts | 60 per minute per trusted client IP | HTTP 429 |
| Authenticated API requests | 120 per minute per credential ID | HTTP 429 |

## Dependencies

| Phase | Depends on | Blast radius | Rollback |
|---|---|---|---|
| 1 Ports and policy | Approved specification | Low | None stated |
| 2 API credentials and CLI | Phase 1 frozen ports | Medium | None stated for implementation |
| 3 Google and sessions | Phase 1 and Phase 2 storage, stated in prose | Medium | None stated |
| 4 Origin guard and health | Phases 2 and 3 | Medium | None stated |
| 5 CSRF and bounds | Phase 4 | Medium | None stated |
| 6 Startup and CLI probes | Phase 5 | Medium | None stated |
| 7 Gateway and runner | Phase 6 | Medium | Private installation rollback in deployment reference |
| 8 Combined verification | Phase 7 | Low | None stated for isolated fixtures |
| 9 Live acceptance | Phase 8 and Google inputs | High | Close ingress and restore compatible release in deployment reference |

The coordinator owns code and synthetic phases. Root owns host operations. The project owner David Gonzalez supplies Google inputs and merge approval.

| Phase | Inputs | Outputs | Owner as written |
|---|---|---|---|
| 1 Ports and policy | Specification and contract | Ports and pure policy plus Proposed architecture decision | Coordinator |
| 2 API credentials and CLI | Frozen ports | Auth storage and local administration | Coordinator |
| 3 Google and sessions | Ports plus store and crypto | Verifier and session orchestration | Coordinator |
| 4 Origin guard and health | Store and verifier | Verified HTTP context and filtered health | Coordinator |
| 5 CSRF and bounds | Guarded server | Mutation protection and secret-safe limits | Coordinator |
| 6 Startup and CLI probes | Protected server | Hosted factory and scoped client probes | Coordinator |
| 7 Gateway and runner | Working loopback origin | Synthetic edge and runner preflight | Coordinator |
| 8 Combined verification | Complete synthetic stack | Native proof and operator handoff | Coordinator |
| 9 Live acceptance | Reviewed release and human inputs | Observed live receipts and exposure gate | Root and project owner |

## Critical path

Ports to storage to sessions to guard to protection to startup to gateway to verification to acceptance. Length: nine phases. The plan states no durations.

The graph currently suggests eight phases by allowing full Google session work alongside storage. Only verifier adapter preparation can use that parallel path.

## Failure scenarios

| Root cause | Phase | Prevention | Early signal |
|---|---|---|---|
| Callback prerequisites blocked by exposure wording | Live acceptance | Restricted DNS and HTTPS before probes | Canonical callback unreachable |
| Session observation restores revoked access | Storage and sessions | Insert-if-absent with preserved revocation | SQLite replay race test |
| Independent adapters select incompatible security rules | Ports and gateway | Frozen defaults and parser selection | Shared policy and edge matrix |
| Workers bypass storage clearance | Google and sessions | Explicit store dependency | Phase gate missing store adapter |
| Rollback revives old credentials | Live acceptance | Compatible code rollback with retained ledger | Revoked credential accepted after restore |

## Alternatives

| Alternative | Critical path length | Top blast radius | Against the plan |
|---|---|---|---|
| Simplest combined auth and deployment | Three combined phases | High | Same dependent steps with fewer review boundaries |
| Most parallel adapter preparation | Nine clearance phases | High | Same path with overlapping verifier preparation |
| Most conservative restricted rollout | Nine clearance phases | High | Same path with restricted exposure and retained ledger |

No alternative removes a genuine implementation dependency. The corrected parallel preparation retains the existing single-writer integration model.

## Assumptions

- Review covers the implementation plan at `dd75666a` and its named architecture and deployment references.
- The specification review GO at `7c55c385` remains valid. All 18 authentication test groups remain required.
- Private infrastructure audit GO covers private preparation only. No application is running yet.
- Root coordinates authorized operations. Autonomous feature workers receive no cloud or Google configuration authority.
- Project rollout remains feature 052. Synthetic enrolled fixtures do not enroll live work projects.
- OS isolation remains a separate residual risk. This review adds no untrusted multi-tenant isolation claim.
- The existing native runner release and rollback interfaces remain approved. No live credential or cloud change occurred during this review.
- The plan states no durations. Phase counts measure dependencies rather than elapsed time.

Nonblocking note: document how the production gateway bundle reaches the host. The existing runner package lists only `deploy/linux-runner/` files. Either use a separately verified gateway artifact or extend packaging explicitly. The current boundaries are `package.json` lines 8 to 18 and `install-release.sh` lines 61 to 70.
