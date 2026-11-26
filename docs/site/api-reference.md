# HTTP Control Plane API Reference

The complete OpenAPI 3.1 specification is stored at `docs/openapi/gwrk-openapi.yaml` and rendered interactively in the root portal at `https://gwrk.gforge.ai/#api`.

## Route Policy Table (`classifyHostedRoute`)

| Route | Methods | Auth Policy | Required Access | Public Edge |
|---|---|---|---|---|
| `/` | `GET`, `HEAD` | `public_browser_entry` | `none` | Yes |
| `/oauth2/start` | `GET`, `HEAD` | `public_oauth_start` | `none` | Yes |
| `/oauth2/callback` | `GET`, `HEAD` | `public_oauth_callback` | `none` | Yes |
| `/api/auth/session` | `GET`, `HEAD` | `google_session_only` | `own_session` | Yes (`no-store`) |
| `/api/auth/logout` | `POST` | `google_session_only` | `own_session` + CSRF | Yes (`no-store`) |
| `/api/status` | `GET`, `HEAD` | `google_or_api_key` | `read` | Yes |
| `/api/health` | `GET`, `HEAD` | `google_or_api_key` | `read` | Yes |
| `/api/dispatch` | `POST` | `google_or_api_key` | `operate` (+ CSRF if browser) | Yes |
| `/api/dispatch/queue` | `GET`, `HEAD` | `google_or_api_key` | `read` | Yes |
| `/api/dispatch/:feature/:phase` | `GET`, `HEAD` | `google_or_api_key` | `read` | Yes |
| `/api/notify` | `POST` | `google_or_api_key` | `operate` (+ CSRF if browser) | Yes |
| `/webhook/github` | `POST` | `provider_webhook` | `enrolled_repository` (HMAC) | Yes |
| `/health` | `GET`, `HEAD` | `private_liveness_only` | Loopback only | No (`404` at edge) |

## Quick cURL Examples

### Check Google Session (Browser)

```bash
curl -s https://gwrk.gforge.ai/api/auth/session \
  -H "Cookie: __Host-gwrk_session=<cookie>"
```

### Query Project Status with Operator API Key

```bash
curl -s "https://gwrk.gforge.ai/api/status?project=pilot-probe-a" \
  -H "Authorization: Bearer $(cat /var/lib/gwrk/operator-keys/operator-pilot-probe-a.secret)"
```

### Enqueue Phase Dispatch

```bash
curl -s -X POST "https://gwrk.gforge.ai/api/dispatch" \
  -H "Authorization: Bearer $(cat /var/lib/gwrk/operator-keys/operator-pilot-probe-a.secret)" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"pilot-probe-a","featureId":"051-hosted-aws-pilot","phaseId":"phase-08","backend":"agy"}'
```
