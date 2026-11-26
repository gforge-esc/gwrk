# Daily-driver audit and implementation sequence

Move coordination to an always-on server after gwrk can isolate projects and recover work. Keep Slack in Socket Mode and use Google sign-in for human access to the server. Blocked: none for preparation. Live rollout requires host access and test credentials for the intended accounts.

## Current state

| Surface | Observed state | Gap |
|---|---|---|
| Laptop daemon | `gwrk server status` reports stopped | No always-on process |
| Hosted endpoint | New deployment at `gwrk.gforge.ai` | Provision DNS and HTTPS |
| Server scope | Startup working directory | No per-request project selection |
| Slack | Socket Mode, commands, actions and webhook fallback | Startup project and implicit recipient |
| HTTP dispatch and notify | No auth in these routes | Local trust model |
| Command-line status | Local PID check and plain HTTP URL | No authenticated remote status |
| Dispatch recovery | Append-only log and in-memory queue | No startup replay in the dispatch queue |
| Harvest | GitHub webhook, poller and manual entry | Partial completion can suppress retries |
| Telegram | One configured chat and polling adapter | Single-project routing |

The laptop has sleep enabled. The macOS LaunchAgent starts on login and restarts on crash. An awake process is still required to receive Slack events and run the poller. The daemon already pauses on sleep or network loss and resumes after checks. It has no verified restart recovery in this audit. [Daemon startup](../../src/server/index.ts) · [LaunchAgent setup](../../src/commands/server-install.ts) · [Queue](../../src/server/dispatch.ts) · [Dispatch log](../../src/server/persistence.ts)

## Project and Slack inventory

The inspected projects did not share a complete Slack setup. One project had a channel mapping. The bot authenticated but could not look up that channel. Verify the active project roster, channel identity and app membership during enrollment. Socket connectivity and message delivery remain unmeasured.

Slack handlers inherit one project root. Notification routing can also load config from the process directory. Presence chooses the first matching workspace user and holds queued events in memory. Capture a project ID and recipient when accepting a command or notification. Require explicit selection in direct messages and shared channels. Check workspace, channel and user authorization before mutating a repository. [Slack startup](../../src/server/slack.ts) · [Slack commands](../../src/server/slack-commands.ts) · [Notifications](../../src/server/slack-notify.ts) · [Presence](../../src/server/slack-presence.ts)

## Desired experience

| User action | Expected evidence |
|---|---|
| Enroll a project | GitHub repository, trunk, runner and Slack route in status |
| Ask Slack for status | Correct project and phase with links |
| Dispatch a phase | Run ID, selected model and authorization result |
| Review a pull request | Project thread with gates and review verdict |
| Merge to trunk | Harvest receipt with merge SHA and gate outcome |
| Ask for project health | Queue, last harvest and delivery lag by project |
| Close the laptop | Slack, GitHub ingest and capable hosted workers still operate |
| Reconnect a local worker | Pending local work resumes with its recorded run identity |

Register projects by stable repository identity. Resolve inbound Slack workspace and channel against an allowlisted project binding. Resolve GitHub events by repository identity and configured trunk. Stamp project ID on every queue item, run record and outbound event. Include project status in Slack App Home and keep cross-project alerts in a configured operations channel. Put the feature lifecycle in one thread per project and feature.

Give CLI clients an HTTPS server URL and machine or user credential with explicit scopes. Distinguish daemon liveness from remote connectivity and project readiness. In JSON mode today, `gwrk status` can return project information with exit zero even when it has no server result. Add separate fields and test failure handling before using it as deployment evidence. [Status command](../../src/commands/status.ts) · [Health route](../../src/server/routes/health.ts) · [Dispatch route](../../src/server/routes/dispatch.ts) · [Notify route](../../src/server/routes/notify.ts)

## Hosted design

[R013, hosted gwrk server](R013-hosted-gwrk-server/brief.md) scopes the first deployment. Its Google sign-in proof can start alongside the core work.

Use a dedicated Linux runner with persistent storage and a supervised daemon as the first deployment candidate. The gforge.ai repo documents AWS EC2 and Traefik. Reuse its deployment pattern after checking access and capacity. Give gwrk a separate service, data volume and runner identity. Use the laptop for optional jobs that require local credentials or unpushed files.

