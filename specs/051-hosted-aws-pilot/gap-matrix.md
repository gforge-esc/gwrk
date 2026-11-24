# Gap Matrix: 051 Hosted AWS Pilot (Phases 1 and 2)

Coverage matrix mapping Phase 1 (`Auth ports and policy`) and Phase 2 (`API credentials and local CLI`) requirements of `051-hosted-aws-pilot` to behavioral unit and integration tests.

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|---|---|---|---|---|---|
| FR-002 | Google ID token issuer normalization, RS256 algorithm, skew, and allowlist policy | unit | src/domain/auth-policy.test.ts | ✅ | |
| FR-003 | Browser session 1-hour cap, non-extending cap, and digest revocation lifecycle | unit | src/domain/auth-policy.test.ts | ✅ | |
| FR-003 | Digest-only Google session SQLite persistence, insert-if-absent cap retention, and controlled independent-writer contention and persisted revocation | integration | src/adapters/sqlite/auth-store.test.ts | ✅ | |
| FR-004 | Opaque gwrk_v1 credential grammar, finite 30-day expiry, and lifecycle evaluation | unit | src/domain/auth-policy.test.ts | ✅ | |
| FR-004 | Opaque 32-byte gwrk_v1 credential generation, full-credential SHA-256 hashing, and constant-time verifier comparison | unit | src/adapters/auth/credential-crypto.test.ts | ✅ | |
| FR-004 | Hash-only API credential persistence, origin audience binding, and verifier-free metadata listing | integration | src/adapters/sqlite/auth-store.test.ts | ✅ | |
| FR-005 | Atomic SQLite credential grant creation, creation and rotation rollback on injected failures, and persisted revocations | integration | src/adapters/sqlite/auth-store.test.ts | ✅ | |
| FR-006 | Local gwrk auth key create, list, revoke, and rotate CLI with 0600 non-checkout secret files and ADR-004 signals | integration | src/commands/auth.test.ts | ✅ | |
| FR-007 | Request credential selection, conflict rejection, and forbidden forged identity headers | unit | src/domain/auth-policy.test.ts | ✅ | |
| FR-009 | Browser mutation same-origin Origin and header-only CSRF policy | unit | src/domain/auth-policy.test.ts | ✅ | |
| FR-010 | Default-deny 14-route table, HEAD parity, private /health, and disabled CORS | unit | src/domain/auth-policy.test.ts | ✅ | |
| FR-013 | Hosted security policy limits and Authorization/Cookie/Set-Cookie/OAuth URL redaction | unit | src/domain/auth-policy.test.ts | ✅ | |
| FR-013 | Public-identifier auth audit event persistence without raw secrets | integration | src/adapters/sqlite/auth-store.test.ts | ✅ | |
| FR-014 | Outbound CLI credential HTTPS and exact bound-origin enforcement | unit | src/domain/auth-policy.test.ts | ✅ | |
| FR-015 | Pure domain policy, seven frozen auth ports, and Proposed ADR-014 with clean index | unit | src/architecture.test.ts | ✅ | |
| TR-001 | AUTH-01/02/03 pure Google issuer normalization, RS256, expiry/skew, and allowlist denials | unit | src/domain/auth-policy.test.ts | ✅ | |
| TR-007 | AUTH-07 pure malformed, wrong-version, oversized, wrong-origin, expired, and revoked API key denials | unit | src/domain/auth-policy.test.ts | ✅ | |
| TR-007 | CredentialCryptoPort generates gwrk_v1.<id>.<secret> and compares SHA-256 verifiers in constant time | unit | src/adapters/auth/credential-crypto.test.ts | ✅ | |
| TR-009 | AUTH-09 atomic grant creation, rotation rollback, persisted revocations, and controlled independent-writer session contention | integration | src/adapters/sqlite/auth-store.test.ts | ✅ | |
| TR-010 | AUTH-10 0600 exclusive non-checkout secret file, orphan revocation on delivery failure, and zero stdout secrets | integration | src/commands/auth.test.ts | ✅ | |
| TR-011 | AUTH-04/11 pure unclassified routes, cross-site Origin, query CSRF, and conflicting credentials denials | unit | src/domain/auth-policy.test.ts | ✅ | |
| TR-015 | AUTH-15 pure redaction of Authorization, Cookie, Set-Cookie, OAuth query values, and canary secrets | unit | src/domain/auth-policy.test.ts | ✅ | |
| TR-020 | Hexagonal domain purity, seven frozen ports in src/ports/auth-port.ts, and Proposed ADR-014 | unit | src/architecture.test.ts | ✅ | |
| US-001 | Browser Google login issuer normalization and token policy checks | unit | src/domain/auth-policy.test.ts | ✅ | |
| US-002 | Browser session cap, revocation lifecycle, and mutation Origin/CSRF policy | unit | src/domain/auth-policy.test.ts | ✅ | |
| US-002 | Digest-only browser session storage and revocation persistence in SQLite | integration | src/adapters/sqlite/auth-store.test.ts | ✅ | |
| US-003 | Opaque scoped API credential grammar, finite expiry, and lifecycle policy | unit | src/domain/auth-policy.test.ts | ✅ | |
| US-003 | Opaque API credential crypto, atomic SQLite grants, and crash-safe rotation | integration | src/adapters/sqlite/auth-store.test.ts | ✅ | |
| US-004 | Local private-host gwrk auth key CLI with 0600 secret delivery and zero secret emission | integration | src/commands/auth.test.ts | ✅ | |
| US-005 | Credential selection conflict checks and forbidden forged identity header detection | unit | src/domain/auth-policy.test.ts | ✅ | |
| US-006 | Default-deny route policy table and HEAD parity | unit | src/domain/auth-policy.test.ts | ✅ | |
| US-008 | Security policy bounds and canary log/URL redaction | unit | src/domain/auth-policy.test.ts | ✅ | |
| US-009 | Origin-bound HTTPS outbound CLI credential target policy | unit | src/domain/auth-policy.test.ts | ✅ | |
| TC-004 | Hexagonal boundaries isolating src/domain/auth-policy.ts and src/ports/auth-port.ts | unit | src/architecture.test.ts | ✅ | |
| TC-005 | Two-tier SQLite migration 020 operational auth tables preserve git-native task authority | integration | src/adapters/sqlite/auth-store.test.ts | ✅ | |
| TC-006 | Agent-native gwrk auth key JSON output, non-interactive flags, and ADR-004 signals | integration | src/commands/auth.test.ts | ✅ | |
| TC-008 | Constant-time SHA-256 verifiers and digest-only session persistence without raw secrets | unit | src/adapters/auth/credential-crypto.test.ts | ✅ | |
| TC-011 | ADR-014 remains Proposed until human ratification while ADR-001..ADR-012 remain Decided | unit | src/architecture.test.ts | ✅ | |
