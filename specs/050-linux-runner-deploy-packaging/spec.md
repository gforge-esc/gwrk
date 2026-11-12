# Linux runner and deployment packaging

Package a versioned gwrk server and one supervised Linux worker for the hosted pilot. Blocked for pilot rollout until the hosted sign-in proof and a Linux runner identity are available.

## Requirements

- Build and verify a Linux release from a pinned source commit. Record the runtime, plugin set and release digest.
- Run the server on a private interface under a dedicated service identity. Start after reboot and recover without creating a second worker or Slack consumer.
- Verify that the runner can authenticate unattended to one pilot repository and its approved agent backend. Keep the existing laptop credentials outside the package.
- Separate release files, persistent state and runtime secrets. Document how the operator supplies each secret and revokes the service credentials.
- Back up the ledger and repository metadata with a consistent procedure. Restore into a clean instance and verify accepted work, project identity and run history.
- Test upgrading and rolling back with persistent state. Keep accepted work when reverting to the prior compatible release.
- Keep the Google gateway as the browser boundary. Leave project authorization and real Slack enrollment for the integrated pilot.

## Acceptance

1. A clean Linux environment verifies and runs the versioned artifact without a source checkout.
2. A supervised restart preserves state and resumes with one server and one worker.
3. A backup restored into a clean environment preserves the seeded project and accepted work.
4. A release rollback either preserves accepted work or stops before changing the active release.
5. A pilot operator records the host, credentials and observed worker run separately from synthetic verification.

[Hosted server brief](../../docs/research/R013-hosted-gwrk-server/brief.md) · [Daily-driver audit](../../docs/research/2026-11-11-daily-driver-audit.md)