Terminate HTTPS at Traefik. Put OAuth2 Proxy with Google sign-in in front of human routes at `gwrk.gforge.ai`. Allow the intended Google identities and apply project authorization in gwrk. Keep the service bound to a private interface. Use short-lived scoped credentials for unattended CLI calls and workers. Reject forged proxy identity headers and direct service access. [OAuth2 Proxy Google provider](https://oauth2-proxy.github.io/oauth2-proxy/configuration/providers/google/)

Keep the Slack Socket Mode connection outbound. Use a separate signed GitHub ingress route if webhook mode is enabled. Verify the signature against the raw request body and check repository scope. Persist the delivery before acknowledging it. Use the GitHub delivery ID to deduplicate transport retries and a work key to deduplicate harvest. Start with polling in the pilot if it meets the recovery requirement. [Slack Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/) · [GitHub webhook guidance](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)

Verify Linux versions and headless sign-in on the runner. Check quotas and exact model pins there. Catalog access on the laptop supplies no evidence of server entitlement. Keep personal and work credentials separate. Route only jobs the worker is configured to run. If a route requires the laptop, report that constraint and keep the job queued while it is offline.

## Harvest failure and recovery

| Step | Current failure mode | Required behavior |
|---|---|---|
| Accept | Webhook acknowledges work held in process | Durable receipt before success |
| Discover | Poller scans latest 40 pull requests | Per-repo cursor and catch-up |
| Check out | Sync can leave the active tree on another commit | Isolated checkout at merge SHA |
| Reconcile | Run can become merged before gate work finishes | Separate merge and harvest states |
| Measure | Compression row can mark later work done | Explicit state for each stage |
| Notify | Done-done uses operations routing | Project thread and delivery receipt |
| Clean up | Branch cleanup can fail after harvest records completion | Safe retries with branch identity |

The retry guard returns when it sees a merged run or a compression record. Those writes can precede gate reconciliation, Slack delivery and branch cleanup. A crash between steps can leave those steps pending with no retry. The webhook and poller share a branch parser. The webhook limits trunk to main or develop. The poller detects the default branch. Route all three entry points through one project-scoped application service. [Harvest engine](../../src/engine/harvest.ts) · [Webhook](../../src/server/github.ts) · [Poller](../../src/server/harvest-watcher.ts) · [Manual harvest](../../src/commands/harvest.ts) · [Git synchronization](../../src/utils/git.ts)

Key the operation by repository and pull request. Include the terminal event, merge SHA and phase where applicable. Keep an execution lease and per-step receipts. Use a durable outbox for Slack and reconcile uncertain sends against the stored message identity. Resume incomplete stages after restart. Keep git as the authority for task state and run manifests. Give the ledger responsibility for event intake, processing and delivery. Surface gate failures and missing forecasts separately from success. Closed unmerged pull requests update attempt state without marking a phase done. [Architecture decision index](../../.gwrk/decisions/index.md)

## Telegram audit

The adapter polls one configured chat. It forwards commands through the control plane and can mirror Slack notifications. It inherits one project root. Keep Telegram disabled in this rollout. Future work can reuse project lookup, authorization and delivery receipts. Telegram-specific work would cover chat identity, update cursors and command parity. [Telegram adapter](../../src/server/telegram.ts) · [Telegram notifications](../../src/server/telegram-notify.ts)

## Implementation sequence

| Step | Work | Exit evidence |
|---|---|---|
| 1 | Domain purity and port separation | Boundary and effect gates pass |
| 2 | Unified routing and prompt delivery | Definition, implementation and review share the dispatch contract |
| 3 | Model discovery and qualification | Two judges and deterministic gates support each promoted pin |
| 4 | Project registry and Slack routing | Two repositories with matching feature IDs remain isolated |
| 5 | Durable dispatch and harvest | Restart and duplicate delivery tests converge |
| 6 | Hosted pilot and Google sign-in | One project completes while the laptop sleeps |
| 7 | Active project rollout | Each enrolled project passes the daily-driver checklist |

Steps 3 and 4 can proceed in parallel after their dependencies pass. Start project registration and identity design after port separation. Keep the self-assessment's architecture-aware policy selection, governance visibility and hermetic integration work in its existing sequence. Use those gates in the delivery work. [Self-assessment sequence](../architecture/assessments/2026-11-11-self-assessment/report.md) · [Model qualification plan](2026-11-11-model-qualification.md)

Use the self-assessment feature specs as `gwrk define spec --refs` and `gwrk define plan --refs` inputs. Include this audit for operations features. Use the model qualification brief for routing work. Run definition and analysis with a qualified frontier route when available. Bootstrap with an explicit tested route and record the invocation evidence until pins ship. Generate tests and tasks from the reviewed plan. Inspect `gwrk ship <feature> --dry-run` first. Launch one guarded phase at a time with `gwrk ship <feature> <phase> --worktree --max-iterations 2` in the background. Follow the repository's ship guard and verify gates and pull request evidence before the next phase.

## Pilot acceptance

1. Enroll two test repositories with the same feature IDs. Prove that Slack commands, GitHub events and reports stay within their project.
2. Exercise Google sign-in with allowed and denied identities. Verify CLI authentication and signed GitHub ingress independently.
3. Dispatch a hosted run from Slack and read its status from the CLI. Verify the selected model and gate evidence.
4. Sleep the laptop and restart the hosted service during a test merge. Deliver the same event again by polling or webhook. Verify one completed harvest and one visible project receipt.
5. Inject a gate failure and a Slack send failure. Verify honest status and a successful retry after repair.
6. Restore the persisted state into a test deployment. Verify the rollback preserves accepted work and avoids two active consumers.
7. Use `gwrk harvest` to replay an incomplete test operation. Verify the completed stages and Slack receipt remain stable.

The targeted suite passed 47 tests across nine files with one todo. It covered routing and Slack handler setup. It also covered Telegram, GitHub webhook handling and harvest paths. Live Slack delivery, real pull request harvest and hosted failover remain unmeasured. No active project roster or hosted credentials were verified in this audit.
