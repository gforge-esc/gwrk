# Hosted security policy

Freeze these defaults before independent adapter implementation. The coordinator selected them for the private pilot. Blocked: none for policy definition. Live access still requires the acceptance gates.

## Limits

| Policy | Default | Allowed range |
|---|---|---|
| Browser session cap | 3600 seconds | 60 to 3600 seconds |
| Future issued-at tolerance | 60 seconds | 0 to 60 seconds |
| API credential lifetime maximum | 30 days | 1 second to 30 days |
| JWKS request timeout | 5 seconds | 1 to 5 seconds |
| JWKS cache age | 600 seconds | 1 to 600 seconds |
| JWKS cache key count | 100 keys | 1 to 100 keys |
| JWKS response size | 65536 bytes | 1024 to 65536 bytes |
| Unknown-key refresh cooldown | 30 seconds | 1 to 60 seconds |
| Proxy logout timeout | 5 seconds | 1 to 5 seconds |
| Remote CLI timeout | 10 seconds | 1 to 10 seconds |
| Gateway login admission timeout | 30 seconds | Fixed for pinned ForwardAuth |
| Gateway login admission response body | 4096 bytes | Fixed pilot bound |
| Credential-bearing redirects | Zero | Zero |
| HTTP header size | 16384 bytes | 1024 to 16384 bytes |
| HTTP body size | 1048576 bytes | 1024 to 1048576 bytes |
| Opaque API credential size | 256 bytes | 128 to 256 bytes |
| Google ID token size | 8192 bytes | 1024 to 8192 bytes |
| Successful login origin checks per trusted client IP | 60 per minute | 1 to 60 per minute |
| Unauthenticated API attempts per trusted client IP | 60 per minute | 1 to 60 per minute |
| API requests per verified credential | 120 per minute | 1 to 120 per minute |
| Rate-limit bucket count | 1000 entries | 1 to 1000 entries |
| Idle bucket retention | 120 seconds | 1 to 120 seconds |

Login accounting follows [login-admission-boundary.md](login-admission-boundary.md). Retries can consume extra origin-check allowance and reduce useful logins. They never refund or expand the quota. Bound admissions by the counter generation, not arbitrary downstream completion timestamps. Keep API reservation finalization unchanged.

Expiry is strict. No tolerance extends Google token expiry or API key expiry. The issued-at tolerance applies only to future issuance. The session cap is the earlier of its original deadline and the verified token expiry. Observing the session again never extends that cap.

JWT signing permits RS256 for the approved Google issuer and client audience. Production key URLs come from the approved issuer configuration. Tokens cannot supply a key URL. Verifier fetches must not follow redirects. Unknown keys receive only a bounded refresh. Missing or unavailable verification fails closed.

API credentials require an explicit future expiry within the maximum lifetime. No permanent key is permitted. Gateway and origin cookies remain host-only and secure with HttpOnly protection. The CSRF cookie cannot outlive its verified session. Revocation persists until the token can no longer authenticate.

## Credential selection

Provider webhooks use their independent signature chain. They never substitute an API key for the required provider signature.

For other routes, caller Authorization selects API parsing before browser forwarding. A gwrk browser session cookie combined with caller Authorization is a credential conflict. Return JSON denial without fallback. Unrelated cookies do not count as a second credential.

Without caller Authorization, the browser chain may supply the proxy's signed Google ID token. The origin still verifies it. Public identity and auth-mode headers never establish a principal. Missing sessions on API routes produce JSON errors. Only the browser entry and login routes may redirect to Google.

Test valid and invalid API keys with absent and present browser cookies. Test forged public headers and a missing session. Assert zero accepted work on every denial.

## Ownership

Pure domain policy defines and validates the limits. Application orchestration receives policy and time as inputs. Infrastructure adapters apply network and cryptographic limits. Only trusted deployment configuration may select stricter values within these ranges. Request content cannot change them.

This policy does not qualify a model or ratify a Proposed architecture decision. It does not authorize a public listener before live acceptance.
