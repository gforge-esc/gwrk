# Supervision and preflight contract

Linux supervision runs one foreground `gwrk` server on a private interface under a dedicated service user. Startup preflight checks unattended Git and headless agent credentials first. Blocked for live rollout until the Google gateway proof and Linux runner credentials exist.

## Gateway prerequisite and scope boundary

| Surface | Owner | Enforcement | Phase |
|---|---|---|---|
| Browser HTTPS and Google login | `041-hosted-google-signin-proof` | Traefik and OAuth2 Proxy at `https://gwrk.gforge.ai` | Prerequisite |
| Server listen socket | `050-linux-runner-deploy-packaging` | Private loopback or private bridge IP on port `18790` | Phase 3 and Phase 5 |
| Worker and Slack Socket Mode | `050-linux-runner-deploy-packaging` | Single supervised process guarded by `server.lock` | Phase 3 and Phase 5 |
| Telegram adapter | `050-linux-runner-deploy-packaging` | Disabled in `.env.example` and rejected by preflight | Phase 1 and Phase 5 |
| Multi-project auth and Slack enrollment | Downstream integrated pilot | Deferred per `R013` work sequence | Deferred |

## Environment variable precedence

Phase 3 aligns path resolution in `src/db/index.ts` and `src/plugins/loader.ts`. It applies the same rules in `src/server/pid.ts` and `src/commands/server.ts`.

| Concern | Primary variable | Fallback chain |
|---|---|---|
| Ephemeral lock and PID | `GWRK_RUNTIME_DIR` | `GWRK_HOME` then `~/.gwrk` |
| SQLite ledger file | `GWRK_DB_PATH` | `GWRK_DIR/gwrk.db` then `GWRK_HOME/gwrk.db` then `~/.gwrk/gwrk.db` |
| Global config, device and plugins | `GWRK_HOME` | `GWRK_DIR` then `~/.gwrk` |
| External secrets directory | `GWRK_SECRETS_DIR` | `/etc/gwrk/secrets` |

## Single-instance lock and supervised recovery

`src/adapters/server/instance-lock.ts` claims `<runtimeRoot>/server.lock` before `startServer` binds Fastify. The same lock guards `DispatchQueue`, `HarvestWatcher` and `startSlackApp`.

| Scenario | Lock state | Required behavior |
|---|---|---|
| Clean start | Unlocked | Write owner metadata, hold exclusive descriptor and write `server.pid` |
| Second start while running | Held by live PID | Exit `1` before HTTP listen, worker creation or Slack connection |
| Crash or `SIGKILL` restart | Stale PID or closed kernel descriptor | Reclaim lock cleanly, prune orphan worktrees and start one server and one worker |
| Graceful `SIGTERM` or `gwrk server stop` | Held by stopping PID | Stop watchers, close Slack and Fastify, remove `server.pid` and release `server.lock` |

| `gwrk-runner.service` directive | Required value |
|---|---|
| `Type`, `User` and `Group` | `simple` under dedicated `gwrk:gwrk` |
| `ExecStartPre` | `/opt/gwrk/current/deploy/linux-runner/preflight.sh` |
| `ExecStart` | `/usr/bin/env node /opt/gwrk/current/dist/cli.js server start --foreground` |
| `Restart` and `RestartSec` | `on-failure` after `5s` |
| Privilege hardening | `NoNewPrivileges=true`, `ProtectSystem=strict` and `ProtectHome=true` |
| Writable and read-only mounts | `ReadWritePaths=/var/lib/gwrk /run/gwrk` and `ReadOnlyPaths=/opt/gwrk /etc/gwrk/secrets` |

## Secret supply, unattended preflight and revocation

Operators supply `0640` files in `GWRK_SECRETS_DIR` owned by `root:gwrk`. Laptop credentials stay outside the host and package.

| Secret file | Purpose | Unattended preflight check | Revocation procedure |
|---|---|---|---|
| `pilot-git-credential` | Scoped GitHub App installation or deploy credential for one pilot repo | `GIT_TERMINAL_PROMPT=0 git ls-remote` succeeds under timeout | Revoke GitHub installation or deploy key and remove file, then restart unit |
| `agent-credential` | Headless credential for the single approved Linux agent backend | Non-interactive backend probe succeeds with `APPROVAL_MODE=yolo` and zero TTY | Revoke API or service key at provider, delete file and restart unit |
| `slack-bot-token` and `slack-app-token` | Optional Socket Mode tokens when Slack check is enabled | Rejects missing pair or placeholder prefix (`xoxb-`, `xapp-`) | Revoke tokens in Slack app settings, remove files and restart unit |

`deploy/linux-runner/preflight.sh` exits `1` before daemon startup when:

1. The effective user is `root` in service mode or lacks write access to `GWRK_HOME` and `GWRK_RUNTIME_DIR`.
2. A secret file is world-readable or contains placeholders such as `replace` or `placeholder`. Values matching `changeme` or `example.invalid` also fail.
3. A secret path sits inside `releaseRoot`, `stateRoot` or a user laptop home.
4. The configured listen host is `0.0.0.0` or `::`, or Telegram variables exist.
5. Non-interactive Git authentication to `GWRK_PILOT_REPO_URL` fails or prompts for input.
6. Non-interactive probe of `GWRK_APPROVED_AGENT` fails or exceeds bounded timeout (`ADR-008`).
