# Hosted pilot live acceptance record

Live acceptance verified production authentication and gateway controls on `https://gwrk.gforge.ai` at merged release `1.6.0-beta.1` (`3a110c63c00e36db2ff10235c9a8dd247d89ac59`). Blocked: none.

Verdict: PASS.

## Execution authority

- Operator: David Gonzalez (`gonzodbg@gmail.com`)
- Host: `https://gwrk.gforge.ai` (`i-0e1e1453967c7c1c8`, `18.216.112.147`)
- Release archive SHA-256: `20774a1090b62d6ffa155f12033d19697b694a54729e0a9cb2d0460dcc42d589`
- Gateway archive SHA-256: `5ef8d719f1776e91bb75e88e8bf268aa53407a7b6dc762c52cc31acbb83f063b`
- Certificate fingerprint SHA-256: `B5:7F:4E:68:BA:E8:7B:5C:4C:4A:18:65:D4:AB:2A:00:3F:9F:1A:32:27:FC:5B:36:C5:73:83:B2:A9:ED:ED:7C`
- Mode: restricted operator-only ingress (`136.36.185.111/32`) during probes, then publicly protected HTTPS (`0.0.0.0/0` on port `443`) after independent Gemini 4 Neon High security review (`GO`)

## Acceptance observations

| Probe ID | Probe area | Observed live evidence | Verdict |
|---|---|---|---|
| `LA-01` | Google login | `gonzodbg@gmail.com` received HTTP 200 session `c04d2a612764` and zero auto-granted project roles (`403 UNAUTHORIZED_USER`) | PASS |
| `LA-02` | Google denial | Live allowlist removal returned HTTP 403 `AUTH_ACCOUNT_DENIED` (`req-n`) and expired callback state returned HTTP 403 | PASS |
| `LA-03` | API key lifecycle | Mode `0600` key returned HTTP 200 on scoped project and HTTP 401 on missing, malformed, expired, rotated, and revoked keys | PASS |
| `LA-04` | Cross-project denial | Project A key received HTTP 403 on Project B `/api/status` and `/api/health` and HTTP 403 on viewer `/api/dispatch` | PASS |
| `LA-05` | Private origin | External ports `80`, `4180`, and `18790` stayed unreachable, public `/health` returned HTTP 404, and `TLSv1.3` enforced strict SNI | PASS |
| `LA-06` | Header forgery | Remote and local loopback forged identity headers and forged Bearer tokens returned HTTP 401 across all probes | PASS |
| `LA-07` | CSRF | Browser `POST /api/auth/logout` with missing token, wrong token, missing Origin, cross-site Origin, or query token returned HTTP 403 (`req-p` to `req-t`) | PASS |
| `LA-08` | Logout replay | Valid CSRF `POST /api/auth/logout` returned HTTP 200 (`req-v`, audit `33`) and replayed session cookies returned HTTP 401 `AUTH_SESSION_REVOKED` (`req-w` to `req-y`) | PASS |
| `LA-09` | Webhook HMAC | Missing and invalid signatures returned HTTP 401, valid HMAC ping returned HTTP 200, and altered payload replay returned HTTP 400 | PASS |
| `LA-10` | Restart | `systemctl restart gwrk-runner` (`1960029` to `1960577`) retained active key HTTP 200 and revoked key HTTP 401 | PASS |
| `LA-11` | Reboot | Host reboot (`fceb7101` to `1376ccac`) recovered `gwrk-runner`, Traefik, and OAuth2 Proxy with active key HTTP 200 and revoked key HTTP 401 | PASS |
| `LA-12` | Restore | Offline snapshot `/var/lib/gwrk/backups/phase9-verified-20261125` restored 24 credentials and 32 audit rows on isolated state and blocked pre-020 downgrade | PASS |
| `LA-13` | Zero leaked tokens | Service journal, Traefik logs, OAuth2 Proxy logs, and SQLite `auth_audit_events` rows contained zero raw tokens or cookies | PASS |

## Operator sign-off

Verdict: PASS. All 13 live security and continuity probes and post-open public re-checks passed against `https://gwrk.gforge.ai`.
