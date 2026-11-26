# gwrk

gwrk is a beta command-line orchestrator and hosted control plane for spec-first engineering. Start at [gwrk.gforge.ai](https://gwrk.gforge.ai) for the hosted portal and embedded guides. Install the CLI from [GitHub Releases](https://github.com/gforge-esc/gwrk/releases) to run gwrk inside your own project. Blocked: none.

> Release notice: install `cli-v1.6.0-beta.3` or later. The older `cli-v1.6.0-beta.1` release predates architecture context initialization, hosted Google authentication, the embedded portal and the verified Linux release manifest. See the [1.6.0-beta.3 release notes](docs/operations/release-1.6.0-beta.3-notes.md).

![gwrk flamingo mascot](docs/branding/gwrk-flamingo-flat.png)

![CI status](https://github.com/gforge-esc/gwrk/actions/workflows/ci.yml/badge.svg?branch=develop)

![MPL-2.0 license](https://img.shields.io/badge/license-MPL--2.0-3b82f6)

## Entry points

| Audience | Starting point | Purpose |
|---|---|---|
| Hosted users | [gwrk.gforge.ai](https://gwrk.gforge.ai) | Google sign-in, guides (`#guides`) and OpenAPI explorer (`#api`) |
| Project users | [Human Consumer Guide](docs/site/getting-started.md) | Install, initialize a project, define and ship |
| Consumer agents | [Consumer-Agent Guide](docs/site/agent-guide.md) | Run gwrk inside a target project checkout |
| Plugin users | [gwrk-plugins](https://github.com/gforge-esc/gwrk-plugins) | External agent backends, framework packs and review plugins |
| Contributors | [CONTRIBUTING.md](CONTRIBUTING.md) | Develop gwrk itself |

## Runtime support

| Environment | Node.js | pnpm | Platform |
|---|---|---|---|
| Local CLI | 20 or 22 | 9.x | macOS or Linux |
| CI | 20 and 22 | 9.15.9 | Ubuntu |
| Hosted Linux runner | 22 | 9.15.9 | Linux x64 |

The Linux runner installer requires the host Node.js ABI and CPU architecture to match `release-manifest.json`. The release workflow builds that manifest with Node.js 22 on Linux x64.

Built-in agent backends are `agy`, `claude` and `codex`. The `gemini` backend is retired.

## Install the CLI

Download the release archive and its checksum. Verify the checksum before you extract the archive. Each release asset uses the tag name `cli-v<version>`.

```bash
(
set -e
VERSION=1.6.0-beta.3
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

If `shasum -a 256 -c` does not print `OK`, delete the download and stop. Add the `export PATH` line to your shell profile to keep `gwrk` on your `PATH`.

Hosted Linux runners use the verified installer from the same release. The [Human Consumer Guide](docs/site/getting-started.md#linux-runner-install-operator-only) lists its arguments and host requirements.

The legacy `scripts/install.sh` helper resolves the latest release without checksum or manifest verification. Use the steps above instead.

## Use gwrk in your project

Run these commands inside your target project checkout, never inside the gwrk source checkout. The guides walk through each step.

```bash
# 1. Install the architecture target and local agent config
gwrk init --non-interactive --architecture hexagonal-functional

# 2. Verify decision records and plugins
gwrk define adr --check
gwrk plugin list --project
gwrk plugin doctor

# 3. Assess existing code against the declared target
gwrk assess

# 4. Define a feature. The spec command prints the assigned ID, such as 001-my-feature.
gwrk define spec my-feature "One-sentence outcome for the feature"
gwrk define plan 001
gwrk define tests 001
gwrk define tasks 001

# 5. Check pre-flight setup
gwrk ship 001 --dry-run

# 6. Ship one phase in an isolated git worktree
gwrk ship 001 1 --worktree --max-iterations 2

# 7. Inspect tasks, gates and compression
gwrk tasks list 001
gwrk gate 001 -p 1
gwrk measure compression 001
```

`gwrk init` makes no model calls and does not prove code conformance. The human owner keeps final pull request merge authority.

## Hosted access

The hosted control plane runs at [https://gwrk.gforge.ai](https://gwrk.gforge.ai).

- Browser users sign in with an allowlisted Google account. Sign-in alone grants no project permission.
- Automation uses an opaque API credential in the form `gwrk_v1.<id>.<secret>`. Keep it in a private `0600` file outside every repository checkout.
- Operators enroll projects and issue credentials with local admin commands on the server host. No HTTP endpoint enrolls projects or issues credentials.

Read [SECURITY.md](SECURITY.md) for hosted trust boundaries and revocation. The [HTTP API Reference](docs/site/api-reference.md) lists route policies and credential-safe requests.

## Contributor setup

Clone this repository and work against `develop` to change gwrk itself.

```bash
git clone https://github.com/gforge-esc/gwrk.git && cd gwrk
git checkout develop
pnpm install
pnpm build
cp scripts/hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) before opening a pull request. gwrk's own `AGENTS.md` governs gwrk contributors. Do not copy it into consumer repositories.

## CLI commands

The table matches `gwrk --help` in `1.6.0-beta.3`. Run `gwrk <command> --help` for flags.

| Command | Group | Purpose |
|---|---|---|
| `define` | Foxtrot Charlie | Run `spec`, `plan`, `tests`, `tasks`, `research`, `ontology` and `adr` |
| `ship` | Foxtrot Charlie | Run the bounded branch, implement, review and PR loop |
| `test` | Foxtrot Charlie | Run the project test suite scoped to feature test files |
| `gate` | Foxtrot Charlie | Execute task or phase gate scripts |
| `measure` | Foxtrot Charlie | Compute `pulse` and `compression` metrics |
| `init` | Operations | Initialize project config, agent config and architecture context |
| `assess` | Operations | Assess code against the declared architecture |
| `auth` | Operations | Create, list, rotate and revoke hosted API credentials |
| `tasks` | Operations | Query and update feature task state |
| `plan` | Operations | Query the project build plan |
| `db` | Operations | Inspect the ledger and run backup, restore and rollback checks |
| `server` | Operations | Start, stop and inspect the build server daemon |
| `device` | Operations | Show the registered machine role |
| `status` | Operations | Show server, project and agent readiness |
| `project` | Operations | Inspect project metadata and manage enrollments |
| `plugin` | Operations | Search, install, list and verify plugins |
| `models` | Operations | Discover, evaluate and promote model routes |

## Documentation map

| Document | Purpose |
|---|---|
| [Hosted portal](https://gwrk.gforge.ai) | Landing page, embedded guides and OpenAPI explorer |
| [Human Consumer Guide](docs/site/getting-started.md) | Install, project setup, hosted prerequisites and workflows |
| [Consumer-Agent Guide](docs/site/agent-guide.md) | Handoff rules for agents in target projects |
| [CLI Command Reference](docs/site/cli-reference.md) | Command grammar and operator-only boundaries |
| [HTTP API Reference](docs/site/api-reference.md) | Route policies and credential-safe requests |
| [Hosted Reference Architecture](docs/site/hosted-architecture.md) | Hexagonal target rules and `ADR-014` auth boundaries |
| [Architecture Context and Assessment](docs/architecture/context-and-assessment.md) | Context setup and `gwrk assess` |
| [What is gwrk?](docs/product/WHAT_IS_GWRK.md) | Product thesis and operating model |
| [Foxtrot Charlie](docs/product/FOXTROT-CHARLIE.md) | Operating philosophy |
| [gwrk-plugins](https://github.com/gforge-esc/gwrk-plugins) | Companion plugin registry |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting and hosted trust boundaries |
| [SUPPORT.md](SUPPORT.md) | Issue and discussion routing |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributor setup and quality gates |

Historical records stay in the repository for lineage. They do not describe current setup.

| Path | Contents |
|---|---|
| `docs/decisions/` | Architecture Decision Records `ADR-001` through `ADR-014` |
| `docs/research/` | Earlier discovery drafts |
| `docs/grounding/architecture.md` | Early grounding spec that predates `ADR-011` and `ADR-014` |
| `docs/operations/` | Point-in-time audits and release notes |
| `docs/archive/` | Retired reference material |

## Community and support

- [GitHub Discussions](https://github.com/gforge-esc/gwrk/discussions) for beta feedback and questions
- [GitHub Issues](https://github.com/gforge-esc/gwrk/issues/new/choose) for reproducible bugs
- [Public roadmap](https://github.com/orgs/gforge-esc/projects/5) for direction
- [SUPPORT.md](SUPPORT.md) for routing

## License

Mozilla Public License 2.0. See [LICENSE](LICENSE).
