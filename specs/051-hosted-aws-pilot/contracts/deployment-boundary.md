# Hosted deployment boundary

Use this mapping for hosted startup and Linux runner tests. Blocked: Google account selection and policy acceptance remain operator inputs. This contract names no allowed account.

## Origin settings

The Linux hosted runner requires these trusted settings in `/etc/gwrk/runner.env`. Keep `GWRK_LISTEN_HOST=127.0.0.1` and `GWRK_LISTEN_PORT=18790`.

| Setting | Pilot value |
|---|---|
| GWRK_AUTH_MODE | hosted |
| GWRK_AUTH_PUBLIC_ORIGIN | https://gwrk.gforge.ai |
| GWRK_AUTH_GOOGLE_CLIENT_ID | Actual approved web client audience |
| GWRK_AUTH_GOOGLE_ALLOWLIST_FILE | /etc/gwrk/secrets/google-account-allowlist |
| GWRK_AUTH_CSRF_HMAC_FILE | /etc/gwrk/secrets/csrf-hmac-key |

The startup adapter may accept equivalent typed configuration under `server.auth`. Use these fields:

- `mode`
- `publicOrigin`
- `googleClientId`
- `googleAllowlistFile`
- `csrfHmacKeyFile`
 Reject conflicting environment and typed values. Hosted runner preflight requires the explicit environment mapping above. An absent hosted field never selects trusted-local mode. Any hosted auth setting without explicit hosted mode fails startup.

Outside the hosted runner, existing local startup remains compatible. Read auth files only inside the explicit startup action. Config parsing and module imports perform no auth file or network reads. Initialization never creates a valid allowlist or an auth credential.

## Origin files

Both origin files require regular files without symlinks. Require owner `root:gwrk` and mode `0640`. Reject paths outside the configured secrets root. Errors name the setting or file basename without its contents.

The allowlist contains one exact email address per line. Ignore blank lines. Normalize case and surrounding whitespace. Reject wildcard entries and invalid addresses. An absent or empty list denies access. Reload the current list for each browser authentication decision. Do not cache a removed account until restart.

The CSRF HMAC file contains one base64url value encoding 32 random bytes. Reject whitespace inside the value and malformed or short values. Do not export its contents to the process environment.

Use `https://www.googleapis.com/oauth2/v3/certs` in production. Google publishes it in its [discovery document](https://accounts.google.com/.well-known/openid-configuration). Test factories may inject a local key transport. Request input and project configuration cannot redirect production key retrieval.

## Gateway files

Store gateway-only files under `/etc/gwrk/gateway-secrets`. Keep that directory root-owned with mode `0700`. Use basenames `oauth-client-secret` and `oauth-cookie-secret` with mode `0600`. Root provisions the separate gateway service mounts. The `gwrk` service and its workers cannot read that directory. Never copy gateway files into `/etc/gwrk/secrets` or the project checkout.

The production gateway implementation must prove its pinned container identity can consume the mounted files. It must preserve the worker access denial. This contract does not require an unverified container user configuration.

## Gateway header bridge

The gateway strips public identity and auth-mode headers before setting `X-Gwrk-Auth-Mode`. Use `google_id_token` for its browser chain. Use `api_key` for its API chain and `webhook` for its provider chain.

The origin treats this value only as a parser hint. It never creates identity or project grants from it. The Google hint extracts the controlled Authorization bearer value as `forwardedGoogleIdToken`. It does not also supply caller Authorization to credential selection. The API hint preserves caller Authorization and supplies no forwarded Google token.

Absent a hint, caller Authorization may enter only the API parser. Missing metadata never selects browser authentication or trusted-local authorization. An invalid hint denies protected requests. The webhook hint cannot bypass classification of a non-webhook route. Every Google or API credential still requires cryptographic verification and current lifecycle checks. Direct local header forgery must fail with invalid credentials.

The origin guard owns browser mutation checks through the existing `BrowserCsrfPort` and pure origin policy. Require configured `expectedOrigin` and the port for Google mutations. Missing dependencies deny those writes. Issuance receives the capped verified `expiresAt` through `BrowserCsrfPort`. Use the maintained public token engine with session HMAC binding. Set absolute cookie expiry no later than that deadline. Omit issuance Max-Age. Read `__Host-gwrk_csrf` and `x-gwrk-csrf-token`. Never accept query CSRF tokens. API and provider signature chains retain their separate protections.

## Internal proxy logout

The production proxy listens on `127.0.0.1:4180` for origin sign-out. Use the fixed URL `http://127.0.0.1:4180/oauth2/sign_out`. No request or project configuration may replace that target. The production bundle must keep this listener private. Public gateway routing blocks direct sign-out.

Use `__Host-gwrk_session` as the production proxy cookie name. Supply that same name to origin credential selection. Keep host-only secure cookies with HttpOnly protection. Preserve the proxy's one-hour expiry and disabled refresh. The proof bundle retains its existing cookie name.

The logout adapter forwards Cookie only. It follows no redirect and returns no Location header. Bound the operation by the shared proxy logout timeout. Cancel unused response bodies. Return a static typed failure on timeout or transport error.

Success requires cookie-clearing response headers from the fixed endpoint. Preserve separate Set-Cookie header values for chunked proxy cookies. Never report proxy clearing merely because a fetch resolved. The origin must already have committed revocation before invoking this adapter.

## Worker environment

The origin receives its startup mapping. Strip inbound auth settings at the actual agent-child spawn boundary after combining inherited and explicit adapter environments. Clearing them in `run.sh` would also clear settings needed by the origin.

Remove keys with case-insensitive prefixes `GWRK_AUTH_` and `OAUTH2_PROXY_`. Also remove `GWRK_API_KEY` and `GWRK_SERVER_API_KEY`. Also remove these header-shaped keys:

- `AUTHORIZATION`
- `HTTP_AUTHORIZATION`
- `COOKIE`
- `HTTP_COOKIE`
- `SET_COOKIE`
 An explicit task environment cannot restore a removed key.

Preserve approved outbound credentials and native provider discovery. This includes the existing Git and optional Slack credentials. Preserve the provider bus address and native account home. Do not read or copy native account credentials while building child environments.

Use a pure environment filter in `src/domain/worker-auth-environment.ts`. Apply it in the existing shared spawn path in `src/utils/agent.ts`. Verify an actual hermetic child receives outbound canaries and no inbound canaries. Keep the existing command-safety environment behavior.

This removes inherited auth configuration. It does not isolate a same-user worker from the origin database or memory. Untrusted workload isolation remains outside this pilot claim.
