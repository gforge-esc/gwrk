# Browser CSRF boundary

Use the maintained public token engine behind the value port. Blocked: none for this interface. Actual adapter and HTTP integration gates remain open.

## Libraries

Pin `@fastify/csrf` to `8.1.1` and `@fastify/cookie` to `11.1.0`. Lock its `cookie` dependency to the resolved `1.0.2`. The selected serializer uses the declared Node 20 compatibility path. Actual Node 20 and 22 checks remain required.

The engine exposes public secret generation and token creation plus verification. Use its API directly. Configure `userInfo: true` and the protected startup HMAC key. The verified session digest supplies userInfo. The HTTP plugin keeps its engine private behind request and reply methods. [Public engine API](https://github.com/fastify/csrf), [HTTP plugin source](https://github.com/fastify/csrf-protection/blob/main/index.js).

## Issuance

`BrowserCsrfPort.issueToken` requires `sessionDigest` and `expiresAt`. Application orchestration supplies the capped deadline from current verified context. The adapter receives an injected clock. Reject invalid or expired deadlines. Recheck the deadline after any awaited secret generation.

Serialize `__Host-gwrk_csrf` with Secure and HttpOnly. Use Path=/ with no Domain. Keep SameSite=Lax. Set absolute Expires at or before the supplied deadline. Omit issuance Max-Age. Return the header token separately from the HttpOnly cookie secret.

## Verification

Verify the cookie secret and header token through the library with the verified session digest. Wrong-session replay and malformed inputs deny access. The origin guard owns same-origin checks and accepts only `x-gwrk-csrf-token`. It rejects query tokens. Missing verification dependencies deny Google mutations.

Clearing returns an expired host-only cookie with the same security attributes. It does not undo origin session revocation.

## Evidence

The independently reviewed proposal checked public package APIs and version compatibility. Current published advisory queries found no matching advisory for the selected versions. That observation is time-limited. Preserve the lockfile and runtime evidence. [Independent review](../evidence/csrf-boundary-review.md).
