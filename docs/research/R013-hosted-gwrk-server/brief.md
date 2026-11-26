---
initiative: hosted-gwrk-server
prefix: R013
methodology: technical
status: open
created: 2026-11-11
---

# Hosted gwrk server

Start with a new deployment at `https://gwrk.gforge.ai`. Put Google sign-in in front of human access. Use one cloud host to prove that Slack, dispatch and harvest work while the laptop sleeps. Blocked: none for scoping.

## Pilot scope

| Component | First deployment | Acceptance evidence |
|---|---|---|
| Public endpoint | New DNS record and HTTPS for `gwrk.gforge.ai` | Valid certificate and protected status page |
| Human access | Google OpenID Connect and an explicit identity allowlist | Allowed user signs in and unlisted user receives a denial |
| Cloud host | Dedicated Linux instance with a supervised gwrk process | Service comes back after host reboot |
| State | Persistent ledger, project registry and Git mirrors | Restore from a tested backup |
| Slack | Socket Mode in one authorized test workspace | Project command and threaded receipt |
| GitHub | Installation credential for a pilot repository | Catch-up after a missed polling interval |
| Execution | One hosted worker with a tested CLI and pinned route | A gated phase runs with the laptop asleep |
| Harvest | Durable, project-scoped processing at the merge commit | Restart and repeat delivery preserve one outcome |

The pilot starts with a test repository. Exercise two repositories in staging to prove project isolation before enrolling real projects. Keep Telegram disabled. Keep local IDEs and desktops available for interactive work. The hosted worker is an additional execution target.

## Host and identity

Use a dedicated AWS EC2 instance as the first hosting candidate. The gforge.ai repository documents EC2 and Traefik. Public DNS for the parent domain uses AWS nameservers. The subdomain is a new allocation. The gforge.ai application deployment supplies a reference for operations. The gwrk service gets its own host, role and deploy pipeline. Confirm the cloud account and region. Check DNS ownership and estimate monthly cost during preflight. [AWS DNS guide](https://docs.aws.amazon.com/pdfs/Route53/latest/DeveloperGuide/route53-dg.pdf)

Use Traefik for HTTPS and OAuth2 Proxy for Google OpenID Connect. Register `https://gwrk.gforge.ai/oauth2/callback` on a dedicated Google web client. Start with explicit allowed identities. Map the verified Google issuer and subject to a gwrk user with per-project roles. If the gateway passes identity headers, strip client-supplied values and accept headers only from the gateway on a private connection. Test logout and session expiry. Verify access revocation. Protect browser mutations against cross-site request forgery. [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) · [OAuth2 Proxy and Traefik](https://oauth2-proxy.github.io/oauth2-proxy/next/configuration/integrations/traefik/)

| Caller | Credential | Authorization |
|---|---|---|
| Browser user | Google login and secure session cookie | User and project role |
| Local CLI client | Scoped gwrk credential for pilot access | Project and command scope |
| Hosted worker | Scoped service credential | Assigned queue and repository |
| Slack user | Socket Mode event and Slack identity | Workspace, channel and user binding |
| GitHub poller | GitHub App installation credential | Enrolled repositories |
| Optional GitHub webhook | Verified GitHub payload signature | Enrolled repository and event |

Google login covers interactive browser access. An unattended worker cannot rely on a browser session. Scope machine credentials separately and make them revocable. Start with repository-scoped polling. If signed webhooks follow, expose only the receiver path and persist accepted events before replying. [Slack Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/) · [GitHub App installation credentials](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)

## State and cutover

Keep one active queue and Slack consumer for the pilot. Store the ledger and repository metadata on an encrypted persistent volume. Make a consistent database backup and test restore on a second instance. Pin each deploy to an image or build digest. Verify backward compatibility before using the prior build for rollback. A rollback must keep all accepted work. [Amazon EBS snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html)

Seed the pilot from git and explicit enrollment. Move historical laptop records only where the user needs them and their project identity is known. Separate the test workspace from work credentials. Verify headless agent access on Linux. Configure a runner identity with permission only for its enrolled repositories. Track the last Slack connection and poll cursor. Show the oldest queued item and last completed harvest.

## Work sequence

| Work | Can start when | Exit evidence |
|---|---|---|
| Cloud and Google sign-in proof | Scoping brief | Allowed and denied sessions on a disposable status endpoint |
| Project identity and authorization | Port separation | Two test repositories stay isolated |
| Dispatch and harvest recovery | Project identity contract | Restart and replay tests pass |
| Linux runner and deploy packaging | Cloud proof | Versioned release and restored ledger |
| Integrated pilot | Prior checks pass | Laptop-off dispatch, merge and Slack receipt |
| Active project enrollment | Pilot sign-off | Each project has a tested route and owner |

The cloud and Google sign-in proof can run alongside the architecture work. Keep the existing build server behind a private interface during the proof. Wire the real dispatch and notification routes only after they can enforce their respective authorization contracts. [Daily-driver audit](../2026-11-11-daily-driver-audit.md)

## Inputs for implementation

- Identify the cloud account and DNS administrator. Confirm the region and cost estimate before provisioning.
- Identify the owner of the Google web client and the first allowed Google identity.
- Choose the pilot repository and Slack workspace. Confirm a GitHub App installation and a Slack bot binding for that test project.
- Select an available hosted agent after checking Linux auth and model access. Use the resulting evidence for the worker contract.
- Draft the hosting and identity decision record. Feed this brief to `gwrk define spec` and `gwrk define plan` after the design review.
