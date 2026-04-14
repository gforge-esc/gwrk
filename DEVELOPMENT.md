# Development Guide

## Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9
- At least one agent CLI installed: `gemini`, `claude`, or `codex`

## Setup

```bash
git clone <repo-url> && cd gwrk
pnpm install
pnpm build
pnpm link --global    # Makes `gwrk` available system-wide
```

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm build` | TypeScript compilation |
| `pnpm test` | Run Vitest suite |
| `pnpm lint` | Biome lint + format check |

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

## Configuration

gwrk uses `.gwrkrc.json` at the project root. All values are validated by Zod at startup — missing required config causes an immediate crash (Fail Fast).

```jsonc
{
  "project": { "name": "my-project" },
  "agents": {
    "define": "gemini",      // Agent for define workflows
    "implement": "claude"    // Agent for ship/implement
  },
  "server": {
    "port": 18790,
    "host": "localhost"
  }
}
```

## Pre-Commit Hook

A branch-aware pre-commit hook is installed in `.git/hooks/pre-commit`:

| Branch | Checks | Duration |
|--------|--------|----------|
| Feature branches | `pnpm build` | ~3s |
| `develop` / `main` | `pnpm build` + `pnpm test` | ~25s |

Bypass with `git commit --no-verify` (human-only, intentional).

## Plugin Development

Plugins live in `~/.gwrk/plugins/` (global) or `.gwrk/plugins/` (project-local).

Each plugin is a directory containing:
- `manifest.yaml` — Identity, type, interface declarations
- `PROMPT.md` — Workflow prompt (for workflow plugins)
- `SKILL.md` — Reasoning program (for skill plugins)

Types: `agent-backend`, `workflow`, `skill`

## Testing

```bash
pnpm test                          # Full suite
pnpm test -- src/path/to/file      # Single file
gwrk test <feature>                # Feature-scoped tests
gwrk gate <feature>                # Run gate scripts
```

## Governance

- **Spec-First**: No implementation without approved `spec.md` + `plan.md`
- **Hard Gates**: `gwrk tasks done` enforces gate scripts before state transitions
- **TDD**: Tests are written before implementation; `GATE_STUB` blocks completion
- **RAGB**: 🔴 RED (at risk) · 🟡 AMBER (in progress) · 🟢 GREEN (done done) · ⚫ BLACK (stopped)
