# Reference Architecture: Hexagonal-Functional & Hosted Auth (`ADR-011`, `ADR-013`, `ADR-014`)

> *Sources:* [`.gwrk/architecture.md`](https://github.com/gforge-esc/gwrk/blob/develop/.gwrk/architecture.md), [`docs/decisions/ADR-011-hexagonal-and-agent-port.md`](https://github.com/gforge-esc/gwrk/blob/develop/docs/decisions/ADR-011-hexagonal-and-agent-port.md), [`docs/decisions/ADR-013-desired-architecture.md`](https://github.com/gforge-esc/gwrk/blob/develop/docs/decisions/ADR-013-desired-architecture.md), and [`docs/decisions/ADR-014-hosted-production-auth.md`](https://github.com/gforge-esc/gwrk/blob/develop/docs/decisions/ADR-014-hosted-production-auth.md).

## 1. Hexagonal-Functional Target Rules (`.gwrk/architecture.md` & `ADR-013`)

- **Rule 2.1:** Domain policy MUST depend inward. Ports declare boundaries. Adapters implement effects. Composition wires dependencies.
- **Rule 2.2:** Domain code MUST NOT access external state. Isolate filesystem and network effects in adapters. Pass environment and clock values as inputs.
- **Rule 2.3:** Core operations MUST return explicit results without hidden mutable state. Equal inputs produce equal outputs. Test domain laws.
- **Rule 2.4:** Functions MUST separate policy from effects. Use one domain term per concept. Identify duplicate work and explicit error paths.
- **Rule 2.5:** Implementation MUST follow observed RED tests with GREEN execution evidence. Passing checks do not erase uncovered design defects.

## 2. Four-Layer Hexagonal Package Structure (`ADR-011 §2.1`)

1. `src/domain/`: Pure domain types, parsers, and solvers with zero imports from `application`, `ports`, `adapters`, `node:fs`, `node:child_process`, or `better-sqlite3`.
2. `src/ports/`: Inbound and outbound port interfaces (`AgentPort`, `ToolchainPort`, `NotificationPort`, repository ports) importing only from `src/domain/`.
3. `src/application/`: Orchestrators and use-case services importing only from `src/domain/` and `src/ports/`.
4. `src/adapters/`: Infrastructure implementations (`cli`, `server`, `sqlite`, `git`, `agents`, `plugins`, `toolchain`) implementing `src/ports/`.

## 3. Hosted Production Authentication Architecture (`ADR-014 §2.2`)

> **Decision (`ADR-014`):** Authenticate hosted browsers through origin-verified Google OpenID Connect (OIDC) ID tokens with digest-only sessions and authenticate automation through finite-expiry opaque API credentials bound to existing role bindings.
>
> **Constraint (`ADR-014`):** Hosted HTTP origins MUST verify Google ID tokens or opaque API credential verifiers before executing operational handlers, and MUST NOT trust public identity headers, store raw credentials or Google tokens, or grant roles automatically on login.

| Interface | Responsibility | Adapter boundary |
|---|---|---|
| `GoogleIdentityVerifierPort` | Verify RS256 Google ID tokens via JWKS and live allowlist | `src/adapters/auth/google-id-token.ts` |
| `CredentialCryptoPort` | Generate 32-byte secrets and compare SHA-256 verifiers in constant time | `src/adapters/auth/credential-crypto.ts` |
| `AuthStorePort` | Persist API credential verifiers, session digests and audit events | `src/adapters/sqlite/auth-store.ts` |
| `CredentialGrantAdminPort` | Atomically create or rotate credentials with role bindings | `src/adapters/sqlite/auth-store.ts` |
| `BrowserCsrfPort` | Issue and verify session-bound browser CSRF tokens | `src/adapters/auth/browser-csrf.ts` |
| `ProxySessionLogoutPort` | Clear proxy cookies after origin digest revocation | `src/adapters/auth/proxy-logout.ts` |
| `HttpClientCredentialPort` | Attach origin-bound HTTPS credentials on remote CLI probes | `src/adapters/auth/http-client-credential.ts` |

## 4. Operational SQLite State & Fail-Closed Guarantees (`ADR-014 §2.3–2.4`)

- **Digest-Only Persistence:** Operational authentication tables (`api_credentials`, `google_sessions` and `auth_audit_events`) persist SHA-256 verifiers and token digests only. They store zero raw API credentials and zero raw Google tokens.
- **Closed Route Policy:** Every hosted route declares its policy in a closed table (`src/domain/auth-policy.ts`). Unclassified routes return HTTP 404 and disallowed methods return HTTP 405.
- **Origin-First Logout:** Public `/oauth2/sign_out` is denied so browser logout revokes the origin session digest before clearing proxy cookies.
- **Browser Mutation CSRF:** Browser mutations require a matching same-origin `Origin` header and a header-only Cross-Site Request Forgery (CSRF) token bound to the verified Google session digest.
