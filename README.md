# gwrk: The Principal Engineer's Operating System

**gwrk** is a CLI-native operating system for Principal Engineers. It orchestrates multi-agent software delivery through a spec → plan → tasks → ship → harvest pipeline, enforced by Hard Gate verification at every stage.

## Quick Start

```bash
# Install
pnpm install && pnpm build && pnpm link --global

# Initialize a project
cd your-project
gwrk init

# Define a feature
gwrk specify my-feature          # Generate spec.md
gwrk plan my-feature             # Generate plan.md
gwrk define tasks my-feature     # Generate tasks.json + gate scripts

# Ship it
gwrk ship my-feature 1           # Autonomous implement → review → PR loop
gwrk gate my-feature              # Verify all gates pass
```

## Architecture

gwrk is a **plugin-driven CLI** built on three layers:

| Layer | Purpose | Examples |
|-------|---------|---------|
| **L1: Agent Backends** | Adapter plugins for LLM CLIs | Claude, Codex, Gemini |
| **L2: Skills** | Composable reasoning modes | truth-extract, decision-forge |
| **L2.5: WorkflowRuntime** | JSON intent execution engine | specify, plan, implement, review |

All workflows produce **JSON Intents** (`WRITE_FILE`, `CREATE_DIR`, `RUN_COMMAND`) that the `IntentEngine` executes natively. LLMs reason; gwrk mutates. Anti-MCP: Unix-native, pipe-composable, no server required.

## CLI Commands

```
gwrk specify <feature>           # Spec generation workflow
gwrk plan <feature>              # Implementation plan workflow
gwrk define tasks <feature>      # Generate tasks.json + gate scripts
gwrk define tests <feature>      # TDD: generate test files from spec
gwrk ship <feature> [phase]      # Autonomous ship loop
gwrk gate <feature> [-p <phase>] # Run gate scripts
gwrk skill <name> [< input]      # Invoke reasoning skill
gwrk plugin list|install|remove  # Plugin management
gwrk status                      # System status
gwrk pulse                       # Productivity snapshot
```

## Directory Model

| Directory | Purpose |
|-----------|---------|
| `~/.gwrk/` | Global home — plugins, skills, workflows, config |
| `.gwrk/` | Project-local overrides (minimal by default) |
| `specs/` | Feature specs, plans, tasks, gates |
| `src/` | TypeScript source (CLI + server + engine) |
| `docs/` | Architecture, PRD, ADRs, research |

## Documentation

- [Architecture](docs/architecture.md) — Authoritative technical specification
- [PRD](docs/GWRK-PRD-PRFAQ.md) — Product requirements and FAQ
- [ADR-006](docs/decisions/ADR-006-plugin-agent-backends.md) — Plugin system design
- [DEVELOPMENT.md](DEVELOPMENT.md) — Contributing and development setup

## Stack

TypeScript CLI (Commander.js) · Fastify daemon (localhost:18790) · SQLite (better-sqlite3) · Vitest · Biome · pnpm
