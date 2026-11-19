# Hosted Google sign-in proof

Provide a disposable status page at `https://gwrk.gforge.ai` behind Traefik and OAuth2 Proxy. Verify that allowed Google accounts can reach the page and that denied accounts cannot. Blocked: none for implementation. Live acceptance needs the pilot host, DNS and Google web client inputs.

> **Feature:** `041-hosted-google-signin-proof`
> **Status:** Reviewed for planning
> **Source:** [Hosted gwrk server brief](../../docs/research/R013-hosted-gwrk-server/brief.md)
> **Related:** [Daily-driver audit](../../docs/research/2026-11-11-daily-driver-audit.md)

## User scenarios

### US-001 Protected status and Google login [3 SP, P0, PE]

An allowed operator opens the status page, follows the Google sign-in flow and receives a 200 response over HTTPS. The response provides a fixed proof identifier. It carries no account identifiers, credentials or OAuth tokens.

**Acceptance:** An isolated deployment test follows the edge redirect and completes sign-in through a test OpenID Connect issuer. It checks the response body, secure session cookie, no-store header and exact callback origin. Live acceptance repeats the browser journey with the Google client and a valid certificate. Covers FR-001 through FR-003.

### US-002 Denials and private origin [3 SP, P0, PE]

The gateway denies callers without a valid session or an allowed, verified email. Direct origin requests cannot cross the public boundary. Headers set by clients never establish identity.

**Acceptance:** A deployment test presents unauthenticated, unlisted and unverified users. It also sends forged identity headers and probes the status origin from outside its private network. Denial, redirect or connection refusal must prevent the status body from reaching the caller. Covers FR-002 through FR-004.

### US-003 Session lifecycle [2 SP, P0, PE]

The operator can end the gwrk browser session. An expired session or a revoked allowlist entry loses access. The status endpoint has only read methods.

**Acceptance:** A deployment test reuses a browser session after expiry, follows sign-out and applies an allowlist change. After revocation takes effect, a previously valid session cannot reach the status page. Test rejection of a callback with invalid state and a write request to the status route. Live acceptance records the same lifecycle with synthetic or designated accounts. Covers FR-003 and FR-005.

### US-004 Repeatable deployment and teardown [3 SP, P1, PE]

The operator can review configuration, inject credentials and bring up an isolated proof host. The runbook explains acceptance and teardown.

**Acceptance:** Offline validation rejects missing or placeholder secrets, the wrong callback host, wildcard authorization and a published origin port. The deployment test runs with synthetic credentials. The runbook records the cloud account, region and estimated cost before provisioning. Covers FR-006 and FR-007.

## Functional requirements

### FR-001 Edge routing and transport

Use a version-pinned Traefik deployment with an HTTPS router for `gwrk.gforge.ai` and HTTP-to-HTTPS redirect. Route documented OAuth2 Proxy endpoints at `/oauth2/`. Protect `GET /` and `GET /status` through ForwardAuth. Redirect an unauthenticated browser to the same-origin sign-in path. Preserve the requested destination within the proof host.

### FR-002 OpenID Connect and email authorization

Use a dedicated Google web client with redirect URI `https://gwrk.gforge.ai/oauth2/callback`. OAuth2 Proxy verifies token issuer, audience and email verification. Use an explicit authenticated email file. Keep domain-wide, wildcard and skip-auth routes disabled. Enable OAuth state checks and use secure, HTTP-only cookies. Allow a test issuer only in the isolated test bundle.

### FR-003 Status surface

Serve a fixed, no-store response on the protected read routes. Return no personal identity, internal paths or provider data. Reject write methods and leave other paths unrouted. Keep the existing gwrk daemon, dispatch, notification, health and GitHub routes outside the proof. Keep Telegram disabled.

### FR-004 Origin isolation and header trust

Publish only the edge ports. Put the status origin on a private network reachable by the edge. Strip inbound authentication and identity headers and trust forwarded metadata only from configured proxies. Authorize requests through the verified OAuth2 Proxy response. The origin does not need identity or token headers for this proof.

### FR-005 Session lifecycle

Set bounded session lifetime and keep sign-out on the proof host. Sign-out ends the gwrk session. Verify expiry with an expired cookie and revocation with a previously allowed session. Document the allowlist reload or service refresh procedure and measure when denial takes effect. Allowlist updates must never open access. Keep Google account logout outside the proof.

### FR-006 Isolated stack and validation

Track the deployment bundle under `deploy/hosted-auth-proof/` with example inputs. Supply OAuth client credentials, session secrets and the real allowlist from local operator-managed files or secret injection. Ignore those files in Git. Validate the complete effective stack with fixtures. Fail closed if the gateway, allowlist or provider is unavailable.

### FR-007 Live acceptance and downstream boundaries

Document preflight for a separate Linux host and cloud role. Cover DNS, HTTPS, Google client ownership, the first allowed account, credentials and teardown. Record allowed and denied logins and direct-origin tests before advancing the pilot. Keep project identity and authorization, Slack Socket Mode, GitHub polling, durable dispatch, harvest and the Linux worker as downstream features. The integrated pilot will map verified issuer and subject to project roles.

## Test requirements

- **TR-001** Exercise actual Traefik and OAuth2 Proxy routing with an isolated OpenID Connect issuer and synthetic users. Cover FR-001 through FR-005 with a disposable network and no production credentials.
- **TR-002** Check effective configuration and secret hygiene against malformed and unsafe fixtures. Cover FR-001, FR-002, FR-004 and FR-006.
- **TR-003** Use the live checklist to distinguish fixture evidence from the real Google and DNS test. Cover FR-007.

## References

- [Traefik ForwardAuth](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/forwardauth/)
- [OAuth2 Proxy options](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview/)
- [OAuth2 Proxy with Traefik](https://oauth2-proxy.github.io/oauth2-proxy/configuration/integrations/traefik/)
