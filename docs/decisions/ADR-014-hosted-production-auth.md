# ADR-014: Hosted Production Authentication Architecture

> **Status:** Proposed
> **Date:** 2026-11-23
> **Decision:** Authenticate hosted browsers through origin-verified Google OpenID Connect (OIDC) ID tokens with digest-only sessions and authenticate automation through finite-expiry opaque API credentials bound to existing project role bindings.
> **Constraint:** Hosted HTTP origins MUST verify Google ID tokens or opaque API credential verifiers before executing operational handlers, and MUST NOT trust public identity headers, store raw credentials or Google tokens, or grant project roles automatically on login.
> **Depends on:** ADR-002 (SQLite Execution Ledger), ADR-003 (State Contract), ADR-010 (Decision Records), ADR-011 (Hexagonal Layering), ADR-013 (Desired Project Architecture)
> **Supersedes:**
> **Author:** Coordinator (pending project owner ratification) · **Decision Scope:** Hosted origin authentication, API credential lifecycle, browser CSRF protection, edge gateway isolation

## 1. Context

The hosted pilot at `https://gwrk.gforge.ai` runs on a private Linux host with loopback origin `127.0.0.1:18790`. Project role bindings already exist in `ProjectRegistryPort` and enforce scope through `evaluateHttpProjectAccess`. Both server entry points (`gwrk server start --foreground` and `gwrk server _run`) lack a fail-closed hosted authentication verifier. Health routes also lack project filtering.

The earlier read-only proof under `deploy/hosted-auth-proof/` strips `Authorization` and forwards empty identity headers. That proof remains a separate regression fixture and does not satisfy production API authentication or browser mutation safety.

## 2. Decision

### 2.1 Dual Authentication Mechanisms

Browser operators sign in through Google OIDC at the edge proxy. The proxy forwards a signed Google ID token to the `gwrk` origin. Automation clients present opaque API credentials formatted as `gwrk_v1.<credential-id>.<base64url-secret>`. Provider webhooks retain their independent raw-body Hash-based Message Authentication Code (HMAC) boundary.

Authentication never grants a project role. Existing `project_role_bindings` in `ProjectRegistryPort` remain the sole authority for project access across `viewer`, `operator` and `maintainer` roles.

### 2.2 Hexagonal Boundary and Frozen Ports

Pure policy in `src/domain/auth-policy.ts` owns route classification and security policy bounds. It also owns Google issuer normalization and opaque credential grammar. It handles browser mutation checks, outbound origin binding and log redaction. It performs zero external effects and imports zero infrastructure packages.

Seven boundary ports and `VerifiedAuthContext` freeze in `src/ports/auth-port.ts` with type-only domain imports.

| Interface | Responsibility | Adapter boundary |
|---|---|---|
| `GoogleIdentityVerifierPort` | Verify RS256 Google ID tokens via JWKS and live allowlist | `src/adapters/auth/google-id-token.ts` |
| `CredentialCryptoPort` | Generate 32-byte secrets and compare SHA-256 verifiers in constant time | `src/adapters/auth/credential-crypto.ts` |
| `AuthStorePort` | Persist API credential verifiers, session digests and audit events | `src/adapters/sqlite/auth-store.ts` |
| `CredentialGrantAdminPort` | Atomically create or rotate credentials with project role bindings | `src/adapters/sqlite/auth-store.ts` |
| `BrowserCsrfPort` | Issue and verify session-bound browser CSRF tokens | `src/adapters/auth/browser-csrf.ts` |
| `ProxySessionLogoutPort` | Clear proxy cookies after origin digest revocation | `src/adapters/auth/proxy-logout.ts` |
| `HttpClientCredentialPort` | Attach origin-bound HTTPS credentials on remote CLI probes | `src/adapters/auth/http-client-credential.ts` |

### 2.3 Operational SQLite State

Operational authentication tables (`api_credentials`, `google_sessions` and `auth_audit_events`) reside in `gwrk.db` alongside project role bindings and durable operations. The store persists SHA-256 verifiers and token digests only. It stores zero raw API credentials and zero raw Google tokens. Git-native task state authority under `ADR-002` and `ADR-003` stays unchanged.

### 2.4 Fail-Closed Route and Request Guarantees

Every hosted route declares its policy in a closed table. Unclassified routes return HTTP 404 and disallowed methods return HTTP 405. Public `/oauth2/sign_out` is denied so browser logout revokes the origin session digest before clearing proxy cookies. Hosted `GET /health` serves private minimal liveness only while `GET /api/health` requires an explicit authorized project.

Browser mutations require a matching same-origin `Origin` header. They also require a header-only Cross-Site Request Forgery (CSRF) token bound to the verified Google session digest. Conflicting API key and browser session credentials return HTTP 401 with zero cookie fallback. Hosted startup fails closed before listening when required verifier configuration is missing.

## 3. Decision Record

| Field | Value |
|---|---|
| Position | Dual Google OIDC origin verification plus opaque SHA-256 API credentials |
| Confidence | High for pilot scope |
| Reversibility | Amend through decision records and adapter replacement behind frozen ports |
| Risk | Untrusted-workload OS isolation remains a separate host boundary outside application auth |

## 4. Alternatives Rejected

Trusting proxy identity headers alone was rejected because any local loopback caller could forge headers without cryptographic proof.

Storing raw Google tokens or permanent API keys was rejected. Database compromise would expose reusable credentials and violate finite-lifetime rotation policy.

Adding remote HTTP key management endpoints was rejected for the first pilot. Credential administration stays inside the local private-host CLI boundary.

## 5. Impact on Existing Code

Existing Decided constraints in `ADR-001` through `ADR-012` remain unchanged. `gwrk init` retains zero inference calls and zero auth secret reads. Local `trusted_local` CLI administration stays separate from hosted HTTP transport. Human ratification under Axiom `AX-004` is required before changing status from `Proposed` to `Decided`.

## 6. Consequences

Every hosted adapter builds against frozen ports in `src/ports/auth-port.ts` and shared policy limits in `src/domain/auth-policy.ts`. Independent browser, API and webhook edge chains prevent OAuth redirects on API routes and prevent header forgery on all routes.

## 7. References

- `specs/051-hosted-aws-pilot/spec.md`
- `specs/051-hosted-aws-pilot/contracts/production-auth.md`
- `specs/051-hosted-aws-pilot/contracts/security-policy.md`
- `docs/decisions/ADR-011-hexagonal-and-agent-port.md`
- `docs/decisions/ADR-013-desired-architecture.md`

## Amendments

| Amending | At | Summary |
|---|---|---|
