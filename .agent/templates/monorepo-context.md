# Monorepo Context

This file provides workspace-specific context for all `.agent/workflows/`.
**Architecture Reference**: See `docs/architecture.md` for full specification.

## Build & Verification

| Command            | Purpose                                          |
| :----------------- | :----------------------------------------------- |
| `make install`     | Install all TS + Rust dependencies               |
| `make up`          | Start entire stack in Docker with HMR            |
| `make up`          | **Full Docker validation (REQUIRED for handoff)**|
| `make rinse`       | Stop and clean all Docker containers             |
| `make test`        | Run all tests (Vitest + cargo test)              |
| `make lint`        | Run linters (Biome + cargo clippy)               |
| `make fmt`         | Run formatters (Biome + cargo fmt)               |
| `make engine`      | Build Rust engine crate                          |
| `make test-engine` | Run Rust engine tests                            |
| `make build-windows` | Cross-compile engine for Windows (napi-rs)     |

## Package Structure

| Package              | Path                     | Purpose                                  |
| :------------------- | :----------------------- | :--------------------------------------- |
| `@codered/engine`    | `crates/engine/napi`     | Rust forensic kernel (napi-rs bindings)  |
| `@codered/config`    | `packages/config`        | 12-Factor fail-fast config (Zod)         |
| `@codered/core`      | `packages/core`          | Pipeline orchestration, SQLite, audit    |
| `@codered/domain`    | `packages/domain`        | Shared TypeScript types + Zod schemas    |
| `@codered/ui`        | `packages/ui`            | React component library (Exhibit A/B)   |
| Desktop App          | `apps/desktop`           | Tauri v2 desktop shell                   |
| Web App              | `apps/web`               | Fastify dev/test server                  |

## Workspace Rules

From `.agent/rules/workspace.md`:

- ❌ **No magic values**: All values flow from `.env` → `docker-compose` → app
- ❌ **No graceful defaults**: If config is missing, the app MUST crash (fail fast)
- ❌ **No one-off fixes**: Code, configs, or Makefile—work somewhere repeatable
- ❌ **No phone home**: Air-gapped by default. No CDN fetches, no telemetry
- ✅ **Handoff MUST be verified with `make up`**: "It works on my machine" is not valid

## Specify Integration

This monorepo uses the `specify` CLI for spec-driven development:

- **Templates**: `.specify/templates/` (spec-template.md, plan-template.md)
- **Scripts**: `.specify/scripts/bash/` (check-prerequisites.sh, create-new-feature.sh)
- **Feature Specs**: `specs/{feature}/` (spec.md, plan.md, .beads-id, beads/, checklists/)

## Task Tracking

Beads (`bd`) is the **sole source of truth** for task execution state:

1. **Task Creation**: `/plan-to-beads` generates idempotent `beads/*.sh` scripts
2. **Task Import**: User runs `beads/import-all.sh` to populate beads
3. **Execution Loop**: `bd prime` → `bd ready` → `bd update <id> --status in_progress` → code → `bd close <id>` → `bd sync`

## Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Desktop | Tauri v2 | WebView2 (Win), native WebView (macOS) |
| Frontend | React 19 + Tailwind v4.2 | CodeMirror 6 for code display |
| Web Server | Fastify (Node.js) | Dev/test + future Matter Portal |
| Engine | Rust via napi-rs v3 | 6 core functions, auto-generated .d.ts |
| Database | SQLite (better-sqlite3) | Local-first, WAL mode |
| Lint (TS) | Biome | Lint + format |
| Lint (Rust) | cargo clippy + cargo fmt | --deny warnings |
| Test (TS) | Vitest + Playwright | Unit + E2E |
| Test (Rust) | cargo test | Unit + golden-hash fixtures |
