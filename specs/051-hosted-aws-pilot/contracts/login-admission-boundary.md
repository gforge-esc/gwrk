# Gateway login admission boundary

Count admitted origin checks conservatively. Do not guarantee one charge per public login request. The coordinator approved this scoped policy amendment after independent architecture review. Implementation and native proof remain pending. Final pull request approval remains human-owned. Preserve the [design history](../evidence/login-admission-design-history.md).

## Accounting amendment

Every origin GET or HEAD root admission attempt passes through one synchronous consumeLogin hook. A successful check consumes one slot. No route handler charges again. Transport retries may create additional origin attempts for the same public request. Those attempts consume additional slots. Never refund them. Add no replay cache, endpoint or service.

The shared owner still permits at most 60 successful login checks in its fixed 60-second generation per normalized client IP. Direct root checks consume the same budget as proxy start and callback checks. Failed quota attempts do not grow counters. The map remains limited to 1000 combined buckets across login and API classes. Retention remains 120 seconds.

Every forwarded proxy-login request requires a distinct delivered 2xx check response. Therefore at most 60 downstream login requests can be admitted against one generation's allowance. Lost responses reduce availability. They cannot increase the allowance. Completion times can cross a window boundary. This bounds admission charges rather than downstream completion timestamps. No response cache or allow-on-error path is permitted.

API reservation ownership remains unchanged. Each API reservation still finalizes once. This amendment applies only to public login request versus origin-check accounting. Preserve the existing 120 sequential verified API requirement and conservative 60 pending API limit.

## Why response close is insufficient

