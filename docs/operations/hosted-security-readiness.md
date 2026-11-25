# Hosted security readiness

Do not expose this server publicly yet. The `07cb062a` audit baseline predates feature 051 implementation. Feature 051 implements the hosted authentication and gateway controls in source. Blocked: public exposure remains blocked pending native Linux proof and operator live acceptance. The pilot owner owns exposure clearance.

Audit source is `07cb062a` on November 23. The intended deployment target is David's AWS account at `gwrk.gforge.ai`. Account and region selection remain pending. This audit made no deployment or external authentication change.

## Existing boundaries

| Boundary | Current behavior | Source |
|---|---|---|
| Hosted mode | Derives hosted access from runtime or a non-loopback listener | `src/server/index.ts:325` |
| Principal port | Accepts verified `google_sub` or `cli_token` identities | `src/server/index.ts:91` |
| Project access | Rejects a missing hosted principal and enforces project roles | `src/domain/slack-routing.ts:411` |
| Role binding | Stores a project principal identifier and role | `src/domain/project-registry.ts:32` |
| Production startup | Does not supply a principal verifier | `src/commands/server.ts:108` |
| Private bind | Linux preflight checks a private listener and matching configuration | `deploy/linux-runner/preflight.sh:63` |
| Runner secrets | Reads permission-checked files for Git and agent credentials | `deploy/linux-runner/credentials.sh:8` |
| Process isolation | Runs as the dedicated user with restricted writable paths | `deploy/linux-runner/gwrk-runner.service:12` |

The principal port performs no Google session or API credential verification itself. A `cli_token` binding is not an issued API credential. Inbound credential verification material must remain distinct from outbound provider secrets. Provider credentials must remain recoverable by their server adapters.

## Explicit native route registrations

| Route | Core access boundary | Source | Exposure gate |
|---|---|---|---|
| `GET /api/status` | Verified hosted principal and read role | `src/server/routes/status.ts:147` | Production authentication |
| `POST /api/dispatch` | Verified hosted principal and operate role | `src/server/routes/dispatch.ts:98` | Production authentication |
| `GET /api/dispatch/queue` | Verified hosted principal and read role | `src/server/routes/dispatch.ts:216` | Production authentication |
| `GET /api/dispatch/:feature/:phase` | Verified hosted principal and read role | `src/server/routes/dispatch.ts:237` | Production authentication |
| `POST /api/notify` | Verified hosted principal and operate role | `src/server/routes/notify.ts:68` | Production authentication |
| `GET /health` | No principal check | `src/server/routes/health.ts:165` | Keep private or protect detailed output |
| `GET /api/health` | No principal check | `src/server/routes/health.ts:166` | Keep private or protect detailed output |
| `POST /webhook/github` | Conditional raw-body signature verification | `src/server/github.ts:221` | Repair missing-secret acceptance |

