# Hosted pilot operator runbook

This runbook guides operators on secret handling and service maintenance for the hosted pilot. Blocked: none.

## Secret separation

Gateway secrets remain distinct from origin secrets. Root owns `/etc/gwrk/gateway-secrets` with mode 0700. The gateway container reads its mounted secrets directly. Service workers cannot read gateway files.

Origin secrets reside in `/etc/gwrk/secrets`. Root owns each file with group gwrk and mode 0640. The gwrk service reads only its required origin files.

| Secret path | Consumer | Required permissions |
|---|---|---|
| `/etc/gwrk/gateway-secrets/oauth-client-secret` | OAuth2 Proxy | 0600 root:root |
| `/etc/gwrk/gateway-secrets/oauth-cookie-secret` | OAuth2 Proxy | 0600 root:root |
| `/etc/gwrk/gateway-secrets/tls/` | Traefik | 0700 root:root |
| `/etc/gwrk/secrets/google-account-allowlist` | Origin service | 0640 root:gwrk |
| `/etc/gwrk/secrets/csrf-hmac-key` | Origin service | 0640 root:gwrk |

## Key rotation

Rotate API keys with `gwrk auth key rotate`. Rotation revokes the old key immediately unless `--overlap-until` is provided.

```bash
gwrk auth key rotate <credential-id> \
  --expires-at 2026-12-31T23:59:59Z \
  --secret-out /etc/gwrk/secrets/rotated-key.secret \
  --overlap-until 2026-11-25T12:00:00Z
```

To revoke a key immediately, use `gwrk auth key revoke`:

```bash
gwrk auth key revoke <credential-id> --reason "Compromised credential"
```

## Live allowlist updates

Update `/etc/gwrk/secrets/google-account-allowlist` directly. The origin reloads the file for every browser request. Account removal takes effect without restarting the origin service.

Keep one valid email per line. Do not use wildcards. Preserve mode 0640 and ownership `root:gwrk`.

## Offline backup, restore, and rollback

Stop the gwrk runner service before taking or restoring offline database snapshots.

To create an offline backup:

```bash
systemctl stop gwrk-runner
runuser -u gwrk -- env GWRK_RUNTIME_DIR=/var/lib/gwrk gwrk db backup --out /var/lib/gwrk/backups/manual-$(date +%Y%m%d)
systemctl start gwrk-runner
```

To restore from a backup:

```bash
systemctl stop gwrk-runner
runuser -u gwrk -- env GWRK_RUNTIME_DIR=/var/lib/gwrk gwrk db restore --from /var/lib/gwrk/backups/manual-<date> --state-dir /var/lib/gwrk --force
systemctl start gwrk-runner
```

To roll back a release, run `deploy/linux-runner/rollback-release.sh`. That script runs `gwrk db rollback-check`. Rolling back across migration 020 (`020-production-auth.sql`) is blocked because older releases lack required auth tables.

## TLS renewal

The operator provisions certificates under `/etc/gwrk/gateway-secrets/tls`. Store `fullchain.pem` and `privkey.pem` with mode 0600.

Follow the TLS boundary contract for certificate replacement:

1. Close public ingress or keep it restricted.
2. Stop the gateway container.
3. Stage renewed certificate files in `/etc/gwrk/gateway-secrets/tls`.
4. Run `deploy/hosted-pilot/run.sh` to execute preflight checks and restart the gateway.

```bash
docker compose -f deploy/hosted-pilot/compose.yaml down
bash deploy/hosted-pilot/run.sh
```

## Ingress closure

Close ingress on any security failure or unverified certificate change. Restrict security group rules on port 443 to the operator IP address. Keep application port 18790 bound strictly to loopback 127.0.0.1.

## Same-host worker residual boundary

The gwrk service user executes local worker processes on the host. Inbound auth tokens are stripped from worker environments. Worker processes cannot read gateway secrets. Same-host workers share host storage and memory with the service. This pilot does not isolate untrusted workloads.

## Phase 052 handoff

The downstream feature 052 owns public rollout and project enrollment.

| Area | Pilot state | Phase 052 ownership |
|---|---|---|
| Project enrollment | 0 enrolled projects in 051; project enrollment deferred to 052 | Multi-project registry |
| Role bindings | Manual SQL or script setup | Management endpoints |
| Slack transport | Socket Mode | Scoped project routing |
| Telemetry | Offline SQLite ledger | Remote reporting |
| TLS management | Manual file placement | Automated renewal |