Pinned ForwardAuth uses Go transport pooling for GET. A reused connection can trigger an automatic retry after a network failure. Origin Connection-close responses reduce reuse but do not establish one-time processing. [Pinned ForwardAuth](https://github.com/traefik/traefik/blob/v3.7.18/pkg/middlewares/auth/forward.go#L98).

Even a private transport clone is insufficient by itself. A completed dial can enter the idle pool when its request no longer needs it. Go marks such pooled connections reused. A later charged request can then lose its response and become retryable. The origin never saw an earlier request on that socket. Closing all earlier responses does not eliminate this path. [Go 1.27 transport, dialConnFor and tryPutIdleConn](https://github.com/golang/go/blob/go1.27.0/src/net/http/transport.go#L1599).

The current pinned ForwardAuth configuration exposes no DisableKeepAlives setting. This revision therefore accepts conservative overcharging explicitly. It makes no claim that every public request has a constant retry count. The fixed 30-second ForwardAuth deadline bounds request duration. Origin quota enforcement bounds successful checks. Cancellation may produce no delivered client status.

If exact public-request charging remains mandatory, this stock path is not yet justified. It would require an approved transport change or deduplication mechanism. Both are outside this revision. Do not hide that decision behind a response-close assertion.

## Network topology

Use native Linux host networking for pinned Traefik and OAuth2 Proxy. The origin binds only `127.0.0.1:18790`. OAuth2 Proxy binds only `127.0.0.1:4180`. Both backend URLs use literal IPv4 loopback, never localhost or a bridge hostname. Consequently gateway-to-origin and gateway-to-proxy TCP peers must be 127.0.0.1. Native capture must confirm this before acceptance.

The public TLS entry point publishes only 443. Its aliasHeadersStrategy is reject. Insecure forwarded trust is false. The upstream trusted-address list and connectionHeaders are empty. PROXY protocol remains disabled. Keep normal peer appending enabled. No load balancer or CDN is assumed.

The origin accepts forwarded client IP only from 127.0.0.1 in this frozen topology. Require one header value containing one valid full IP address. Reject duplicates, comma-separated lists and malformed data. Normalize IPv4-mapped IPv6 and equivalent IPv6 spelling through the reviewed component. Never accept caller identity or role authority from this value.

OAuth2 Proxy uses reverse_proxy=true and real_client_ip_header=X-Forwarded-For. Its trusted_proxy_ips list contains only 127.0.0.1/32. Its trusted_ips list remains empty. The latter would bypass authentication. Same-host process spoofing remains the documented pilot residual boundary. These settings do not create untrusted-workload isolation.

## Browser, API and webhook topology

Browser-protected routes retain the auth-request architecture. Traefik calls the private OAuth2 Proxy `/oauth2/auth` endpoint to validate the browser session. The proxy returns the controlled signed Google ID token in its Authorization response header. Traefik then forwards the original request directly to the origin. The origin cryptographically verifies that token again. OAuth2 Proxy is not an HTTP-upstream hop between Traefik and the origin.

The API chain preserves caller Authorization and sets the API parser hint. The webhook chain preserves the provider signature path. Neither performs the login-admission subrequest. Strip public identity and parser-hint headers before setting internal hints. IP metadata adds no authentication authority. A future proxy HTTP-upstream hop requires a separate hop-policy review because it can append another IP address.

## Admission-only header lifecycle

Use ForwardAuth only on exact GET and HEAD `/oauth2/start` and `/oauth2/callback` routes. The public root router goes directly to the origin. API and webhook chains never run the login subrequest. Public sign-out and private health stay blocked.

The entry point first rejects aliases and untrusted forwarding metadata. On the login chain only, overwrite admission metadata with fixed values. Set X-Forwarded-Uri=/ and X-Forwarded-Method=GET. Set X-Forwarded-Host=gwrk.gforge.ai. Set X-Forwarded-Proto=https and X-Forwarded-Port=443. Clear X-Forwarded-For and remaining managed fields only on this chain. Their temporary nil sentinel is expected and must be removed after successful admission.

ForwardAuth uses the fixed address `http://127.0.0.1:18790/`. Set preserveRequestMethod=false and forwardBody=false. Set trustForwardHeader=true only after the fixed-header bridge. Use the nonempty authRequestHeaders list containing X-Forwarded-Uri. The pinned implementation expands it with managed forwarding headers. Since those fields are sanitized, the admission wire contains only fixed metadata plus the actual peer-derived X-Forwarded-For. It contains no Authorization or Proxy-Authorization. It contains no Cookie or original query. It forwards no request body.

Set authResponseHeaders to X-Forwarded-For, X-Forwarded-Uri and X-Forwarded-Method. The authoritative root must omit all three from every successful response. On 2xx, pinned ForwardAuth deletes each named key from the original request before conditionally copying a response value. Omission therefore removes both the nil XFF sentinel and the fixed admission URI and method. Do not append a later Headers middleware that recreates the nil sentinel. [Pinned successful-response header handling](https://github.com/traefik/traefik/blob/v3.7.18/pkg/middlewares/auth/forward.go#L298).

Normal backend forwarding can now append the actual peer to an absent XFF field. OAuth2 Proxy receives one actual client IP. Its URI helper falls back to the unchanged request URL when X-Forwarded-Uri is absent. The original method, path and callback query were never rewritten. Fixed canonical scheme and host remain valid. [Pinned standard proxy](https://github.com/traefik/traefik/blob/v3.7.18/pkg/proxy/httputil/proxy.go#L61). [Pinned proxy URI helper](https://github.com/oauth2-proxy/oauth2-proxy/blob/v7.15.6/pkg/requests/util/util.go#L34).

API and webhook chains use normal entry-point forwarding sanitization only. Do not apply the login-only XFF removal middleware to them. Both pinned proxy implementations honor a nil XFF sentinel, so copying that removal rule would lose the client address. [Pinned fast proxy](https://github.com/traefik/traefik/blob/v3.7.18/pkg/proxy/fast/proxy.go#L223).

## Root response and failure invariant

One origin hook is the sole charge site for GET and HEAD root. Static GET success returns only the login entry. HEAD success is bodyless. Neither creates a Google session or CSRF token. Neither returns cookies, Location or the three cleanup headers.

Denials return bounded static JSON with request ID. Quota and capacity deny with 429. Store or trusted-IP dependency failures deny with 503. All real denial paths omit Location and Set-Cookie. They also omit the three forwarding cleanup headers. This is an authoritative origin invariant, not arbitrary-upstream response filtering. Stock ForwardAuth copies non-2xx headers. An intentionally malicious upstream denial would require another approved mechanism.

Set maxResponseBodySize=4096. Keep authResponseHeadersRegex unset, addAuthCookiesToResponse empty and authSigninURL unset. Root response bodies and headers contain no original query or credentials. Configure no retry middleware, even though transport retries remain possible under the amended accounting rule.

| Outcome | External behavior | Downstream effect |
|---|---|---|
| Delivered origin 2xx | Continue original proxy login request | One proxy invocation |
| Origin quota or capacity denial | 429 static JSON | No proxy invocation |
| Origin dependency denial | 503 static JSON | No proxy invocation |
| ForwardAuth connection failure or timeout | Built-in 500 | No proxy invocation |
| Oversized admission body | Built-in 401 | No proxy invocation |
| Client cancellation | No guaranteed delivered status | No allowance without delivered 2xx |

These gateway-login statuses do not amend protected API denial codes or the existing JWKS and logout timeouts. These limits apply to this login-gateway boundary.

## Required synthetic RED

| Case | Required proof |
|---|---|
| Dual-wire callback capture | Admission is GET / without secrets; proxy gets original method, path, query and cookie |
| XFF lifecycle | Admission sees the real peer; backend sees one real peer; nil sentinel cannot survive |
| Browser, API and webhook clients | Two actual external peers retain distinct quotas; API and webhook perform no login check |
| Canonical duplicates and aliases | Dot, underscore and Connection-nominated fields cannot spoof quota identity |
| Warmed connection loses charged response | Retained charges include retries; no refund; owner permits at most 60 successful checks per generation |
| Cancelled unused dial followed by lost response | Same conservative bound holds without assuming a cold socket is never marked reused |
| Quota exhaustion | Next login check gets 429 before proxy work; prior counters survive |
| Mixed-class capacity | One combined 1000-entry cap; no active eviction or second gateway map |
| Success and every real denial path | No cleanup headers, Location or Set-Cookie escape root response invariants |
| Direct root GET and HEAD | Same budget; one origin hook charge per received attempt; no recursive ForwardAuth |
| Origin failure and cancellation | No proxy work without delivered allowance; no leaked query or credentials |
| Synthetic OIDC round trip | Callback state, nonce and replay defenses remain effective after metadata cleanup |

Count actual origin requests, successful owner checks and proxy invocations separately. The lost-response fixture must observe a committed check before destroying the response connection. Assert retained charges rather than silently expecting one charge per public request. The first run must fail the old one-charge assumption if the pinned transport retries. Native runtime proof remains required. The native receipt must record the pinned image's actual Go build version. The source module declaration alone does not establish that binary version.

## Implementation and release gate

The accounting amendment and header lifecycle have independent design approval. The coordinator approved the exact topology and failure matrix. Write synthetic RED before implementation. Preserve the original REVISE history. Require native pinned-image capture and both proxy-engine paths if selectable. Keep all public exposure closed until the existing synthetic, native and restricted acceptance gates clear. Port 80 remains closed under the TLS boundary.
