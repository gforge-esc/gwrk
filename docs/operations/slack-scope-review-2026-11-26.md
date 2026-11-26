# Slack scope review

Slack routing was part of core implementation. Live Slack activation and project rollout remain incomplete. Blocked: the hosted service disables Slack and has no Slack credentials or project bindings. A rollout executor must close these gaps before Slack acceptance.

## Review boundary

Reviewed November 19 through November 26 in 2026. Sources include repository history across local refs and the core implementation chat. They also include feature contracts and deployment evidence. A read-only host inspection on November 26 establishes the current configuration. This review changed no service configuration and sent no Slack messages.

## Scope and delivery

| Work | Recorded outcome | Slack boundary |
|---|---|---|
| Core features 044 through 050 | Merged November 23 in [core PR 240](https://github.com/gforge-esc/gwrk/pull/240) | Project identity and Slack routing included as feature 048 |
| Durable dispatch and harvest, feature 049 | Integrated with core | Persisted recipient and notification recovery contracts |
| Hosted AWS pilot, feature 051 | Merged November 25 in [pilot PR 241](https://github.com/gforge-esc/gwrk/pull/241) | Live project rollout explicitly deferred |
| Portal authentication repairs | Merged November 25 in [portal PR 242](https://github.com/gforge-esc/gwrk/pull/242) | Live browser and API acceptance |
| Consumer release and plugin handoff | Ongoing beta 2 preparation | No live Slack acceptance |
| Project rollout, feature 052 | Referenced downstream work | No specification directory in this checkout |

The [core final review](core-final-review.md:64) explicitly states that Slack verification used isolated fixtures. It records no live project enrollment or Slack message. The [November 25 ecosystem audit](2026-11-25-ecosystem-handoff-audit.md:128) still requires real-account Slack evidence. The [hosted specification](../../specs/051-hosted-aws-pilot/spec.md:33) reserves project rollout for feature 052.

Feature 048 covers repository enrollment and workspace routing. It adds project roles and click-time authorization. It also covers replay protection and scoped feature threads. Presence queues and readiness reports follow project boundaries. Its [specification](../../specs/048-project-identity-slack/spec.md) does not require a new visual design.

## Live host findings

Read-only inspection used the existing verified SSH host entry. It queried only the Slack enable flag, credential-file presence and project-routing records. It read no credential values.

| Check | Required state | Observed state | Verdict |
|---|---|---|---|
| Runner process | Active | Active | Passes |
| Slack enable flag | `1` | `0` | Fails |
| Slack bot credential | Present | Absent | Fails |
| Slack app credential | Present | Absent | Fails |
| Enrolled work projects | Intended repositories | Two pilot probe projects | Fails |
| Project Slack bindings | Verified workspace and channel | Neither pilot project bound | Fails |
| Slack user roles | Explicit project grants | Zero records | Fails |
| Feature thread receipts | Live acceptance evidence | Zero records | Unmeasured |

The active release resolves to `/opt/gwrk/releases/1.6.0-beta.1`. The last recorded accepted deployment is the portal repair commit `bb15497b`. This inspection did not reverify its source digest.

The connected Slack tool exposes the workspace named `gforge-esc`. David referred to `gonzo-esc`. The installed app's workspace ID and app ID must settle that difference before credential installation. The tool does not expose the installed gwrk app's manifest or current Socket Mode connections.

The hosted runner cannot update App Home in this state. Another workstation process might still use the installed app. This review did not establish whether such a process exists.

## App and manifest gaps

The current [App Home builder](../../src/server/slack-home.ts:70) retains the Operations Dashboard. It adds access-filtered enrolled projects. Agent, queue and plan sections require a uniquely matched startup project. That condition does not provide a selected-project dashboard for a shared hosted runner.

App Home publishes when the service handles `app_home_opened`. No connected service means no fresh view from that service. Slack documents this event and [view publication](https://docs.slack.dev/tools/bolt-js/concepts/publishing-views/).

The core merge added `channels:history` to the [manifest](../../src/slack-manifest.yml:26). Existing installations need reauthorization for newly requested scopes. See [Slack's app lifecycle rules](https://docs.slack.dev/app-management/distribution/). The installed app's granted scopes remain unverified.

The manifest subscribes only to `app_home_opened` and `app_mention`. The [server](../../src/server/slack.ts) also registers a direct-message handler. The [action handler](../../src/server/slack-actions.ts:937) registers `reaction_added`. Reconcile those capabilities with event subscriptions and required scopes before advertising them. The manifest currently disables the Messages tab.

The app description still calls gwrk a local build server. The slash-command hint omits explicit project selection. Both need to reflect hosted project operation.

## Required work

1. Establish the intended workspace and existing app IDs. Inspect the installed manifest and granted scopes. Locate any old Socket Mode consumers before assigning the hosted service as the command executor.
2. Reconcile the manifest with supported capabilities. Include the receipt-history scope. Add the required event subscriptions for retained direct-message and reaction features. Reauthorize the existing installation when scope changes require it.
3. Install protected bot and app credentials on the hosted runner. Enable Slack through the existing Linux runner configuration. Verify the connected workspace identity and delivery status separately from daemon liveness.
4. Enroll one real repository on the host. Bind its workspace, feature channel and operations channel. Grant explicit Slack user roles. Google login does not grant a Slack role.
5. Update App Home for the hosted model. Provide explicit project selection and project readiness. Show durable operations and harvest state. Surface delivery failures. Keep host resources separate from project status. Publish release identity and links to the portal and consumer guide.
6. Run real-account acceptance. Verify status and a bounded dispatch. Check click-time authorization and cross-project denial. Record the feature thread and delivered message IDs. Restart during accepted work and prove recovery without duplicate execution or notification. Exercise uncertain-send reconciliation with the granted history scope.

Keep Slack transport in adapters. Pass workspace, actor and selected project to the existing project-routing service. Reuse durable dispatch, harvest and notification ports. Keep routing policy in the domain. Slack must not maintain a second workflow state store or choose repositories from the server's working directory.

Track activation and first-project acceptance under the deferred project rollout. Treat App Home modernization and manifest parity as explicit deliverables. Core fixture completion remains valid. A Slack-ready product claim requires the live evidence above.

## Acceptance boundary

Done means the existing installation displays a current authorized project view. It completes one real project operation with attributable delivery receipts. It must deny unauthorized actions and recover accepted work after restart. This review establishes the missing work. It does not record Slack deployment or live acceptance.
