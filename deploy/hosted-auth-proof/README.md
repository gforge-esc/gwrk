# Hosted Google sign-in proof

The proof serves a fixed status response behind Google sign-in at `gwrk.gforge.ai`. Blocked for live acceptance until the operator records the host, DNS and Google web client inputs.

## Host and DNS

Record the cloud account, region, Linux host role and estimated monthly cost before provisioning. Use a separate host and a role scoped to its management needs. Keep the existing gwrk server on its current host during the proof.

Assign a stable public address. Point the `gwrk.gforge.ai` DNS record at that address. Publish an IPv6 record only if the host supports ingress over IPv6. Open inbound TCP ports 80 and 443. The certificate resolver uses the TLS challenge on port 443. Allow outbound HTTPS for certificate issuance and Google OpenID Connect discovery.

Create a dedicated Google OAuth web client. Register `https://gwrk.gforge.ai/oauth2/callback` as its authorized redirect URI. Record the client owner and verify that the intended allowed and denied test accounts can use the client's consent configuration.

## Configure and start

Copy `.env.example` to `.env` and set the client ID and certificate contact email. Keep `.env` private. Create `local/` with these files.

| File | Contents |
|---|---|
| `local/google-client-secret` | Google client secret without a trailing newline |
| `local/cookie-secret` | Base64url encoding of 32 random bytes without a trailing newline |
| `local/allowed-emails` | One explicit Google account email per line |

Create the cookie secret with `openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n' > local/cookie-secret`. Set `local/` to mode `0750` and its files to `0640`. Make them readable by the container user or group `65532` on the pilot host.

Run the commands from this directory. Start with an environment that has no `GWRK_PROOF_*` overrides.

```sh
./preflight.sh
docker compose --env-file .env -f compose.yaml up -d
docker compose --env-file .env -f compose.yaml ps
```

## Check live acceptance

Run the checks from outside the pilot network. Record the date, deployed commit, host, DNS owner, Google client owner and outcome for each row. Keep the record and account identities in operator-managed storage.

| Check | Expected result |
|---|---|
| DNS lookup | Pilot host address |
| TLS request | Trusted public certificate for `gwrk.gforge.ai` |
| Anonymous HTTPS request | Same-origin sign-in redirect |
| Allowed Google account | Status response after returning from Google |
| Denied Google account | No status response |
| Forged identity headers | No status response |
| Write request with a valid session | HTTP 405 |
| Direct port probes for 4180 and 8080 | Connection blocked |
| Browser sign-out | Next status request needs sign-in |
| Expired cookie | Status request needs sign-in |
| Revoked account with a valid session | Status request needs sign-in after proxy restart |

Update the allowlist by replacing the file inside `local/` with an atomic rename. Preserve its owner, group and permissions. Restart the proxy with `docker compose --env-file .env -f compose.yaml restart oauth2-proxy`. Measure from file replacement to denial using the same session. Sign-out clears the browser cookie. A copied cookie expires after one hour unless an allowlist removal denies it sooner.

Run `node tests/hosted-auth-proof/gateway-proof.mjs` from the repository root to verify the bundle with a test issuer. A fixture result leaves live acceptance pending.

## Remove the proof

Remove the DNS record, stop the Compose project with `docker compose --env-file .env -f compose.yaml down --volumes` and remove the Google client if it was created for this proof. Delete the local secret copies and release the pilot host and public address. Record the teardown date.
