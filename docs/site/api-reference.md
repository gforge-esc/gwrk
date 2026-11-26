# HTTP Control Plane API Reference

The hosted control plane at `https://gwrk.gforge.ai` accepts origin-verified Google sessions from browsers and scoped `gwrk_v1.<id>.<secret>` API credentials from automation. The OpenAPI 3.1 specification lives in `docs/openapi/gwrk-openapi.yaml` and renders in the portal at `https://gwrk.gforge.ai/#api`. Blocked: none.

## Route policy table

| Route | Methods | Auth policy | Required access |
|---|---|---|---|
| `/` | `GET`, `HEAD` | `public_browser_entry` | Public |
| `/oauth2/start` | `GET`, `HEAD` | `public_oauth_start` | Public |
| `/oauth2/callback` | `GET`, `HEAD` | `public_oauth_callback` | Public |
| `/api/auth/session` | `GET`, `HEAD` | `google_session_only` | Own session (`no-store`) |
| `/api/auth/logout` | `POST` | `google_session_only` | Own session, same origin and CSRF |
| `/api/status` | `GET`, `HEAD` | `google_or_api_key` | Project `read` |
| `/api/health` | `GET`, `HEAD` | `google_or_api_key` | Project `read` |
| `/api/dispatch` | `POST` | `google_or_api_key` | Project `operate`, CSRF for browsers |
| `/api/dispatch/queue` | `GET`, `HEAD` | `google_or_api_key` | Project `read` |
| `/api/dispatch/:feature/:phase` | `GET`, `HEAD` | `google_or_api_key` | Project `read` |
| `/api/notify` | `POST` | `google_or_api_key` | Project `operate`, CSRF for browsers |
| `/webhook/github` | `POST` | `provider_webhook` | Enrolled repository raw-body HMAC |
| `/health` | `GET`, `HEAD` | `private_liveness_only` | Loopback only, HTTP 404 at the edge |

The route classifier is `classifyHostedRoute`.

## Browser authentication flow

People sign in through the browser. Do not copy browser session cookies into scripts.

1. Open `https://gwrk.gforge.ai/oauth2/start` and sign in with an allowlisted Google account.
2. The portal calls `GET /api/auth/session` with `credentials: "same-origin"`. The response confirms the session and returns the session-bound `csrfToken`.
3. Browser `POST` requests send `Origin: https://gwrk.gforge.ai` and `X-Gwrk-Csrf-Token: <csrfToken>`.
4. Sign out with `POST /api/auth/logout`. The origin revokes the session digest before it clears proxy cookies.

Google login alone grants no project access. An operator binds your `google_sub` principal to a project role (`viewer`, `operator` or `maintainer`) on the server host.

## Automation requests

Keep the operator-issued credential in a `0600` file owned by your user, outside every repository checkout. Never place the key in a command argument. Process listings and shell history expose arguments, including `$(cat file)` expansions.

### Status through the CLI

`gwrk status` reads the key from the file and binds it to the origin:

```bash
gwrk status \
  --server-url https://gwrk.gforge.ai \
  --credential-file "$GWRK_API_KEY_FILE" \
  --credential-origin https://gwrk.gforge.ai \
  --project my-project
```

### Status through curl

`curl -H @-` reads the header from standard input. The key never appears in an argument.

```bash
: "${GWRK_API_KEY_FILE:?Set GWRK_API_KEY_FILE to your private 0600 key file}"
{ printf 'Authorization: Bearer '; cat "$GWRK_API_KEY_FILE"; } |
  curl -sS -H @- "https://gwrk.gforge.ai/api/status?project=my-project"
```

### Enqueue a phase dispatch

```bash
: "${GWRK_API_KEY_FILE:?Set GWRK_API_KEY_FILE to your private 0600 key file}"
{ printf 'Authorization: Bearer '; cat "$GWRK_API_KEY_FILE"; } |
  curl -sS -X POST "https://gwrk.gforge.ai/api/dispatch" \
    -H @- \
    -H "Content-Type: application/json" \
    -d '{"projectId":"my-project","featureId":"001-my-feature","phaseId":"phase-01","backend":"agy"}'
```

Replace `my-project` and `001-my-feature` with your enrolled project slug and feature ID. A dispatch needs the `operator` or `maintainer` role on the project. Never print the key or echo the assembled header.
