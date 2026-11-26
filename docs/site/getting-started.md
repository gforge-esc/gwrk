# Human Consumer Guide (v1.6.0-beta.2)

Install gwrk from a verified release archive and initialize your own repository. Then ship one bounded phase at a time. The human owner keeps final merge authority. Blocked: none.

> Release note: install `cli-v1.6.0-beta.2` or later. `cli-v1.6.0-beta.1` predates architecture context setup, hosted Google authentication, the embedded portal and the Linux release manifest.

## Runtime support

| Environment | Node.js | pnpm | Platform |
|---|---|---|---|
| Local CLI | 20 or 22 | 9.x | macOS or Linux |
| CI | 20 and 22 | 9.15.9 | Ubuntu |
| Hosted Linux runner | 22 | 9.15.9 | Linux x64 |

## 1. Install gwrk

### Local workstation install

Each release publishes `gwrk-cli-v<version>.tgz` and a matching `.sha256` file. Verify the checksum before extraction.

```bash
(
set -e
VERSION=1.6.0-beta.2
TAG="cli-v$VERSION"
BASE="https://github.com/gforge-esc/gwrk/releases/download/$TAG"

mkdir -p "$HOME/.gwrk/downloads" "$HOME/.gwrk/releases/$VERSION" "$HOME/.gwrk/bin"
cd "$HOME/.gwrk/downloads"
curl -fsSLO "$BASE/gwrk-$TAG.tgz"
curl -fsSLO "$BASE/gwrk-$TAG.tgz.sha256"
shasum -a 256 -c "gwrk-$TAG.tgz.sha256"

tar -xzf "gwrk-$TAG.tgz" -C "$HOME/.gwrk/releases/$VERSION" --strip-components=1
cd "$HOME/.gwrk/releases/$VERSION"
pnpm install --prod --frozen-lockfile --ignore-scripts
pnpm rebuild better-sqlite3
chmod 755 dist/cli.js
ln -sfn "$HOME/.gwrk/releases/$VERSION/dist/cli.js" "$HOME/.gwrk/bin/gwrk"

export PATH="$HOME/.gwrk/bin:$PATH"
gwrk --version
)
```

1. If `shasum -a 256 -c` does not print `OK`, delete the download and stop.
2. Add the `export PATH` line to your shell profile.
3. Confirm `gwrk --version` prints `1.6.0-beta.2`.

Do not use the legacy `scripts/install.sh` helper. It skips checksum and manifest verification.

### Linux runner install (operator-only)

The hosted runner installer is `install-release.sh` from the same release. Its arguments are `TARBALL MANIFEST [RELEASE_ROOT]`. The release root defaults to `/opt/gwrk`.

| Requirement | Value |
|---|---|
| Operating system | Linux |
| Node.js | 22, matching `nodeAbi` in `release-manifest.json` |
| CPU architecture | Matching `arch` in `release-manifest.json` (`x64`) |
| pnpm | Exactly `9.15.9` |
| Checksum file | `TARBALL.sha256` beside the tarball |

```bash
TAG=cli-v1.6.0-beta.2
BASE="https://github.com/gforge-esc/gwrk/releases/download/$TAG"
curl -fsSLO "$BASE/gwrk-$TAG.tgz"
curl -fsSLO "$BASE/gwrk-$TAG.tgz.sha256"
curl -fsSLO "$BASE/release-manifest.json"
curl -fsSLO "$BASE/install-release.sh"
bash install-release.sh "gwrk-$TAG.tgz" release-manifest.json /opt/gwrk
node /opt/gwrk/current/dist/cli.js --version
```

