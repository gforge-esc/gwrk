# Hosted pilot handoff

Core features 044 through 050 prepare the interfaces for hosted pilot 051 and project rollout 052. Core implementation is still under review. This document does not authorize or record a live deployment. Blocked: final core clearance and operator-supplied host inputs.

## Interface map

| Boundary | Contract | Pilot responsibility |
|---|---|---|
| Browser sign-in | [Hosted gateway surface](../../specs/041-hosted-google-signin-proof/contracts/gateway-surface.md) | Connect approved human routes to the private gwrk origin |
| Project identity | [Registry port](../../src/ports/store-port.ts) | Enroll repository identity and project role bindings |
| Slack authorization | [Project identity specification](../../specs/048-project-identity-slack/spec.md) | Verify workspace and channel membership with real accounts |
| Dispatch and harvest | [Coordinator contracts](../../specs/049-durable-dispatch-harvest/contracts/coordinators-routes-and-cli.md) | Verify durable receipts and recovery on the hosted runner |
| Notifications | [Notification port](../../src/ports/notification-port.ts) | Verify destination receipts and uncertain-send reconciliation |
| Model qualification | [Evidence and lock contract](../../specs/047-model-qualification/contracts/evidence-and-lock.md) | Qualify the Linux runner independently of workstation pins |
| Process and credentials | [Supervision contract](../../specs/050-linux-runner-deploy-packaging/contracts/supervision-and-preflight.md) | Supply the dedicated service user and unattended credentials |
| Release and restore | [Backup and pilot record](../../specs/050-linux-runner-deploy-packaging/contracts/backup-rollback-and-pilot-record.md) | Record the installed digest and observed restore proof |

An interface listed here does not imply its current phase is cleared. Use the latest [implementation checkpoint](checkpoints/2026-11-23-1653-phase-boundary.md) for review status. Final delivery must supply the final PR heads and combined verification receipt.

## Hosted pilot 051

The [sign-in proof](../../deploy/hosted-auth-proof/README.md) uses a disposable read-only origin. Its successful synthetic tests do not establish authentication for the full gwrk service. The pilot must connect the approved routes to the private origin. Project authorization remains separate from Google sign-in.

The intended hosting target is David's AWS account at `gwrk.gforge.ai`. AWS provisioning has not started. The pilot must select the account and region. The operator supplies the host and persistent storage. DNS and HTTPS must resolve `gwrk.gforge.ai`. Google web client configuration must use the approved same-origin callback. Supply the intended allowlist and test accounts. Record allowed and denied account results in the [live sign-in record](../../deploy/hosted-auth-proof/live-acceptance.example.md).

Use the reviewed [Linux runner bundle](../../deploy/linux-runner/README.md). Supply repository-scoped Git credentials and the approved headless agent credential. Record installed adapter availability separately from credential success. Verify a systemd restart on the real host. A container process restart does not establish that result.

Record the release digest and private service bind. Record one accepted operation and its project identity. Restart during unfinished work and verify recovery without another external effect. Preserve the merge commit and gate receipt for harvest. Record a delivered notification's workspace and channel. Record its thread and message timestamps. Exercise uncertain-send recovery against the same metadata key.

The pilot needs separate evidence for backup restoration and rollback. Use the [live pilot record](../../deploy/linux-runner/live-pilot-record.example.md). Keep pending fields pending until observed. Telegram remains disabled.

David has an existing Google CLI configuration for skills-connection. Inspect the configured account and project before setup. Preserve that configuration and use a separate gwrk configuration. Run `gcloud init` if needed. Alert David when Google-auth setup is ready. Complete available steps through the CLI or Chrome. Give a manual punch list only for steps those tools cannot complete. Verify the chosen setup's costs before cloud changes.

## Hosted security acceptance

Human login and API credential security are required deployment gates. David confirmed this requirement on November 23. The production authentication adapter remains pilot work. A principal role binding does not verify the caller's credential.

| Boundary | Required behavior | Acceptance evidence |
|---|---|---|
| Human login | Verify Google sessions against the approved account allowlist | Allowed account succeeds and denied account fails |
| API authentication | Verify scoped credentials before producing a `cli_token` principal | Missing or invalid credentials receive an API denial |
| Project authorization | Enforce project roles after authentication | One project's credential cannot operate another project |
| Key lifecycle | Support issuance and expiry plus revocation and rotation | Expired and revoked credentials cannot trigger effects |
| Credential storage | Store inbound key verification material without plaintext keys | Repository and browser exports contain no API secrets |
| Provider secrets | Keep recoverable provider credentials in protected server storage | Logs and responses reveal no credentials |
| Network boundary | Keep the gwrk origin private behind HTTPS access controls | Direct origin probes and forged identity headers fail |

Inventory every public route before exposing the service. Deny access by default. Google sign-in and callback routes need explicit handling. Provider webhooks require their own verified signatures and replay controls. API clients must receive machine-readable authentication errors rather than an interactive sign-in page.

Never trust caller-supplied identity headers from the public network. Only the verified gateway or credential adapter may create an authenticated principal. Keep provider tokens distinct from credentials that authorize access to gwrk. Protect session cookies and browser mutations against cross-site request forgery.

Record failed authentication and denied operations without logging secrets. Apply bounded request handling and abuse controls. Verify that anonymous requests and unauthorized project requests produce no dispatch or harvest effect. Record secret rotation and credential revocation results in the live pilot evidence. Passing the read-only sign-in proof does not complete these production API checks.

## Project rollout 052

The user supplies the intended project roster. Each enrollment needs a repository and trunk. It also needs an approved runner policy and checkout location. Slack enrollment needs the workspace and channel identities. Assign project roles before dispatching work.

Verify one project's complete lifecycle before adding the next. Preserve the accepted `operationId` across dispatch recovery. Verify harvest against the repository's merge commit. Check the destination receipt in the enrolled feature thread. Confirm another project cannot authorize or claim that work.

Qualify models within the hosted runner's workspace and runner profile. Discovery alone does not promote a model. Promotion requires deterministic gates and the agreed repeat floor. It also requires two independent judges from distinct providers and families. Keep the incumbent when evidence or judge availability is incomplete. Record prompt and fixture hashes with the promoted pin.

The final rollout record must distinguish daemon liveness from project readiness. It must include delivery status and unresolved harvest findings. Closing the laptop is a live pilot observation. Core synthetic verification does not establish always-on service behavior.
