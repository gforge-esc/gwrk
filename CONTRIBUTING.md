# Contributing to gwrk

All pull requests target `develop` and follow conventional commits. Every PR must pass build, lint and Vitest on Node 20 and 22. Blocked: none.

## Status

gwrk is in beta. The current release line is `1.6.0-beta.2`. Core workflow prompts and enforcement skills ship bundled inside the package. Built-in agent adapters (`agy`, `claude` and `codex`) also ship bundled. See [README.md](README.md) for consumer setup and [gwrk.gforge.ai](https://gwrk.gforge.ai) for the hosted portal.

## Prerequisites

- Node.js 20 or 22 for local development and CI. Linux release packaging requires Linux with Node.js 22.
- pnpm 9.x (`9.15.9` on release and Linux runner hosts)
- At least one supported agent CLI installed: `agy`, `claude` or `codex`

## Setup

```bash
git clone https://github.com/gforge-esc/gwrk.git && cd gwrk
git checkout develop
pnpm install
pnpm build
pnpm link --global
```

Install the version-controlled pre-commit hook after cloning:

```bash
cp scripts/hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

| Branch | Hook Checks | Approximate Time |
|---|---|---|
| Feature branches | `pnpm build` | 3s |
| `develop` and `main` | `pnpm build`, `pnpm lint`, `pnpm test` | 25s |

## Configuration Layering

gwrk merges configuration across project, local and global layers.

| File | Tracked | Purpose |
|---|---|---|
| `.gwrkrc.json` | Yes | Project identity, stack, design target, loopback server defaults |
| `.gwrkrc.local.json` | No | Personal agent backend selection and local registry |
| `~/.gwrk/config.json` | No | Machine-wide tokens and global plugin preferences |

Copy the tracked template in this repository or run `gwrk init`:

```bash
cp .gwrkrc.local.json.example .gwrkrc.local.json
```

Do not copy gwrk's own `AGENTS.md` into consumer projects. Consumer projects generate their own managed context blocks with `gwrk init`.

## Branch Model

- `main`: approved release baseline and tagged releases
- `develop`: integration branch for all pull requests
- Feature branches: short-lived branches created from `develop`

David Gonzalez is the project owner. He approves merges to `develop` and `main`. He also approves release publication.

## Making Changes

1. Create a branch from `develop`:

```bash
git checkout develop
git pull origin develop
git checkout -b feat/my-change
```

2. Read `.gwrk/architecture.md` and `.gwrk/decisions/index.md` before changing source code. Preserve existing `Decided` constraints (`ADR-001` through `ADR-014`).
3. Keep dependencies pointing inward per `ADR-011`. `src/domain/` imports nothing outward. `src/ports/` and `src/application/` depend on the domain. `src/adapters/` implement ports.
4. Verify locally before opening a pull request:

```bash
pnpm build
pnpm lint
node dist/cli.js define adr --check
pnpm test
```

5. Commit with conventional commit prefixes such as `feat`, `fix` or `docs`. Use your own git author and committer identity. Never use `--no-verify`.
6. Open a pull request against `develop`. CI verifies Node 20 and Node 22.

## Companion Plugin Ecosystem

External agent backends and framework packs live in [gwrk-plugins](https://github.com/gforge-esc/gwrk-plugins). Review strategy plugins also live there. Keep plugin contract changes aligned with `ADR-012` and `src/plugins/manifest.ts`.

## Code Style

- TypeScript strict mode (`"strict": true`) targeting ES2022 with ESM modules
- Biome formatting and linting (`pnpm format` and `pnpm lint` with zero errors)
- Vitest tests co-located as `*.test.ts` or under `tests/`
- Prose follows `AGENTS.md` section 7 and the writing standard

## Opening Issues

Use the repository templates:

- Bug report for reproducible defects
- Feature request for concrete enhancements
- Plugin request for new agent backends or skills

## License

Contributions are licensed under the [Mozilla Public License 2.0](LICENSE).
