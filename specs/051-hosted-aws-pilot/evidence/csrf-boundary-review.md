# Browser CSRF boundary amendment review

GO for the minimal port and package amendment. Blocked: none for freezing the design. Adapter implementation and Node 20 and 22 runtime gates remain outstanding.

Add required `expiresAt: string` to `BrowserCsrfPort.issueToken`. Supply the current capped VerifiedAuthContext deadline. Keep verification and clearing signatures unchanged. The adapter must not query session storage. Update the port copy and architecture assertions plus the plan's package description together.

Use exact `@fastify/csrf` 8.1.1 with exact `@fastify/cookie` 11.1.0. Lock its resolved `cookie` 1.0.2 dependency. This is a reviewed compatibility pin rather than a claim that an older patch is current.

## Public APIs

The token engine publicly exposes secret generation and create plus verify. Its typed userInfo mode requires the session binding on both calls. Configure `userInfo: true` and the protected startup HMAC key. Pass the verified session digest as userInfo. The engine accepts a Buffer HMAC key. Reject missing or malformed protected key material before use. [Pinned engine documentation](https://github.com/fastify/csrf/blob/v8.1.1/README.md). [Pinned types](https://github.com/fastify/csrf/blob/v8.1.1/types/index.d.ts).

The HTTP CSRF plugin uses the same engine and requires HMAC binding for its cookie-backed userInfo mode. Calling the engine's public methods preserves that mechanism behind the value port. It avoids synthetic HTTP objects and private plugin access. The historical predictable-userInfo advisory makes the protected HMAC mandatory. [Pinned plugin](https://github.com/fastify/csrf-protection/blob/v8.0.2/index.js). [Maintainer advisory](https://github.com/fastify/csrf-protection/security/advisories/GHSA-qrgf-9gpc-vrxw).

Cookie 11.1.0 publicly exports standalone serialize and parse. No plugin registration is necessary for this serializer. Use the fixed cookie name with Secure and HttpOnly plus root Path. Omit Domain. Preserve the approved SameSite policy. [Pinned export implementation](https://github.com/fastify/fastify-cookie/blob/v11.1.0/index.js#L191).

## Runtime and published security checks

The selected wrapper depends on cookie 1.x. Registry metadata gives cookie 1.0.2 a Node >=18 requirement. Cookie 2.0.2 requires Node >=22. Later wrapper patches move to cookie 2 and change its initialization and encoding interface. Pinning the earlier public serializer avoids silently dropping Node 20 compatibility. Actual runtime tests must verify the resolved dependency tree. [Selected wrapper metadata](https://registry.npmjs.org/@fastify/cookie/11.1.0). [Cookie 1 metadata](https://registry.npmjs.org/cookie/1.0.2). [Cookie 2 metadata](https://registry.npmjs.org/cookie/2.0.2).

The current GitHub advisory API returned no published matches for the selected versions or fastify-plugin 6.0.0. The cookie repository's published name and path validation advisory affects versions below 0.7.0. Cookie 1.0.2 lies outside that range. Empty advisory results do not prove absence of undisclosed defects. [Cookie advisory](https://github.com/jshttp/cookie/security/advisories/GHSA-pxg6-pf52-xh8x). [Public advisory query](https://api.github.com/advisories?ecosystem=npm&affects=cookie%401.0.2).

Later wrapper changes include an onSend registration fix and cookie 2 import and encoding changes. The standalone serializer uses neither HTTP onSend registration nor the newer cookie 2 bridge. No published security fix requiring rejection of the proposed pin emerged from this review. [Maintainer releases](https://github.com/fastify/fastify-cookie/releases).

## Expiry and enforcement

Issuance rejects missing or expired deadlines. Serialize absolute Expires no later than the verified deadline. Omit Max-Age. If secret generation awaits, check the deadline again before returning the cookie. Cookie expiry formatting must never round past the supplied deadline.

Verification remains bound to the authenticated session digest. The guard must authenticate session lifecycle before checking CSRF. A replayed expired cookie cannot establish a live session. Keep same-origin and dedicated-header enforcement in the HTTP boundary. Missing HMAC configuration and bounded malformed values fail closed.

Importing the adapter must perform no auth file or network reads. The startup action supplies protected key material. Initialization remains inference-free and secret-free.

## Required implementation evidence

Observe RED for wrong-session replay and tampering. Cover missing protected configuration and bounded malformed values. Inspect serialized flags and absolute expiry for short remaining sessions. Cover expiration during awaited generation. Check clearing and import purity. Run public-library token and cookie serialization smokes on both promised Node runtimes.

This review changed no source or dependency. It performed no installation or live authentication. The adjacent advisory record preserves the checked versions and reported ranges.
