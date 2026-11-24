# Requirements Checklist: 051-hosted-aws-pilot

Verify `specs/051-hosted-aws-pilot/spec.md` has complete traceability and zero orphans before implementation. Blocked: none.

> Created: 2026-11-23
> Feature: [spec.md](../spec.md)
> Authoritative contract: [production-auth.md](../contracts/production-auth.md)

## User Stories

- [ ] US-001 Browser Google login and origin token verification (P0)
- [ ] US-002 Browser session revocation and mutation protection (P0)
- [ ] US-003 Opaque project-scoped API credentials and atomic rotation (P0)
- [ ] US-004 Local private-host key administration CLI (P0)
- [ ] US-005 Fail-closed hosted startup and async verification and no-inference init (P0)
- [ ] US-006 Default-deny route policy and scoped health and webhook preservation (P0)
- [ ] US-007 Separate edge gateway chains and proof regression preservation (P0)
- [ ] US-008 Bounded denials and rate limits and canary log redaction (P0)
- [ ] US-009 Origin-bound CLI credentials for remote probes (P1)
- [ ] US-010 Systemd runner and backup restore and durable restart continuity (P0)
- [ ] US-011 Staged rollout gates and pending operator input boundaries (P1)

## Functional Requirements

- [ ] FR-001 Google OIDC proxy with PKCE S256 and checked state and `insecure_oidc_skip_nonce = false` (US-001 and US-007)
- [ ] FR-002 Origin Google ID token verification via pinned `jose` and `google_sub` mapping (US-001)
- [ ] FR-003 Digest-only browser session tracking and origin-first logout before `/oauth2/sign_out` (US-002)
- [ ] FR-004 Opaque `gwrk_v1.<credential-id>.<base64url-secret>` credentials with SHA-256 verifiers and origin audience (US-003)
- [ ] FR-005 Atomic SQLite transactions for credential creation and role grants and rotation (US-003)
- [ ] FR-006 Local `gwrk auth key` CLI with `0600` non-checkout secret file and ADR-004 signals (US-004)
- [ ] FR-007 Async auth pre-handler attaching `VerifiedAuthContext` read by synchronous `resolvePrincipal` (US-005)
- [ ] FR-008 Production auth factory in `server start --foreground` and `server _run` with no-inference init guard (US-005)
- [ ] FR-009 Same-origin `Origin` check and session-bound `@fastify/csrf-protection` header check (US-002)
- [ ] FR-010 Default-deny 14-route policy table and filtered `GET /api/health` and private `GET /health` (US-006)
- [ ] FR-011 Configured raw-body HMAC and durable replay conflict checks on `POST /webhook/github` (US-006)
- [ ] FR-012 Separate browser and API and webhook gateway chains with untouched `041` proof regression (US-007)
- [ ] FR-013 Sanitized logging and canary secret redaction and finite rate limits and public-ID audit records (US-008)
- [ ] FR-014 Origin-bound HTTPS `HttpClientCredentialPort` for `gwrk status` and `gwrk server status` (US-009)
- [ ] FR-015 Frozen hexagonal auth ports in `src/ports/` and pure domain policy and Proposed auth ADR (US-001 and US-003 and US-005)
- [ ] FR-016 Integration with `deploy/linux-runner/` systemd unit and `preflight.sh` and worker secret isolation (US-010)
- [ ] FR-017 Compatibility with `gwrk db backup` and `gwrk db restore` and `gwrk db rollback-check` (US-010)
- [ ] FR-018 Five-phase private-host rollout gates and pending Google inputs and `052` boundary (US-011)

## Testing Requirements

- [ ] TR-001 through TR-018 map 1-to-1 to `AUTH-01` through `AUTH-18` with observed RED before GREEN
- [ ] TR-019 checks no-inference `gwrk init` and import-time secret isolation
- [ ] TR-020 checks `ADR-011` hexagonal boundaries and ADR citation checks
- [ ] TR-021 checks systemd preflight and backup restore continuity and `041` proof preservation

## Quality Gate

- [ ] Every user story has a `US-###` ID and maps to at least one FR (11 US and zero orphans)
- [ ] Every functional requirement has an `FR-###` ID and back-references at least one US (18 FR and zero orphans)
- [ ] Every FR maps to at least one TR in the coverage matrix (21 TR and zero orphans)
- [ ] Every acceptance scenario `then` clause has an executable shell assertion command
- [ ] Every FR with failure modes includes an error states table
- [ ] All 18 contract acceptance groups (`AUTH-01` through `AUTH-18`) appear with behavioral assertions
- [ ] Agent-native classification and exit codes and `--format json` are specified for `gwrk auth key`
- [ ] Existing Decided ADRs (`ADR-001` through `ADR-012`) stay preserved while `ADR-013` stays Proposed
- [ ] Pending operator inputs and private host posture and `052` rollout and worker isolation are explicit boundaries
- [ ] Plan and contract and production files remain untouched
