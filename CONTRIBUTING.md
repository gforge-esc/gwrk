# Contributing to gwrk

Thank you for your interest in contributing to gwrk! This guide will help you get set up and understand how the project operates.

## ⚠️ Alpha Status

gwrk is in active alpha (`v1.0.0-alpha.0`). Some core commands (`gwrk define`, `gwrk ship`) still reference workflow files that aren't yet bundled with the distribution (tracked in [R004](docs/research/R004-shareability-readiness/draft.md)). The plugin system's WorkflowRuntime (Layer 2.5) is under active development. Expect rough edges — your feedback helps us prioritize.

## Getting Started

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9
- At least one AI agent CLI installed: `agy`, `claude`, `gemini`, or `codex`

### Setup

```bash
git clone https://github.com/gforge-esc/gwrk.git && cd gwrk
pnpm install
pnpm build
pnpm link --global    # Makes `gwrk` available system-wide
```

### Pre-Commit Hook

After cloning, install the version-controlled pre-commit hook:

```bash
cp scripts/hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

This enforces:

| Branch | Checks | Duration |
|--------|--------|----------|
| Feature branches | `pnpm build` | ~3s |
| `develop` / `main` | `pnpm build` + `pnpm test` | ~25s |

## Configuration

gwrk uses a **three-layer config model** to separate project identity from personal preferences:

| File | Tracked? | Purpose |
|------|----------|---------|
| `.gwrkrc.json` | ✅ Yes | Project identity — name, type, stack, layout, server defaults |
| `.gwrkrc.local.json` | ❌ Gitignored | Personal agent preferences — which CLI to use, per-project overrides |
| `~/.gwrk/config.json` | N/A | Machine-wide secrets — Slack tokens, webhook URLs, API keys |

Each layer deep-merges over the previous one (later layers win).

### Quick Setup

After cloning, copy the example and customize:

```bash
cp .gwrkrc.local.example.json .gwrkrc.local.json
# Edit .gwrkrc.local.json to set your preferred agents
```

Or run `gwrk init` which generates both files automatically.

## Branch Model

```
main ← develop ← feature branches
```

- **`main`** — stable releases, tagged versions
- **`develop`** — integration branch, all PRs target here
- **Feature branches** — named descriptively (e.g., `feat/config-layering`, `fix/webhook-cleanup`)

## Making Changes

### 1. Create a Feature Branch

```bash
git checkout develop
git pull origin develop
git checkout -b feat/my-change
```

### 2. Write Code

- TypeScript source lives in `src/`
- Follow the existing patterns — Zod schemas, Commander.js commands, Vitest tests
- Biome handles formatting and linting (`pnpm format` / `pnpm lint`)

### 3. Test

```bash
pnpm test                          # Full suite
pnpm test -- src/path/to/file      # Single file
```

### 4. Commit

We use **conventional commits**:

```
feat(scope): add new feature
fix(scope): fix a bug
chore(scope): maintenance task
docs(scope): documentation change
test(scope): test addition or fix
```

The pre-commit hook runs automatically — `pnpm build` on feature branches, `pnpm build` + `pnpm test` on develop/main.

### 5. Open a Pull Request

- Target `develop` (not `main`)
- Fill out the PR template
- CI must pass (build + test on Node 20 and 22)

## Code Style

- **TypeScript**: strict mode (`"strict": true` in tsconfig)
- **Formatting**: Biome (2-space indent, organized imports)
- **Linting**: Biome recommended rules, `noExplicitAny` is an error (use `// biome-ignore` with justification)
- **Testing**: Vitest, co-located test files (`*.test.ts`)

## Project Structure

```
src/
  commands/       # CLI command implementations
  server/         # Fastify build server (dispatch, sandbox, Slack)
  engine/         # Core computation (pulse, compression, orchestrators)
  plugins/        # Plugin system (loader, manifests, runtime)
    builtins/     # Built-in plugins shipped with gwrk
      agents/     # L1: Agent backend adapters (claude, codex, gemini)
      workflows/  # L2.5: Core workflow plugins (specify, plan, implement, ...)
  db/             # SQLite schema + migrations
  utils/          # Shared utilities (config, git, agent dispatch)
specs/            # Feature specifications and task state
docs/             # Architecture, PRD, ADRs, research
```

## Opening Issues

Please use the issue templates:

- **Bug Report** — something isn't working
- **Feature Request** — propose an enhancement
- **Plugin Request** — request a new agent backend, workflow, or skill

## License

By contributing, you agree that your contributions will be licensed under the [Mozilla Public License 2.0](LICENSE).
