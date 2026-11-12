# Project identity and Slack routing

Route each Slack action and receipt to an enrolled repository through an explicit project binding. Blocked for integration until port and adapter separation passes review. Live delivery needs an authorized test workspace.

## Requirements

- Enroll a stable repository identity with its trunk, local root or mirror, allowed runner and Slack binding. Preserve existing records keyed by legacy project identity.
- Resolve workspace, channel, Slack user and requested project before accepting work. Reject ambiguous shared-channel and direct-message requests until the caller selects a project. Require project roles for repository mutations.
- Pass the resolved project ID and recipient through dispatch, status, notification and Slack action handlers. Use the stored project and feature thread for replies. Authorize button actions again at click time.
- Preserve local single-project use through an explicit enrollment or a compatible local entry point. Deny remote requests without a matching project and authorization.
- Distinguish daemon liveness from project readiness and Slack delivery. Keep operations routing explicit.
- Use two test repositories with matching feature and branch names to prove that reads, writes and notifications stay in scope.
- Provide the project and recipient contract for durable dispatch and harvest. Keep Telegram disabled in the hosted pilot.

[Daily-driver audit](../../docs/research/2026-11-11-daily-driver-audit.md) · [Hosted server brief](../../docs/research/R013-hosted-gwrk-server/brief.md)
