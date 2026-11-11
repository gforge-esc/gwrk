# Linux runner

Run one private gwrk server under systemd. Blocked for the live pilot until the host, gateway and credentials are ready.

## Install

1. Create the Linux `gwrk` user and group. Give them ownership of `/var/lib/gwrk` and `/run/gwrk` with mode `0750`. Keep `/opt/gwrk` writable by the operator.
2. Install Node.js 22 or newer with the ABI and architecture in the release manifest. Install pnpm 9.15.9, Git, the GitHub CLI and `flock`.
3. Download the release archive, checksum, manifest and `install-release.sh` from the same GitHub release. Run `bash install-release.sh ARCHIVE release-manifest.json /opt/gwrk` as the operator.
4. Create the pilot checkout under `/var/lib/gwrk/repos`. Match its credential-free GitHub origin to `GWRK_PILOT_REPO_URL`. Run `gwrk init` as the service user. Set the project bind to match the private listener in `runner.env`. Configure one worker and one approved local agent backend for define and implement. Give that backend one registry slot and one fallback entry.
5. Copy `.env.example` to `/etc/gwrk/runner.env`. Fill in the pilot repository, approved agent ID and headless probe path.
6. Install `gwrk-runner.service` in `/etc/systemd/system`. Run `systemctl daemon-reload`, then `systemctl enable --now gwrk-runner.service`.

Use the Google sign-in gateway for browser traffic. Keep the runner behind a private bind. Connect the gateway to the enrolled project authorization boundary before exposing runner routes.

## Credentials

Keep `/etc/gwrk/secrets` owned by `root:gwrk` with mode `0750`. Write one value per file with mode `0640`.

| File | Consumer |
|---|---|
| `pilot-git-credential` | GitHub CLI and the GitHub HTTPS credential helper |
| `agent-credential` | Approved agent wrapper through `GWRK_AGENT_CREDENTIAL_FILE` |
| `slack-bot-token` | Slack Socket Mode when `GWRK_SLACK_ENABLED=1` |
| `slack-app-token` | Slack Socket Mode when `GWRK_SLACK_ENABLED=1` |

Use a token scoped to the pilot repository. Install the approved provider CLI and its operator-owned wrapper on the host. The wrapper reads the credential file without printing it. Set `GWRK_AGENT_PROBE` to a root-owned executable that takes the approved plugin ID and runs a headless request with tools disabled. Use the same credential path and provider configuration for the probe and the installed agent wrapper. Preflight runs Git and the probe under time limits. It rejects Telegram configuration in the service environment.

Revoke a GitHub token or agent credential at its provider. Replace the credential file and restart the service to run preflight again. Revoke Slack credentials in the Slack app settings.

## Backup and rollback

- Run `gwrk db backup --out BACKUP_DIR --format json` as the service user. Store the verified backup outside the release tree.
- Stop the runner before restore. Set `GWRK_RUNTIME_DIR` to the service runtime directory. Run `gwrk db restore --from BACKUP_DIR --state-dir STATE_DIR` as the service user. Retry an interrupted restore with the same backup.
- Run `GWRK_RUNTIME_DIR=/run/gwrk /opt/gwrk/current/deploy/linux-runner/rollback-release.sh /opt/gwrk /var/lib/gwrk` as the operator. It checks applied migrations, saves a backup and switches the release under the runtime lock. Check the service and ledger after restart.

Record the real systemd start, unattended worker run and credential revocation in a copy of [live-pilot-record.example.md](live-pilot-record.example.md).
