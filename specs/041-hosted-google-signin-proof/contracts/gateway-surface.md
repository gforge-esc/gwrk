# Gateway surface contract

Traefik and OAuth2 Proxy enforce Google OpenID Connect login before a private read-only status origin at `https://gwrk.gforge.ai`. Blocked: none.

## Route and method matrix

| Route and method | Caller state | Edge response | Origin reachability |
|---|---|---|---|
| `HTTP *` on port `80` | Any caller | `301` or `308` redirect to `https://gwrk.gforge.ai` | Unreached |
| `GET /` or `GET /status` | Missing session cookie | `302` redirect to `/oauth2/start` on `gwrk.gforge.ai` | Unreached |
| `GET /` or `GET /status` | Allowed verified email | `200` fixed proof body with `Cache-Control: no-store` | Reached without identity headers |
| `GET /` or `GET /status` | Unlisted or unverified email | `403` denial from OAuth2 Proxy | Unreached |
| `GET /` or `GET /status` | Expired or signed-out cookie | `302` redirect or `401` denial without status body | Unreached |
| `POST`, `PUT`, `PATCH`, or `DELETE` on `/` or `/status` | Allowed verified email | `405` rejection without status body | Write rejected |
| `/oauth2/start`, `/oauth2/callback`, or `/oauth2/sign_out` | Browser | Handled by OAuth2 Proxy | Unreached |
| `/health`, `/dispatch`, `/notify`, `/github`, or other paths | Any caller | `404` unrouted response | Absent from stack |

Sign-in redirects preserve only `gwrk.gforge.ai` destinations via `whitelist_domains = ["gwrk.gforge.ai"]`. Off-host `rd` targets fail validation or fall back to `/`.

## Identity and session controls

| Control | Production requirement | Test overlay allowance | Phase |
|---|---|---|---|
| OIDC issuer | `https://accounts.google.com` | Local `oidc-issuer.mjs` URL in `compose.test.yaml` only | Phase 2 and Phase 3 |
| Redirect URL | `https://gwrk.gforge.ai/oauth2/callback` | Identical callback URL | Phase 2 and Phase 3 |
| Email policy | Explicit `authenticated_emails_file` with `email_verified = true` | Synthetic allowlist file | Phase 2 and Phase 3 |
| Wildcard and skip rules | No wildcard domains and no `skip_auth_routes` | None allowed | Phase 2 and Phase 3 |
| OAuth callback state | Required CSRF `state` verification on `/oauth2/callback` | Tampered `state` tested for rejection | Phase 2 and Phase 3 |
| Session cookie | `Secure`, `HttpOnly`, `SameSite=Lax`, bounded `cookie_expire` and `cookie_refresh` | Shortened TTLs for expiry and revocation tests | Phase 2 and Phase 3 |
| Sign-out | `/oauth2/sign_out` clears gwrk cookie on `gwrk.gforge.ai` | Exercised without Google logout | Phase 2 and Phase 3 |
| Allowlist revocation | Atomic file update plus documented refresh denies active session | Measured in container suite; empty file denies all | Phase 2, Phase 3, Phase 4 |

## Origin isolation and header hygiene

Only Traefik publishes host ports `80` and `443` in production. The test overlay binds ephemeral loopback ports instead. OAuth2 Proxy and the status origin publish zero host ports.

The status origin attaches only to an `internal: true` Docker network shared with Traefik. Direct probes from outside that internal network fail connection.

| Header or setting | Required gateway action |
|---|---|
| `Authorization` | Strip inbound client header at Traefik |
| `X-Forwarded-User` and `X-Forwarded-Email` | Strip inbound client headers at Traefik |
| `X-Forwarded-Groups` and `X-Forwarded-Preferred-Username` | Strip inbound client headers at Traefik |
| `X-Forwarded-Access-Token` | Strip inbound client header at Traefik |
| `X-Auth-Request-User` and `X-Auth-Request-Email` | Strip inbound client headers at Traefik |
| `X-Auth-Request-Access-Token` | Strip inbound client header at Traefik |
| ForwardAuth `authResponseHeaders` | Keep empty so zero identity headers reach the origin |
| OAuth2 Proxy upstream header flags | Set `set_xauthrequest`, `pass_access_token`, `pass_authorization_header`, and `pass_user_headers` to `false` |

The status origin serves `{"service":"gwrk-auth-proof","status":"ok"}` with `Content-Type: application/json` and `Cache-Control: no-store`. The payload omits email addresses and subjects. It also omits tokens, cookies, and internal file paths.

## Test harness

Run `node tests/hosted-auth-proof/gateway-proof.mjs` from the repository root. The suite starts a private Compose project, exercises the production route configuration and removes the project on exit.
