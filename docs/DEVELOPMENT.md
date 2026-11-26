# Development Guide

Clone the repository on `develop` and install dependencies with pnpm 9 on Node 20 or 22. Run `pnpm build`, `pnpm lint` and `pnpm test` before opening a pull request. Blocked: none.

## Prerequisites

- Node.js 20 or 22 locally. Linux release builds require Linux with Node.js 22.
- pnpm 9.x (`9.15.9` on Linux runner and release builds)
- At least one supported agent CLI installed: `agy`, `claude` or `codex`

## Setup

```bash
git clone https://github.com/gforge-esc/gwrk.git && cd gwrk
git checkout develop
pnpm install
pnpm build
pnpm link --global
```

## Commands

| Command | Purpose |
|---|---|
| `pnpm build` | Compile TypeScript and copy bundled SQL migrations and builtin plugins into `dist/` |
| `pnpm test` | Run Vitest test suite |
| `pnpm lint` | Run Biome check across tracked and workspace files |
| `pnpm format` | Format source files with Biome |
| `node dist/cli.js define adr --check` | Verify ADR headers, index freshness, and citations |

## Project Structure

```text
src/
  domain/         # Pure domain types, policies, parsers (zero external I/O)
  ports/          # Inbound and outbound port interfaces
  application/    # Use-case services and orchestrators
  adapters/       # Infrastructure adapters (auth, cli, git, github, models, release, sqlite)
  commands/       # Commander CLI commands
  server/         # Fastify control-plane server and generated portal-html.ts
  engine/         # Core pipelines (define, ship, harvest, compression, ADR tooling)
  plugins/        # Plugin loader, manifests, WorkflowRuntime
    builtins/     # Built-in agents (agy, claude, codex), workflows, skills
  db/             # SQLite schema and migrations
  utils/          # Shared config, git, and signal helpers
deploy/           # Linux runner and hosted-pilot deployment bundles
docs/             # Guides (docs/site/), OpenAPI, ADRs, product docs, operations
scripts/          # Build, lint, portal generator (build-portal.py), release packaging
specs/            # Feature specs, plans, tasks, and gates
tests/            # Integration, Linux runner, and hosted-pilot suites
```

## Configuration

gwrk merges three configuration layers in order. `.gwrkrc.json` tracks project identity. `.gwrkrc.local.json` stores gitignored personal agent selection. `~/.gwrk/config.json` stores machine-wide tokens.

Copy the template or run `gwrk init`:

```bash
cp .gwrkrc.local.json.example .gwrkrc.local.json
```

Example `.gwrkrc.local.json`:

```json
{
  "agents": {
    "define": "claude",
    "implement": "agy",
    "registry": {},
    "fallbackOrder": ["agy", "claude", "codex"]
  }
}
```

## Pre-Commit Hook

Install the version-controlled hook after cloning:

```bash
cp scripts/hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

| Branch | Checks | Approximate Time |
|---|---|---|
| Feature branches | `pnpm build` | 3s |
| `develop` and `main` | `pnpm build`, `pnpm lint`, `pnpm test` | 25s |

Never bypass the hook with `--no-verify` in automated sessions.

## Regenerating the Portal

Never hand-edit `src/server/routes/portal-html.ts`. Edit the canonical Markdown sources under `docs/site/` or `docs/openapi/gwrk-openapi.yaml`, then regenerate with Sphinx and `scripts/build-portal.py`:

```bash
pnpm build:portal
pnpm test:portal-links
pnpm exec playwright install chromium
pnpm test:portal
pnpm exec vitest run src/server/routes/portal-html.test.ts
```

The Python generator dependencies are pinned in `scripts/portal-requirements.txt`. To update them, edit `scripts/portal-requirements.in` and run `uv pip compile --universal --python-version 3.12 scripts/portal-requirements.in --output-file scripts/portal-requirements.txt`.

The portal browser suite serves the packaged HTML at `/`. Its test origin returns HTTP 401 for the session probe and HTTP 404 for unknown paths. It checks guide tabs, nested contents links, document fragments, direct entry, reload and browser history. The required `ci (22)` job regenerates the artifact and rejects stale output. Browser binaries stay in the development cache and CI.

To check a deployed public portal, run the same suite against its HTTPS origin:

```bash
GWRK_PORTAL_BASE_URL=https://gwrk.gforge.ai pnpm test:portal
```

Remote mode disables the fixture server and uses fresh browser contexts. It permits same-origin GET and HEAD requests only. It blocks external traffic and all mutations. The configured URL must be an HTTPS origin without credentials, a path, a query or a fragment. Navigation has a 15-second timeout. The complete suite has a five-minute timeout.

Changing `package.json` or any file under `src/` (including `src/server/routes/portal-html.ts`) changes the closed runtime manifest hash used by the signed hosted-pilot native proof. Do not re-sign native evidence or deploy to production without independent review and operator authority.

## Plugin Development

External plugins live in `~/.gwrk/plugins/` (global) or `.gwrk/plugins/` (project-local) and follow [ADR-012](decisions/ADR-012-plugin-registry-and-framework-packs.md). See [gwrk-plugins](https://github.com/gforge-esc/gwrk-plugins) for published external agent backends and framework packs.

## Releasing

`.github/workflows/release.yml` runs `release-please-action@v4` on pushes to `main`. Release-please owns `.release-please-manifest.json` and `CHANGELOG.md`. It also creates the tag and the GitHub release.

1. Merge reviewed work into `develop` with passing CI on Node 20 and Node 22.
2. If the next version needs an explicit number, set `release-as` in `.release-please-config.json` in a reviewed pull request. Bump `package.json` to the same value. Do not edit `.release-please-manifest.json` or add a `CHANGELOG.md` section by hand.
3. Promote `develop` to `main` with a reviewed squash pull request. Put a `BEGIN_COMMIT_OVERRIDE` block in its body to curate the changelog.
4. Review and merge the release pull request that release-please opens on `main`.
5. On merge, `release.yml` creates the tag and marks prerelease tags (`*-*`) as GitHub prereleases. It runs `scripts/release/build-linux-release.mjs` from the tag on Linux with Node 22 and pnpm `9.15.9`. It uploads the tarball and its SHA-256 checksum. It also uploads `release-manifest.json` and `install-release.sh`.
6. Merge `main` back into `develop` and remove any `release-as` value in the same pull request.

[release-1.6.0-beta.3-notes.md](operations/release-1.6.0-beta.3-notes.md) records the current release path.