The installer checks the archive digest against the manifest and the `.sha256` file before extraction. It rejects links, special files and unexpected paths. It installs frozen production dependencies and verifies the release inventory. Then it switches the `current` symlink. Run it as the account that owns the release root. The [Linux runner README](https://github.com/gforge-esc/gwrk/blob/main/deploy/linux-runner/README.md) covers service setup and rollback.

## 2. Configure agent CLIs and plugins

The package bundles the `agy`, `claude` and `codex` agent adapters. Install and sign in to at least one of those agent CLIs before you run `gwrk define` or `gwrk ship`. The `gemini` backend is retired. `gwrk init` re-probes the supported agents and replaces a stale `gemini` agent block.

External plugins live in [gwrk-plugins](https://github.com/gforge-esc/gwrk-plugins). The registry includes external agent backends, framework packs and review plugins. Read its compatibility notes before you install. Manifest model defaults are compatibility aliases, not qualified model promotions.

```bash
gwrk plugin search fastapi
gwrk plugin install <id-or-path>
gwrk plugin list --project
gwrk plugin doctor
```

## 3. Initialize your target project

Run initialization from the root of your target repository. Never run it inside the gwrk source repository. Do not copy gwrk's own `AGENTS.md` into your project.

### Configuration layers

| Layer | File | Tracked | Contents |
|---|---|---|---|
| Project | `.gwrkrc.json` | Yes | Project identity, stack and design target |
| Local | `.gwrkrc.local.json` | No | Personal agent selection |
| Global | `~/.gwrk/config.json` | No | Machine-wide credentials |

### Fresh project

```bash
cd /path/to/new-project
git init
gwrk init --non-interactive \
  --architecture hexagonal-functional \
  --principles functional-core,clean-code,tdd \
  --language TypeScript
```

To install architecture context only, without machine registration or agent probing:

```bash
gwrk init --context-only --architecture hexagonal-functional --language Python --framework FastAPI
```

### Existing project

Run the same command at the root of an existing repository:

```bash
cd /path/to/existing-project
gwrk init --non-interactive --architecture hexagonal-functional
```

Re-running `gwrk init` preserves project identity and authored decision records. It updates managed blocks in `AGENTS.md`, `CLAUDE.md` and `GEMINI.md`. It writes `.gwrk/architecture.md` and `.gwrk/decisions/index.md`. It adds `.gwrkrc.local.json`, `.runs/` and `.gwrk/server.pid` to `.gitignore`.

## 4. Architecture context, nonconformance and ADRs

`gwrk init` installs the architecture target without model calls. It does not assess or certify existing code. Run `gwrk assess` to compare code with the target and propose feature specs. Assessment calls the configured definition agent.

```bash
gwrk assess
```

Architecture Decision Records (ADRs) live in `docs/decisions/ADR-NNN-*.md`. A generated target ADR starts as `Proposed`. Existing `Decided` ADRs keep authority until a human supersedes them. Agents never ratify ADRs.

```bash
gwrk define adr "Storage Boundary"
gwrk define adr --reindex
gwrk define adr --check
```

## 5. Local and hosted execution

| Mode | Machine role | Control plane | Use |
|---|---|---|---|
| Local workstation | `remote` (`gwrk init --remote`) | None | `define`, `assess` and `ship --worktree` |
| Local server | `server` (`gwrk init --server`) | Loopback `127.0.0.1:18790` | Local daemon and manual `gwrk harvest` |
| Hosted service | Dedicated Linux server | [gwrk.gforge.ai](https://gwrk.gforge.ai) | Google login, scoped API keys, remote dispatch and webhook harvest |

## 6. Hosted onboarding (operator-only)

Operators run project enrollment and credential management as local admin commands on the hosted Linux server. No HTTP endpoint enrolls projects or issues credentials. On the server, run each command as the service account:

```bash
runuser -u gwrk -- env GWRK_HOME=/var/lib/gwrk GWRK_RUNTIME_DIR=/run/gwrk \
  node /opt/gwrk/current/dist/cli.js <command>
```

1. Prepare a credential-free checkout of the target repository on the server, such as `/var/lib/gwrk/repos/my-project`. Runner secrets live under `/etc/gwrk/secrets`.
2. Enroll the project and bind roles. Google login alone grants no project access.

```bash
: "${GOOGLE_SUB:?Set GOOGLE_SUB to the approved Google account subject}"
gwrk project enroll \
  --path /var/lib/gwrk/repos/my-project \
  --repo owner/my-project \
  --slug my-project \
  --trunk develop \
  --runners hosted \
  --role "google_sub:https://accounts.google.com:${GOOGLE_SUB}=maintainer"
gwrk project show my-project
```

3. Issue a scoped API credential. Each key has the form `gwrk_v1.<id>.<secret>`. It expires within 30 days and binds to one HTTPS origin. The command writes the key to a new `0600` file outside every checkout and prints only public metadata.

```bash
: "${GWRK_KEY_EXPIRES_AT:?Set a future ISO-8601 expiry within 30 days}"
gwrk auth key create \
  --label my-project-operator \
  --grant my-project=operator \
  --expires-at "$GWRK_KEY_EXPIRES_AT" \
  --origin https://gwrk.gforge.ai \
  --secret-out /path/outside/checkouts/my-project-operator.secret
```

Deliver the secret file through an approved secret channel. Never paste a key into a prompt or a commit. Keep it out of command arguments and logs. Rotate with `gwrk auth key rotate <credentialId> --expires-at <iso8601> --secret-out <new-path>`. Revoke with `gwrk auth key revoke <credentialId>`.

### Use a hosted credential

Keep the delivered file at mode `0600` and owned by your user. Check hosted readiness without exposing the key:

```bash
chmod 600 /path/outside/checkouts/my-project-operator.secret
gwrk status \
  --server-url https://gwrk.gforge.ai \
  --credential-file /path/outside/checkouts/my-project-operator.secret \
  --credential-origin https://gwrk.gforge.ai \
  --project my-project
```

The [HTTP API Reference](api-reference.md) shows `curl` requests that read the key from standard input.

## 7. Define, dry-run, ship, review and harvest

Work through the definition pipeline before shipping. `gwrk define spec` assigns the next numeric feature ID, such as `001-my-feature`. Later commands accept the full ID or its numeric prefix.

```bash
gwrk define spec my-feature "One-sentence outcome for the feature"
gwrk define plan 001
gwrk define tests 001
gwrk define tasks 001
```

Check pre-flight setup before an autonomous ship loop:

```bash
gwrk ship 001 --dry-run
```

Run one phase at a time in an isolated git worktree with an iteration cap. Keep one writer per feature branch.

```bash
gwrk ship 001 1 --worktree --max-iterations 2
```

Check evidence before human merge review:

| Evidence | Command or location |
|---|---|
| Gate results | `gwrk gate 001 -p 1` or `gwrk gate 001 -t <taskId>` |
| Task state | `gwrk tasks list 001` |
| Run manifests and review receipts | `specs/001-my-feature/.gwrk/runs/` |
| Post-merge harvest (server role) | `gwrk harvest 001 1 --pr <number>` or a signed GitHub webhook |
| Server and notification readiness | `gwrk status --project <slug>` |
| Compression signal | `gwrk measure compression 001` |

The human owner keeps final pull request merge authority and release publication. See the [Consumer-Agent Guide](agent-guide.md) for agent rules.
