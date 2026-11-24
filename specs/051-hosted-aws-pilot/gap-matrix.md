# Gap Matrix: 051 Hosted AWS Pilot (Phases 1 to 5)

Coverage matrix mapping Phases 1 through 5 requirements of `051-hosted-aws-pilot` to behavioral unit and integration tests.

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|---|---|---|---|---|---|
| FR-002 | Google ID token issuer normalization, RS256 algorithm, skew, and allowlist policy | unit | src/domain/auth-policy.test.ts | ✅ | |
| FR-002 | Origin Google ID token cryptographic verification via pinned jose, bounded JWKS cache, live allowlist reload, and google_sub mapping | integration | src/adapters/auth/google-id-token.test.ts | ✅ | |
| FR-002 | Hosted auth guard maps AUTH_ACCOUNT_DENIED to HTTP 403 without operational effects | integration | src/server/auth-guard.account-denial.test.ts | ✅ | |
| FR-003 | Browser session 1-hour cap, non-extending cap, and digest revocation lifecycle | unit | src/domain/auth-policy.test.ts | ✅ | |
| FR-003 | Digest-only Google session SQLite persistence, insert-if-absent cap retention, and controlled independent-writer contention and persisted revocation | integration | src/adapters/sqlite/auth-store.test.ts | ✅ | |
| FR-003 | Fixed-target internal proxy logout adapter with bounded timeout and separate cookie-clearing headers | integration | src/adapters/auth/proxy-logout.test.ts | ✅ | |
| FR-003 | Application session read and origin-first digest revocation before proxy sign-out | unit | src/application/auth/authenticate-request.test.ts | ✅ | |
| FR-003 | Hosted GET /, GET and HEAD /api/auth/session, POST /api/auth/logout origin-first revocation, HTTP 503 on proxy logout failure, separate Set-Cookie headers, and copied replay denial via startServer | integration | src/server/auth-session.test.ts | ✅ | |
| FR-004 | Opaque gwrk_v1 credential grammar, finite 30-day expiry, and lifecycle evaluation | unit | src/domain/auth-policy.test.ts | ✅ | |
| FR-004 | Opaque 32-byte gwrk_v1 credential generation, full-credential SHA-256 hashing, and constant-time verifier comparison | unit | src/adapters/auth/credential-crypto.test.ts | ✅ | |
| FR-004 | Hash-only API credential persistence, origin audience binding, and verifier-free metadata listing | integration | src/adapters/sqlite/auth-store.test.ts | ✅ | |
| FR-004 | Hosted opaque API credential HTTP 401 denials, rotation revocation, and HTTP 403 project-role enforcement via startServer | integration | src/server/auth-api-keys.test.ts | ✅ | |
| FR-005 | Atomic SQLite credential grant creation, creation and rotation rollback on injected failures, and persisted revocations | integration | src/adapters/sqlite/auth-store.test.ts | ✅ | |
| FR-006 | Local gwrk auth key create, list, revoke, and rotate CLI with 0600 non-checkout secret files and ADR-004 signals | integration | src/commands/auth.test.ts | ✅ | |
| FR-007 | Request credential selection, conflict rejection, and forbidden forged identity headers | unit | src/domain/auth-policy.test.ts | ✅ | |
| FR-007 | Application request authentication orchestration for API keys, Google tokens, session caps, and fail-closed outages | unit | src/application/auth/authenticate-request.test.ts | ✅ | |
| FR-007 | Async hosted pre-handler, WeakMap verified decoration, synchronous resolveVerifiedPrincipal, forged header denial, fail-closed missing hostedAuth, and trusted_local isolation via startServer | integration | src/server/auth-prehandler.test.ts | ✅ | |
| FR-009 | Browser mutation same-origin Origin and header-only CSRF policy | unit | src/domain/auth-policy.test.ts | ✅ | |
| FR-009 | Maintained @fastify/csrf session-digest HMAC binding, capped absolute Expires without Max-Age, strict cookie flags, and malformed input denials | unit | src/adapters/auth/browser-csrf.test.ts | ✅ | |
| FR-009 | Browser Origin and session-bound header CSRF enforcement before operation effects on hosted startServer | integration | src/server/auth-prehandler.test.ts | ✅ | |
| FR-010 | Default-deny 14-route table, HEAD parity, private /health, and disabled CORS | unit | src/domain/auth-policy.test.ts | ✅ | |
| FR-010 | Full-server default-deny unclassified routes, disallowed methods, and internal /oauth2/sign_out blocking | integration | src/server/auth-prehandler.test.ts | ✅ | |
| FR-010 | Hosted single-project filtered GET /api/health, minimal private GET /health with zero Git or provider probes, and HEAD read parity via startServer | integration | src/server/auth-api-keys.test.ts | ✅ | |
| FR-013 | Hosted security policy limits and Authorization/Cookie/Set-Cookie/OAuth URL redaction | unit | src/domain/auth-policy.test.ts | ✅ | |
| FR-013 | Public-identifier auth audit event persistence without raw secrets | integration | src/adapters/sqlite/auth-store.test.ts | ✅ | |
| FR-014 | Outbound CLI credential HTTPS and exact bound-origin enforcement | unit | src/domain/auth-policy.test.ts | ✅ | |
| FR-015 | Pure domain policy, seven frozen auth ports, and Proposed ADR-014 with clean index | unit | src/architecture.test.ts | ✅ | |
| TR-001 | AUTH-01/02/03 pure Google issuer normalization, RS256, expiry/skew, and allowlist denials | unit | src/domain/auth-policy.test.ts | ✅ | |
| TR-001 | AUTH-01 synthetic OIDC verifier rejects bad signature, wrong issuer, wrong audience, bad algorithm, and token JWKS URLs | integration | src/adapters/auth/google-id-token.test.ts | ✅ | |
| TR-002 | AUTH-02 synthetic OIDC verifier rejects expired exp and future iat while normalizing Google issuers to google_sub | integration | src/adapters/auth/google-id-token.test.ts | ✅ | |
| TR-003 | AUTH-03 synthetic OIDC verifier rejects unverified email, unlisted account, empty allowlist, and live allowlist removal | integration | src/adapters/auth/google-id-token.test.ts | ✅ | |
| TR-004 | AUTH-04 local and remote forged identity or auth-mode headers yield zero principal and zero operation rows in isolated guard and full startServer | integration | src/server/auth-prehandler.test.ts | ✅ | |
| TR-006 | AUTH-06 origin-first logout revokes digest before proxy clearing, preserves separate Set-Cookie headers, returns HTTP 503 on proxy failure, and blocks copied replay | integration | src/server/auth-session.test.ts | ✅ | |
| TR-007 | AUTH-07 pure malformed, wrong-version, oversized, wrong-origin, expired, and revoked API key denials | unit | src/domain/auth-policy.test.ts | ✅ | |
| TR-007 | CredentialCryptoPort generates gwrk_v1.<id>.<secret> and compares SHA-256 verifiers in constant time | unit | src/adapters/auth/credential-crypto.test.ts | ✅ | |
| TR-007 | AUTH-07 missing, malformed, wrong-version, oversized, wrong-origin, expired, revoked, and conflicting API keys return HTTP 401 JSON with zero effects on hosted startServer | integration | src/server/auth-api-keys.test.ts | ✅ | |
| TR-008 | AUTH-08 Project A API credential requesting Project B or exceeding granted role returns HTTP 403 JSON with zero effects on hosted startServer | integration | src/server/auth-api-keys.test.ts | ✅ | |
| TR-009 | AUTH-09 atomic grant creation, rotation rollback, persisted revocations, and controlled independent-writer session contention | integration | src/adapters/sqlite/auth-store.test.ts | ✅ | |
| TR-010 | AUTH-10 0600 exclusive non-checkout secret file, orphan revocation on delivery failure, and zero stdout secrets | integration | src/commands/auth.test.ts | ✅ | |
| TR-011 | AUTH-04/11 pure unclassified routes, cross-site Origin, query CSRF, and conflicting credentials denials | unit | src/domain/auth-policy.test.ts | ✅ | |
| TR-015 | AUTH-15 pure redaction of Authorization, Cookie, Set-Cookie, OAuth query values, and canary secrets | unit | src/domain/auth-policy.test.ts | ✅ | |
| TR-020 | Hexagonal domain purity, seven frozen ports in src/ports/auth-port.ts, and Proposed ADR-014 | unit | src/architecture.test.ts | ✅ | |
| US-001 | Browser Google login issuer normalization, synthetic OIDC verification, and zero automatic project roles | integration | src/adapters/auth/google-id-token.test.ts | ✅ | |
| US-002 | Browser session cap, revocation lifecycle, and mutation Origin/CSRF policy | unit | src/domain/auth-policy.test.ts | ✅ | |
| US-002 | Digest-only browser session storage and revocation persistence in SQLite | integration | src/adapters/sqlite/auth-store.test.ts | ✅ | |
| US-002 | Browser session CSRF issuance, HEAD parity, origin-first logout, and copied replay denial via startServer | integration | src/server/auth-session.test.ts | ✅ | |
| US-003 | Opaque scoped API credential grammar, finite expiry, and lifecycle policy | unit | src/domain/auth-policy.test.ts | ✅ | |
| US-003 | Opaque API credential crypto, atomic SQLite grants, and crash-safe rotation | integration | src/adapters/sqlite/auth-store.test.ts | ✅ | |
| US-003 | Opaque scoped API credential HTTP 401 and HTTP 403 enforcement across hosted startServer project APIs | integration | src/server/auth-api-keys.test.ts | ✅ | |
| US-004 | Local private-host gwrk auth key CLI with 0600 secret delivery and zero secret emission | integration | src/commands/auth.test.ts | ✅ | |
| US-005 | Credential selection conflict checks and forbidden forged identity header detection | unit | src/domain/auth-policy.test.ts | ✅ | |
| US-005 | Async hosted auth pre-handler, fail-closed missing auth config, and trusted_local separation via startServer | integration | src/server/auth-prehandler.test.ts | ✅ | |
| US-006 | Default-deny route policy table and HEAD parity | unit | src/domain/auth-policy.test.ts | ✅ | |
| US-006 | Hosted single-project filtered GET /api/health and minimal private GET /health via startServer | integration | src/server/auth-api-keys.test.ts | ✅ | |
| US-008 | Security policy bounds and canary log/URL redaction | unit | src/domain/auth-policy.test.ts | ✅ | |
| US-009 | Origin-bound HTTPS outbound CLI credential target policy | unit | src/domain/auth-policy.test.ts | ✅ | |
| TC-002 | Fail-closed hosted guard and startServer with zero trusted_local fallback | integration | src/server/auth-prehandler.test.ts | ✅ | |
| TC-003 | Strict TypeScript, Biome zero errors, and pinned @fastify/cookie and @fastify/csrf dependencies | unit | src/adapters/auth/browser-csrf.test.ts | ✅ | |
| TC-004 | Hexagonal boundaries isolating src/domain/auth-policy.ts and src/ports/auth-port.ts | unit | src/architecture.test.ts | ✅ | |
| TC-005 | Two-tier SQLite migration 020 operational auth tables preserve git-native task authority | integration | src/adapters/sqlite/auth-store.test.ts | ✅ | |
| TC-006 | Agent-native gwrk auth key JSON output, non-interactive flags, and ADR-004 signals | integration | src/commands/auth.test.ts | ✅ | |
| TC-008 | Constant-time SHA-256 verifiers and digest-only session persistence without raw secrets | unit | src/adapters/auth/credential-crypto.test.ts | ✅ | |
| TC-011 | ADR-014 remains Proposed until human ratification while ADR-001..ADR-012 remain Decided | unit | src/architecture.test.ts | ✅ | |
| FR-009 | Full-server browser same-origin Origin, query-only CSRF denial, wrong-session CSRF denial, and zero cookie fallback for invalid API keys via startServer | integration | src/server/auth-csrf.test.ts | ✅ | |
| FR-010 | Full-server cross-project GET /api/health denial, single-project filtering, and minimal private GET/HEAD /health with zero Git or provider probes | integration | src/server/routes/health.auth.test.ts | ✅ | |
| FR-010 | Full-server default-deny unclassified routes, disallowed methods, HEAD read parity, disabled CORS, and JSON API 401 denials without 302 redirects | integration | src/server/auth-route-policy.test.ts | ✅ | |
| FR-011 | Provider webhook missing, empty, whitespace secret and invalid HMAC rejections without API key fallback plus identical replay reuse and DELIVERY_ID_CONFLICT | integration | src/server/github.test.ts | ✅ | |
| FR-013 | Pure rate admission counter transitions, generation non-refund, and fixed 120s reservation expiry | unit | src/domain/auth-rate-policy.test.ts | ✅ | |
| FR-013 | Bounded rate admission adapter shared 1000-bucket capacity, 60-pending limit, rollover, fixed 120s expiry, IPv6 normalization, and plugin facade | integration | src/adapters/auth/rate-admission.test.ts | ✅ | |
| FR-013 | Full-server HTTP pre-verifier reservation, 120 sequential verified quotas, abort/error cleanup, capacity refusal, trusted proxy/IPv6, real loopback 431/413 parser bounds, and JWKS 503 outage | integration | src/server/auth-bounds.test.ts | ✅ | |
| FR-013 | Full-server sanitized Fastify logger stream and response body verification with zero canary secret leaks across headers, chunked cookies, separate Set-Cookie, OAuth/CSRF query params, malformed URLs, and thrown errors | integration | src/server/auth-logging.test.ts | ✅ | |
| TR-011 | AUTH-11 wrong Origin, query-only CSRF, wrong-session CSRF, and invalid API key non-fallback return HTTP 403/401 JSON with zero effects | integration | src/server/auth-csrf.test.ts | ✅ | |
| TR-012 | AUTH-12 cross-project /api/health denial, single-project filtering, and minimal private /health with zero Git or provider probes | integration | src/server/routes/health.auth.test.ts | ✅ | |
| TR-012 | FR-010 default-deny unclassified routes, unsupported methods, HEAD read parity, disabled CORS, and JSON API denials | integration | src/server/auth-route-policy.test.ts | ✅ | |
| TR-013 | AUTH-13 missing, blank, or bad webhook HMAC and changed-payload replay create zero harvest rows | integration | src/server/github.test.ts | ✅ | |
| TR-014 | Pure rate-admission counter limits and explicit generation transitions preserve quotas | unit | src/domain/auth-rate-policy.test.ts | ✅ | |
| TR-014 | Rate admission reservations, shared capacity, fixed expiry, and duplicate completion stay bounded | integration | src/adapters/auth/rate-admission.test.ts | ✅ | |
| TR-014 | AUTH-14 full-server rate limits (429), real parser header/body bounds (431/413), and JWKS outage (503) fail closed with zero accepted work | integration | src/server/auth-bounds.test.ts | ✅ | |
| TR-015 | AUTH-15 canary API keys, canonical and chunked cookies, separate Set-Cookie headers, OAuth/CSRF query params, malformed URLs, and error canaries produce zero log or response matches | integration | src/server/auth-logging.test.ts | ✅ | |
| US-002 | Full-server browser CSRF and same-origin mutation protection with session-bound tokens via startServer | integration | src/server/auth-csrf.test.ts | ✅ | |
| US-006 | Full-server default-deny route policy, scoped health, minimal private /health, and webhook HMAC preservation | integration | src/server/routes/health.auth.test.ts | ✅ | |
| US-006 | Full-server default-deny route policy, HEAD parity, disabled CORS, and JSON API 401 denials | integration | src/server/auth-route-policy.test.ts | ✅ | |
| US-006 | Provider webhook HMAC and durable DELIVERY_ID_CONFLICT preservation | integration | src/server/github.test.ts | ✅ | |
| US-008 | Full-server bounded denials, rate admission, real parser limits, and JWKS outages | integration | src/server/auth-bounds.test.ts | ✅ | |
| US-008 | Full-server sanitized Fastify logger stream with zero canary secret leaks | integration | src/server/auth-logging.test.ts | ✅ | |
