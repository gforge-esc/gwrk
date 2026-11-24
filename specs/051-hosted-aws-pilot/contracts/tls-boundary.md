# Hosted TLS boundary

Use preissued TLS files for the production gateway. Blocked: none for this interface. Certificate issuance and live acceptance remain separate operator actions.

## Configuration

Production uses the pinned Traefik 3.7.18 image. Remove certificate resolver references and ACME challenge flags from the new production bundle. Use no ACME storage volume. Preserve the existing proof bundle unchanged.

The operator provisions `/etc/gwrk/gateway-secrets/tls` with owner root and mode `0700`. It contains `fullchain.pem` and `privkey.pem` as regular root-owned files with mode `0600`. Neither is a symlink. No key or PEM value enters tracked files or logs. The gateway receives only this TLS subdirectory. It receives no origin or provider credentials through that mount.

Mount the directory read-only at `/run/gwrk-gateway-tls`. Use Compose long bind syntax with `create_host_path: false`. A missing source must never become an empty created directory. The operator proves the pinned gateway container identity can read its mount. The gwrk service and workers cannot read the host directory. This adds no broader worker isolation claim.

```yaml
volumes:
  - type: bind
    source: /etc/gwrk/gateway-secrets/tls
    target: /run/gwrk-gateway-tls
    read_only: true
    bind:
      create_host_path: false
```

Use these dynamic TLS settings alongside the reviewed HTTP routers. Every published router requires TLS. Configure only the file provider. Set `--providers.file.directory=/etc/traefik/dynamic` and `--providers.file.watch=false`. Apply replacements through controlled restart.

```yaml
tls:
  certificates:
    - certFile: /run/gwrk-gateway-tls/fullchain.pem
      keyFile: /run/gwrk-gateway-tls/privkey.pem
  options:
    default:
      minVersion: VersionTLS12
      sniStrict: true
```

Traefik supports certificate and key paths through dynamic file configuration. Router Host rules do not select the handshake certificate. Default TLS options apply when a router names no alternate options. Strict server-name indication rejects missing or unmatched names. Do not configure alternate router options that weaken it. [Pinned certificate configuration](https://github.com/traefik/traefik/blob/v3.7.18/docs/content/reference/routing-configuration/http/tls/tls-certificates.md). [Pinned TLS options](https://github.com/traefik/traefik/blob/v3.7.18/docs/content/reference/routing-configuration/http/tls/tls-options.md).

Compose documents bind creation controls and read-only mounts. Those controls do not validate certificate contents. File watching is optional. [Compose volumes](https://docs.docker.com/reference/compose-file/container-spec/#volumes). [Pinned file provider](https://github.com/traefik/traefik/blob/v3.7.18/docs/content/reference/install-configuration/providers/others/file.md).

## Fail-closed startup

Add `deploy/hosted-pilot/preflight-tls.sh` or an equivalent bounded gateway startup check. Run it before creating the listener. Keep it separate from the worker environment loader.

1. Validate ownership and modes for the directory and both files. Reject missing files and symlinks.
2. Parse the leaf certificate and complete chain. Parse its private key without printing material.
3. Compare derived public keys. Require a matching pair.
4. Require certificate coverage for `gwrk.gforge.ai` and a current validity interval. Verify its server-auth chain against the trusted runtime roots. Verify that chain again at the seven-day acceptance deadline.
5. Reject expired or untrusted certificates. Return only the failed condition and file basename.
6. Verify the pinned container identity can read the mounted files. Stop before listener creation if it cannot.
7. Load the complete reviewed dynamic configuration with strict default TLS options. Do not launch a partial configuration after preflight failure.

A missing or malformed certificate is not sufficient to make Traefik exit. Its manager logs parse failures and can generate a default certificate. Preflight supplies the startup barrier. Strict SNI supplies the handshake rejection boundary when no matching certificate loads. [Pinned TLS manager](https://github.com/traefik/traefik/blob/v3.7.18/pkg/tls/tlsmanager.go#L117).

## Restricted acceptance order

| Stage | Allowed action | Ingress |
|---|---|---|
| Before synthetic gates | Fixture tests only | Existing operator SSH only |
| After synthetic and native gates | Install reviewed gateway and preissued certificate | Application ingress closed |
| Restricted live acceptance | Canonical DNS and trusted TLS plus Google callback | TCP 443 from operator address only |
| After recorded live acceptance | Authenticated public gateway | Worldwide TCP 443 permitted by the operator |

Port 80 stays closed during restricted acceptance. Do not configure HTTP-01 or TLS-ALPN-01 issuance as a bootstrap shortcut. DNS publication does not authorize broader network ingress. Keep the application origin and proxy sign-out listeners private.

The operator browser starts Google login through `https://gwrk.gforge.ai`. Google returns the browser to the fixed `/oauth2/callback` URL. The browser reaches that callback from the permitted operator address. Proxy token exchange uses outbound HTTPS. No inbound Google-server exception is needed for this authorization-code flow. Live observation still proves the complete callback path. [Google authorization-code flow](https://developers.google.com/identity/openid-connect/openid-connect#exchangecode).

An operator may later get the certificate through DNS-01 with existing operator-side AWS authorization. A trusted preissued certificate from another approved issuer also fits. No AWS key or instance profile is needed on the VM for this file-consumption interface. DNS issuance and Google policy acceptance remain coordinator-led operations with human inputs.

## Test interface

| Case | Required observation | Boundary |
|---|---|---|
| No ACME bootstrap | Production has no resolvers or challenge flags | Static configuration gate |
| Missing or unsafe key files | Preflight nonzero before listener creation | Real temporary files |
| Mismatched or expired certificate | Preflight denies without PEM output | Local certificate fixtures |
| Valid configured pair | Client validates chain and canonical hostname | Pinned gateway with fixture CA |
| Unknown or absent SNI | Handshake fails | Pinned gateway |
| Missing mounted certificate | No authenticated origin request | Pinned gateway and effect counter |
| Wrong container identity | Unreadable mount blocks readiness | Native Linux permissions |
| Worker reads key directory | Access denied | Native Linux service identity |
| Changed valid pair | Controlled restart serves new fingerprint | Fixture rotation gate |
| Invalid replacement | Ingress remains closed and gateway stays stopped | Operator runbook gate |
| Restricted callback | Canonical HTTPS works only from approved network | Separate live acceptance |

Use a test-only CA trusted explicitly by the synthetic client. Never use insecure certificate verification as passing evidence. No live certificate issuance belongs to deterministic tests. Keep the read-only proof regression unchanged.

## Renewal handoff

The operator owns pilot renewal. Record issuer and leaf fingerprint plus serial and expiration. Record the next renewal deadline without key material. Require the complete server-auth chain to remain valid for at least seven days at pilot acceptance.

Before replacement, close application ingress and stop the gateway. Stage and validate the new pair in a root-only directory. Replace the pair while stopped. Run preflight and restart. Verify the served fingerprint and trusted canonical HTTPS before restoring the previously approved ingress stage. Keep the auth ledger unchanged.

The pilot does not claim automated renewal or zero-downtime certificate rotation. Expired or unverifiable replacement material keeps ingress closed. Restore a previous certificate only if it remains valid and its key remains uncompromised.

Feature 052 project rollout must include certificate lifecycle ownership and expiry monitoring in operational readiness. Future renewal automation needs a separate reviewed credential and issuer procedure. It cannot silently give the pilot VM DNS credentials.

The production startup path must run the reviewed TLS preflight before creating the public listener. Deterministic tests use local fixture certificates. Live issuance follows the restricted acceptance sequence.
