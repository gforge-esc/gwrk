# Stack validation and live acceptance contract

Preflight checks the deployment inputs. Static tests verify the production configuration. Blocked for live acceptance until the operator has a public host, DNS and a Google web client.

| Check | Rejects |
|---|---|
| Preflight input tests | Missing and placeholder credentials, wildcard allowlist entries |
| Production bundle tests | Wrong issuer or callback, wildcard authorization, published origin ports, missing session controls, forwarded identity headers |
| Container fixture | Failed allowed login, status disclosure to denied callers, reachable private origin, ineffective session expiry or revocation |
| Live acceptance | Missing public DNS, public certificate, browser sign-in through Google, or an external origin probe |

Run `pnpm exec vitest run tests/hosted-auth-proof` for offline checks. Run `node tests/hosted-auth-proof/gateway-proof.mjs` for the container fixture. On the host, run `deploy/hosted-auth-proof/preflight.sh` after preparing the operator inputs.

The [runbook](../../../deploy/hosted-auth-proof/README.md) lists the live evidence. The [example record](../../../deploy/hosted-auth-proof/live-acceptance.example.md) starts with all checks pending. Keep the completed record in operator-managed storage.
