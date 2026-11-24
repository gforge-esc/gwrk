# Hosted origin guard review

NO-GO for guard preparation `921fb0da7dcedc05cc1feac008d3c1231946e128`. Blocked: one HTTP denial mapping violates the approved account policy contract. The guard author owns the repair.

## Blocking finding

WHERE: `src/server/auth-guard.ts` lines 157 to 161. The authenticator denial branch maps every available dependency result to HTTP 401.

EXPECTED: Feature 051 specification FR-002 requires HTTP 403 for `AUTH_ACCOUNT_DENIED`. The error table covers unverified email and unlisted accounts plus empty allowlists.

ACTUAL: A real Fastify injection returns HTTP 401 for that typed application denial. The response retains the expected code and request ID. The operational handler remains uncalled. The regression records one failed test with expected 403 and received 401.

FIX: Map `AUTH_ACCOUNT_DENIED` to HTTP 403. Retain HTTP 401 for invalid credentials and HTTP 503 for unavailable dependencies. Add the preserved behavioral regression to the candidate before repair.

The adjacent `regression.patch` adds a focused test without changing production code. The executable private copy changes only the domain import path to the same frozen policy. The candidate source remains untouched. `actual-red.log` records the verified failure.

## Other reviewed behavior

The guard awaits cryptographic authentication before operational handlers. Parser hints cannot create identity. Absent hints select API parsing. The webhook hint cannot exempt protected routes. Invalid keys and forged Google signatures remain denied.

Verified context has server-owned WeakMap provenance and a frozen decoration. Public and private liveness routes establish no principal. Browser writes require the pure origin policy and session-bound CSRF verification. Missing dependencies deny writes. Unknown paths and methods fail closed.

The existing 41 guard tests and recorded 198 related passing cases do not cover this account denial mapping. They remain useful evidence for the other preparation requirements. No broader baseline reran.

Nonblocking notes: none. Actual SQLite authentication storage and route composition remain future Phase 4 obligations.
