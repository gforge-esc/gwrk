# Linux runner

Run one private gwrk server under systemd. Blocked for the live pilot until the host, gateway and credentials are ready.

## Install

Use a root shell for service setup. The commands use the paths in `.env.example`.

1. Create the Linux `gwrk` user and group. Give them ownership of `/var/lib/gwrk` and `/run/gwrk` with mode `0750`. Keep `/opt/gwrk` writable by the operator.
2. Install Node.js 22 or newer with the ABI and architecture in the release manifest. Install pnpm 9.15.9 and `flock`. Install Git and the GitHub CLI.
3. Download the release archive with its checksum and manifest. Download `install-release.sh` from the same GitHub release. Run `bash install-release.sh ARCHIVE release-manifest.json /opt/gwrk` as the operator.
4. Create the pilot checkout as `gwrk` under `/var/lib/gwrk/repos`. Match its credential-free GitHub origin to `GWRK_PILOT_REPO_URL`. Initialize from the checkout.

   ```bash
   : "${RUNNER_GIT_NAME:?Set the runner Git author name}"
   : "${RUNNER_GIT_EMAIL:?Set the runner Git author email}"
   runuser -u gwrk -- git -C /var/lib/gwrk/repos/pilot config user.name "$RUNNER_GIT_NAME"
   runuser -u gwrk -- git -C /var/lib/gwrk/repos/pilot config user.email "$RUNNER_GIT_EMAIL"
   cd /var/lib/gwrk/repos/pilot
   runuser -u gwrk -- env GWRK_HOME=/var/lib/gwrk GWRK_RUNTIME_DIR=/run/gwrk \
     node /opt/gwrk/current/dist/cli.js init --non-interactive --server
   ```

5. Copy `.env.example` to `/etc/gwrk/runner.env`. Fill in the pilot repository and approved agent ID. Match the project bind to the private listener in `runner.env`. Configure one worker and one approved local agent backend for define and implement. Give that backend one registry slot and one fallback entry.
6. Set `AGENT_PROBE_SOURCE`, `PILOT_GIT_CREDENTIAL_SOURCE` and `AGENT_CREDENTIAL_SOURCE` to the source file paths. Install the probe at `GWRK_AGENT_PROBE` and supply the [credentials](#credentials). If you enable Slack, supply both Slack credential files before starting the service.

   ```bash
   mkdir -p /usr/local/libexec
   install -o root -g root -m 0755 "$AGENT_PROBE_SOURCE" /usr/local/libexec/gwrk-agent-probe
   install -d -o root -g gwrk -m 0750 /etc/gwrk/secrets
   install -o root -g gwrk -m 0640 "$PILOT_GIT_CREDENTIAL_SOURCE" /etc/gwrk/secrets/pilot-git-credential
   install -o root -g gwrk -m 0640 "$AGENT_CREDENTIAL_SOURCE" /etc/gwrk/secrets/agent-credential
   ```

7. Install `gwrk-runner.service` in `/etc/systemd/system`. Reload systemd and start the service.

   ```bash
   systemctl daemon-reload
   systemctl enable --now gwrk-runner.service
   ```

Use the Google sign-in gateway for browser traffic. Keep the runner behind a private bind. Connect the gateway to the enrolled project authorization boundary before exposing runner routes.

## Credentials

Keep `/etc/gwrk/secrets` owned by `root:gwrk` with mode `0750`. Write one value per file with mode `0640`.

| File | Consumer |
|---|---|
| `pilot-git-credential` | GitHub CLI and the GitHub HTTPS credential helper |
| `agent-credential` | Approved agent wrapper through `GWRK_AGENT_CREDENTIAL_FILE` |
| `slack-bot-token` | Slack Socket Mode when `GWRK_SLACK_ENABLED=1` |
| `slack-app-token` | Slack Socket Mode when `GWRK_SLACK_ENABLED=1` |

Use a token scoped to the pilot repository.

| Permission | Access | Use |
|---|---|---|
| Contents | read and write | Push worker branches |
| Pull requests | read and write | Create and update pull requests |
| Issues | read and write when enabled | Project issue tracking |

Install the approved provider CLI and its operator-owned wrapper on the host. The wrapper reads the credential file without printing it. Set `GWRK_AGENT_PROBE` to a root-owned executable that takes the approved plugin ID and runs a headless request with tools disabled. Use the same credential path and provider configuration for the probe and the installed agent wrapper. Preflight bounds the Git ref read, authenticated GitHub API request and headless probe. It rejects Telegram configuration in the service environment.

Revoke a GitHub token or agent credential at its provider. Replace the credential file and restart the service to run preflight again. Revoke Slack credentials in the Slack app settings.

## Automatic retention

The installer runs retention and a disk preflight before extraction, dependency installation or activation. It holds the same lock as rollback throughout installation.

Retention protects the running release plus `current` and `previous`. The incoming version also stays protected. It also keeps two recent unprotected releases. A release containing configured state or credentials cannot expire. Unknown files remain untouched. Interrupted cleanup restores owned parked releases before applying the current protection policy.

The installer records cleanup and disk results under `/opt/gwrk/.retention/receipts`. If cleanup fails or space remains short, installation stops before activation. The active release stays available.

[Native verification and release builds](../verification/README.md) use mandatory guards too. They retain two completed disposable payloads and preserve proof receipts. Kernel leases protect work in progress. Routine retention runs with the operation and needs no manual cleanup step.

## Backup and rollback

Use a root shell for backup and restore so `runuser` can switch to `gwrk`.

- Set `BACKUP_DIR` to a new backup directory outside the release tree. Give `gwrk` write access to its parent directory.

  ```bash
  runuser -u gwrk -- env GWRK_HOME=/var/lib/gwrk GWRK_RUNTIME_DIR=/run/gwrk \
    node /opt/gwrk/current/dist/cli.js db backup --out "$BACKUP_DIR" --format json
  ```

- Set `STATE_DIR` to the restore destination. Give `gwrk` write access to the destination. Stop the runner before restoring.

  ```bash
  systemctl stop gwrk-runner.service
  runuser -u gwrk -- env GWRK_HOME=/var/lib/gwrk GWRK_RUNTIME_DIR=/run/gwrk \
    node /opt/gwrk/current/dist/cli.js db restore --from "$BACKUP_DIR" --state-dir "$STATE_DIR"
  ```

  Retry an interrupted restore with the same backup. Startup and restore hold the same lock next to the ledger. Keep the lock file with the state directory.

- Run `GWRK_RUNTIME_DIR=/run/gwrk /opt/gwrk/current/deploy/linux-runner/rollback-release.sh /opt/gwrk /var/lib/gwrk` as the operator. It checks applied migrations, saves a backup and switches the release under the runtime lock. Check the service and ledger after restart.

Record the real systemd start, unattended worker run and credential revocation in a copy of [live-pilot-record.example.md](live-pilot-record.example.md).
