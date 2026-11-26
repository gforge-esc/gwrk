# Security Policy

Report vulnerabilities privately to `gonzodbg@gmail.com`. Do not open public issues for security defects. This policy covers the local gwrk CLI and the hosted control plane at [gwrk.gforge.ai](https://gwrk.gforge.ai). Blocked: none.

## Reporting a Vulnerability

Email `gonzodbg@gmail.com` with these details:

- Vulnerability description and affected surface
- Reproduction steps using synthetic inputs only
- Expected impact
- Suggested fix if available

| Action | Target Timeline |
|---|---|
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 1 week |
| Fix or mitigation | Prioritized by severity |

## Scope

In-scope security issues:

- Credential or session leakage in responses, logs or CLI output
- Authentication bypass or forged identity header acceptance
- Allowlist enforcement failure on hosted Google login
- Cross-project authorization bypass or role escalation across `viewer`, `operator` and `maintainer`
- Cross-Site Request Forgery (CSRF) bypass or failed session revocation
- Unsigned or tampered GitHub webhook acceptance
- Command injection or path traversal in CLI, sandbox or installer workflows
- SQLite injection in the execution ledger or auth store

Out-of-scope reports:

- Attacks requiring existing local shell access on a developer workstation in local-only mode
- Defects solely in upstream third-party dependencies
- Feature requests without a security impact

## Trust Boundaries

### Local CLI Mode

When run locally on a workstation, gwrk obeys these boundaries:

- Executes with the current user's OS permissions
- Reads tracked project configuration from `.gwrkrc.json` and gitignored preferences from `.gwrkrc.local.json`
- Stores global runtime state and the local SQLite ledger under `~/.gwrk/`
- Dispatches work to installed agent CLIs (`agy`, `claude` and `codex`) through `WorkflowRuntime`
- Never reads or stores raw hosted API credentials inside tracked repository files

### Hosted Control Plane (`ADR-014`)

The hosted service enforces defense-in-depth between the public edge and the private application origin:

- Public HTTPS terminates at the reverse proxy. Only explicitly classified routes are reachable. Private loopback `/health` and `/oauth2/sign_out` return HTTP 404 at the edge.
- The gwrk Fastify origin listens only on loopback (`127.0.0.1:18790`) or a private interface. It rejects non-loopback binds unless hosted authentication mode is enabled.
- The origin never trusts public identity headers from callers. This rejects `X-Forwarded-User`, `X-Forwarded-Email` and `X-Forwarded-Groups`. It also rejects `X-Forwarded-Preferred-Username`, `X-Forwarded-Access-Token` and `X-Auth-Request-*`.
- Protected HTTP handlers require a verified principal. Browser sessions require a verified RS256 Google OpenID Connect (OIDC) ID token checked against Google JWKS and the live allowlist. Automation requires a verified opaque API credential.
- `POST /webhook/github` verifies `X-Hub-Signature-256` (`HMAC-SHA256`) over the raw body in constant time before parsing JSON. Missing or blank webhook secrets fail closed.

## Project Roles and Authorization

Google sign-in authenticates an allowlisted account. It never grants project permissions automatically. Every operational API request checks explicit project role bindings in the server SQLite registry:

| Role | Read (`status`, `health`, `dispatch/queue`) | Operate (`dispatch`, `notify`) | Admin (`project enroll`, `auth key`) |
|---|---|---|---|
| `viewer` | Allowed for bound project | Denied (HTTP 403) | Local server CLI only |
| `operator` | Allowed for bound project | Allowed for bound project | Local server CLI only |
| `maintainer` | Allowed for bound project | Allowed for bound project | Local server CLI only |

Cross-project access fails closed with HTTP 403 (`UNAUTHORIZED_USER` or `INSUFFICIENT_ROLE`). Project enrollment and API key management are local operator CLI commands on the server host. They are not public HTTP endpoints.

## Credentials and Session Revocation

### Browser Google Sessions

- The origin persists only SHA-256 token digests in `google_sessions`. Raw Google ID tokens are never stored.
- Browser sessions have a hard cap (default 3600 seconds) and re-check the live email allowlist on authentication.
- Browser mutations require a matching same-origin `Origin` header and the `X-Gwrk-Csrf-Token` header bound to the active session digest. This applies to `POST /api/dispatch`, `POST /api/notify` and `POST /api/auth/logout`.
- Sign-out uses origin-first `POST /api/auth/logout`. It records durable revocation in SQLite before clearing proxy cookies. Replayed cookies fail closed with HTTP 401 (`AUTH_SESSION_REVOKED`).
- Removing a user from the host allowlist denies subsequent requests on live reload.

### Opaque API Credentials

- Format is `gwrk_v1.<id>.<secret>`. The `<secret>` segment is 32 random bytes encoded as 43 base64url characters.
- The server stores only SHA-256 verifiers in `api_credentials` and compares them in constant time. Raw credentials are never stored in SQLite and never printed to stdout or logs.
- Every key has a finite expiry (maximum 30 days) and binds strictly to its canonical HTTPS audience origin (`https://gwrk.gforge.ai`).
- Operators issue keys using `gwrk auth key create --secret-out <path>`. That writes a mode `0600` file exclusively outside any repository checkout.
- Rotate keys atomically with `gwrk auth key rotate <credentialId> --expires-at <iso8601> --secret-out <new-path>`.
- Revoke compromised keys immediately with `gwrk auth key revoke <credentialId> --reason <text>`. Revocation takes effect immediately and persists across restarts.

### Outbound Provider Credentials

Outbound credentials cover GitHub, agent CLIs and optional Slack Socket Mode. Store them in `/etc/gwrk/secrets` with mode `0640` owned by `root:gwrk` on Linux runners, or in `~/.gwrk/config.json` locally. Never place credentials in prompts or CLI arguments. Never place them in `.gwrkrc.json` or committed files. Revoke leaked provider tokens at the provider. Replace the secret file and restart the runner service.
