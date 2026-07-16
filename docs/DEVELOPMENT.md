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

gwrk uses a three-layer config model. Each layer deep-merges over the previous one:

| File | Tracked? | Purpose |
|------|----------|---------|
| `.gwrkrc.json` | ✅ Yes | Project identity — name, type, stack, layout, server defaults |
| `.gwrkrc.local.json` | ❌ Gitignored | Personal agent preferences — define/implement agents, registry |
| `~/.gwrk/config.json` | N/A | Machine-wide secrets — Slack tokens, webhook URLs, API keys |

### Quick Setup

```bash
cp .gwrkrc.local.json.example .gwrkrc.local.json
# Edit to set your preferred agents
```

Or run `gwrk init` which generates both files automatically.

### Example `.gwrkrc.json` (tracked)

```jsonc
{
  "project": { "name": "my-project", "type": "nodejs" },
  "server": { "port": 18790, "host": "localhost" }
}
```

### Example `.gwrkrc.local.json` (gitignored)

```jsonc
{
  "agents": {
    "define": "claude",       // Your preferred agent for define workflows
    "implement": "agy",       // Your preferred agent for ship/implement
    "registry": { /* ... */ },
    "fallbackOrder": ["agy", "claude"]
  }
}
```

## Pre-Commit Hook

Install from the version-controlled copy (required after clone):

```bash
cp scripts/hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

A branch-aware, TDD-aware pre-commit hook:

| Branch | Checks | Duration |
|--------|--------|----------|
| Feature branches | `pnpm build` | ~3s |
| `develop` / `main` | `pnpm build` + `pnpm test` | ~25s |

**TDD support**: RED test files (containing `// @ts-ignore - Module does not exist yet (RED)`) are auto-excluded from the test run. Once `/implement` makes them green and removes the marker, they rejoin the gate automatically.

Bypass with `git commit --no-verify` (escape hatch — human-only, intentional).

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
