# Hosted Google sign-in implementation plan

Prove Google sign-in through Traefik and OAuth2 Proxy before adding gwrk server features to the hosted pilot. Blocked for live acceptance until the host, DNS and Google client inputs are available.

### Phase 1: Deployment input validation

#### Files

- `deploy/hosted-auth-proof/preflight.sh` (NEW: Reject missing credentials, placeholders and wildcard allowlist entries)
- `deploy/hosted-auth-proof/.env.example` (NEW: Name the public host inputs)
- `tests/hosted-auth-proof/preflight.test.ts` (NEW: Verify the preflight accepts complete input and rejects unsafe input)

#### Test Strategy

| ID | Type | Target | Expected result |
|---|---|---|---|
| TR-002 | unit | `tests/hosted-auth-proof/preflight.test.ts` | Unsafe inputs fail before Compose runs |

#### Done When

```bash
pnpm exec vitest run tests/hosted-auth-proof/preflight.test.ts
```

### Phase 2: Isolated OpenID Connect fixture

#### Files

- `tests/hosted-auth-proof/oidc-issuer.mjs` (NEW: Issue signed identity tokens and verify the proof key for code exchange)
- `tests/hosted-auth-proof/gateway-proof.mjs` (NEW: Run the real gateway and private origin on isolated networks)
- `tests/hosted-auth-proof/compose.test.yaml` (NEW: Bind loopback test ports and select the synthetic issuer)

#### Test Strategy

| ID | Type | Target | Expected result |
|---|---|---|---|
| TR-001 | integration | `tests/hosted-auth-proof/production-bundle.test.ts` | Production issuer stays separate from the fixture |
| TR-002 | unit | `tests/hosted-auth-proof/preflight.test.ts` | Input preflight passes |

#### Done When

```bash
node tests/hosted-auth-proof/gateway-proof.mjs
```

### Phase 3: Google gateway bundle

#### Files

- `deploy/hosted-auth-proof/compose.yaml` (NEW: Pin images and publish the edge ports)
- `deploy/hosted-auth-proof/traefik/dynamic.yaml` (NEW: Require an authenticated session before proxying status)
- `deploy/hosted-auth-proof/oauth2-proxy/oauth2-proxy.cfg` (NEW: Require Google issuer, verified email and a secure cookie)
- `deploy/hosted-auth-proof/status/default.conf` (NEW: Serve the fixed read-only response)
- `tests/hosted-auth-proof/production-bundle.test.ts` (NEW: Check the production route, issuer and network boundaries)

#### Test Strategy

| ID | Type | Target | Expected result |
|---|---|---|---|
| TR-002 | unit | `tests/hosted-auth-proof/production-bundle.test.ts` | The production bundle has the configured boundaries |

#### Done When

```bash
pnpm exec vitest run tests/hosted-auth-proof/production-bundle.test.ts
node tests/hosted-auth-proof/gateway-proof.mjs
```

### Phase 4: Operations and live acceptance

#### Files

- `deploy/hosted-auth-proof/README.md` (NEW: Describe deployment, acceptance, allowlist revocation and teardown)
- `deploy/hosted-auth-proof/live-acceptance.example.md` (NEW: Record the proof host and acceptance evidence)

#### Test Strategy

| ID | Type | Target | Expected result |
|---|---|---|---|
| TR-003 | unit | `tests/hosted-auth-proof/production-bundle.test.ts` | The live acceptance example records pending checks |

#### Done When

```bash
pnpm exec vitest run tests/hosted-auth-proof/production-bundle.test.ts tests/hosted-auth-proof/preflight.test.ts
```

Record fixture execution and live evidence separately. The deployment still needs a public certificate and browser verification through Google.
