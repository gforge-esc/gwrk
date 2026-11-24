# Google verifier adapter review

GO for adapter preparation commit `abc609a2fdd27c48326671c329f8b4f46de91e9b`. No blocking findings. Blocked: none within this review scope.

## Scope

Review covers the Google verifier adapter and its tests. It also covers the exact `jose` dependency pin and lockfile. The frozen authentication port remains unchanged. Session handling and application composition belong to later phases.

| File | Layer or port | Bounded context | Status |
|---|---|---|---|
| `src/adapters/auth/google-id-token.ts` | Driven adapter | Hosted authentication | PASS |
| `src/adapters/auth/google-id-token.test.ts` | Adapter behavioral tests | Hosted authentication | PASS |
| `package.json` | Runtime dependency pin | Infrastructure | PASS |
| `pnpm-lock.yaml` | Dependency integrity | Infrastructure | PASS |

## Evidence

| Check | Result | Review action |
|---|---|---|
| Source hashes | PASS: all four match manifest | Recomputed SHA256 |
| Build receipt | PASS | Read final build log |
| Lint receipt | PASS: 461 files | Read final lint log |
| Final related tests | PASS: 85 tests across three files | Read final focused log |
| Adapter tests | PASS: 36 cases within final run | Inspected assertions |
| Linux Node 20 smoke | PASS: signed-token cases | Read isolated runtime receipt |
| Linux Node 22 smoke | PASS: signed-token cases | Read isolated runtime receipt |
| Frozen verifier port | PASS: unchanged | Compared commit with parent |

Receipts reside in `.runs/google-verifier-prep/` in the candidate worktree. Its manifest records the source hashes and runtime limits. This review adds no repeated baseline run. The Linux receipts cover signed-token smoke checks rather than the full suite.

## Boundaries

Cryptography and transport remain in the adapter. Its imports point inward to domain policy and the verifier port. The exact `jose` version is `6.2.18` with lockfile integrity. Inspection of that installed version confirms shared pending fetches and finite key-cache age. Unknown keys use the configured refresh cooldown.

Transport uses the fixed approved Google key URL. Request input cannot select another URL. Fetching disables redirect following. The adapter enforces a deadline across headers and streamed body consumption. It counts received bytes independently of Content-Length. It limits key count before handing the set to JOSE. Rejected bodies are cancelled. A late response after timeout receives cancellation too.

JOSE verifies the signature with RS256 only. It requires issuer and audience plus subject and timestamps. Expiry has zero clock tolerance. Domain policy adds the approved future-issued-at bound. It checks verified email against the current allowlist after signature verification. The returned principal uses canonical issuer and stable subject. The token digest hashes the original verified token.

Errors return fixed messages and declared result codes. Upstream errors and token values never enter those results. Import and construction perform no allowlist read or transport request. They create no authenticated principal.

## Blocking findings

None. No gate coverage hole establishes a blocking defect.

## Nonblocking notes

A dedicated late-response cancellation test would extend the existing stalled-transport coverage. Source inspection confirms that cleanup branch. This does not block the adapter preparation.

## Limits

This verdict covers synthetic verification and the frozen adapter boundary. It does not claim live Google authentication or hosted startup readiness. No candidate file changed during review. No cloud operation or live authentication occurred.