The health response includes project readiness. Its project entries contain repository identity and checkout paths. A public minimal liveness response must not expose this detailed response. [Readiness projection](https://github.com/gforge-esc/gwrk/blob/07cb062a4101fb0004be499ee51766693addca22/src/server/routes/health.ts#L63)

Slack uses Socket Mode rather than a registered native HTTP webhook. [Slack setup](https://github.com/gforge-esc/gwrk/blob/07cb062a4101fb0004be499ee51766693addca22/src/server/slack.ts#L45)

Route authorization options reach status and dispatch plus notify. Health receives no principal resolver. The webhook uses its provider signature boundary. [Server composition](https://github.com/gforge-esc/gwrk/blob/07cb062a4101fb0004be499ee51766693addca22/src/server/index.ts#L510)

## Core webhook finding at audit source

The approved durable ingress contract requires raw-body HMAC verification before committing webhook intake. That requirement already belongs to core feature 049. [Ingress contract](https://github.com/gforge-esc/gwrk/blob/07cb062a4101fb0004be499ee51766693addca22/specs/049-durable-dispatch-harvest/contracts/coordinators-routes-and-cli.md#L126)

At the audit source, `githubWebhookPlugin` verifies signatures only when a secret is truthy. `ingestWebhook` also skips verification when its secret is undefined. Startup warns that the endpoint will be disabled. The registered route remains active. [Route guard](https://github.com/gforge-esc/gwrk/blob/07cb062a4101fb0004be499ee51766693addca22/src/server/github.ts#L243). [Coordinator guard](https://github.com/gforge-esc/gwrk/blob/07cb062a4101fb0004be499ee51766693addca22/src/application/harvest/index.ts#L1067). [Startup warning](https://github.com/gforge-esc/gwrk/blob/07cb062a4101fb0004be499ee51766693addca22/src/server/index.ts#L379).

A synthetic unsigned merge request targeted a real enrolled project with hosted runner policy. The test used the real SQLite registry and durable harvest service. It disabled automatic resume to prevent Git or notification effects.

| Assertion | Required result | Observed result | Verdict |
|---|---|---|---|
| Unsigned intake without a configured secret | Denial | HTTP 200 accepted | FAIL |
| Harvest operation count | Zero | One persisted row | FAIL |
| Harvest delivery count | Zero | One persisted row | FAIL |

The route test is `src/server/github.test.ts`, named `TR-002 security regression`. It fails one test through three soft assertions. Direct coordinator cases also fail for absent and whitespace secrets. The empty-string case already denies intake. All cases verify zero external effects. The combined run reports three failed tests and one passed test. No production repair occurred during this audit.

The patch and logs remain under `.runs/security-readiness-nov23/`. `manifest.json` records their hashes. The combined regression patch is `unsigned-webhook-route-and-application.patch`. The root coordinator must preserve this RED evidence before dispatching repair.

Configured-secret verification already checks the raw-body HMAC with constant-time comparison. Delivery deduplication also rejects changed payload digests for a reused delivery ID. These controls do not compensate for an absent secret. [Signature adapter](https://github.com/gforge-esc/gwrk/blob/07cb062a4101fb0004be499ee51766693addca22/src/adapters/github/index.ts#L103), [delivery conflict check](https://github.com/gforge-esc/gwrk/blob/07cb062a4101fb0004be499ee51766693addca22/src/db/operations.ts#L939)

## Pilot gaps

The Google proof protects a fixed Nginx response. It does not proxy the gwrk service. Its public paths are `/` and `/status` plus selected OAuth routes. The proxy strips caller identity headers and Authorization. Its service target is the fixed proof origin. [Proxy routes](https://github.com/gforge-esc/gwrk/blob/07cb062a4101fb0004be499ee51766693addca22/deploy/hosted-auth-proof/traefik/dynamic.yaml#L3), [fixed response](https://github.com/gforge-esc/gwrk/blob/07cb062a4101fb0004be499ee51766693addca22/deploy/hosted-auth-proof/status/default.conf#L8)

The proof configures an account allowlist and secure session cookies. It also configures PKCE and OAuth CSRF state. Those controls do not implement browser mutation protection for the full API. [Session configuration](https://github.com/gforge-esc/gwrk/blob/07cb062a4101fb0004be499ee51766693addca22/deploy/hosted-auth-proof/oauth2-proxy/oauth2-proxy.cfg#L8)

The production gateway must verify human sessions and automation credentials before creating a principal. It must retain API authorization headers for its verifier while stripping forged identity headers. API clients need machine-readable authentication denials. The proof's interactive redirects and stripped Authorization cannot serve as that API adapter unchanged.

Inbound API credentials need issuance and project scope. They also need expiry and revocation plus rotation. Store credential verification material rather than plaintext inbound keys. Keep plaintext provider credentials in protected server storage. Do not put either credential class in browser responses or tracked project configuration.

The server enables request logging. This source does not configure a gateway-level rate limiter or explicit credential redaction policy. The pilot must test its complete logging path with synthetic secret values. It must also test bounded requests and per-credential abuse controls. [Server construction](https://github.com/gforge-esc/gwrk/blob/07cb062a4101fb0004be499ee51766693addca22/src/server/index.ts#L320)

## Implemented feature 051 security controls

Feature 051 replaces baseline gaps with explicit authentication and gateway controls.

| Control area | Baseline behavior at 07cb062a | Implemented feature 051 behavior |
|---|---|---|
| Liveness endpoint | Unprotected detailed `/health` | Private minimal `GET /health` with zero project leaks |
| Readiness endpoint | Unprotected detailed `/api/health` | Authenticated scoped `GET /api/health` filtered to project |
| Remote status probes | Unprotected remote status checks | Origin-bound HTTPS status flags rejecting redirects |
| Browser authentication | Nginx proof only | Google OIDC with PKCE and session cap |
| Account allowlist | Static proof configuration | Live allowlist reload on every browser authentication |
| Revocation | Absent | Immediate token digest and API key revocation |
| API credentials | Local CLI token binding only | Opaque project-scoped keys with SHA-256 verifiers |
| Key rotation | Absent | Atomic key rotation with overlap interval |
| Gateway TLS | ACME proof bootstrap | Preissued certificates with preflight validation |
| Local compatibility | Ambient dev environment | Preserved local workflows without auth configuration |
| Initialization | Ambient config discovery | Zero inference calls and zero secret reads on init |
| Live acceptance | Unspecified | Pending operator live acceptance |

## Required exposure acceptance

| Test group | Required evidence | Owner |
|---|---|---|
| Human identity | Allowed account succeeds and denied account fails | Pilot |
| Session lifecycle | Expired and revoked sessions fail | Pilot |
| Browser mutations | Forged cross-site session requests cause no effect | Pilot |
| API credentials | Missing and malformed credentials receive JSON denial | Pilot |
| Credential lifecycle | Expired and revoked keys cause no effect | Pilot |
| Project roles | Valid project A identity cannot operate project B | Pilot |
| Origin isolation | Direct origin probes and forged identity headers fail | Pilot |
| Detailed health | Anonymous requests reveal no project metadata | Pilot |
| Webhook authentication | Missing-secret and invalid-signature requests create no rows | Core repair and pilot |
| Webhook replay | Replays reuse receipts and changed payload reuse fails | Pilot |
| Secrets and logs | Canary credentials never appear in logs or responses | Pilot |
| Abuse controls | Over-limit requests fail without accepted work | Pilot |

The reviewed repair rejects missing or blank secrets at both boundaries. Independent build and lint pass. All 48 focused tests pass. A broader server integration run passes 85 tests. See [core repair evidence](https://github.com/gforge-esc/gwrk/blob/89ac728be54c07d1bd50fde0bc04cbab058d644c/specs/049-durable-dispatch-harvest/evidence/nov23-webhook-authentication-repair.md). The final combined macOS and native Linux suites retain those cases and pass. Required final-head CI controls merge readiness. Keep public exposure blocked until production authentication and the route inventory pass their pilot acceptance tests. Then verify the real private origin and HTTPS boundary from outside the host. The read-only proof alone cannot clear that gate.

No live account or credential was inspected. No full test suite ran during this audit. The two characterization cases passed. The original audit retained the enrolled route and direct coordinator RED evidence. All probes used synthetic payloads and temporary local state.
