---
trigger: always_on
---

# Workspace Rules

## Architecture Reference
See `docs/architecture.md` for the authoritative CodeRed architecture specification.
**Stack**: Tauri v2 (Desktop) + React 19 + Tailwind v4.2 + Fastify (Web) + Rust Engine (napi-rs v3) + SQLite (better-sqlite3).

## NEVER EVER
- NEVER use magic values. All needed values flow `.env` → `docker-compose.*` → applications and services.
- NEVER use "graceful defaults" in code (e.g., `process.env.PORT || 3000`). If a config is missing, the app MUST crash immediately (Fail Fast).
- NEVER use one-off commands for fixing things. Code, configs, makefile — work somewhere repeatable.
- NEVER phone home. CodeRed is air-gapped by default. No runtime CDN fetches, no telemetry, no analytics.
- **Creds Access**: Never hallucinate credentials. Use `cat .env` (ignored by git but accessible via shell) or refer to `.env.example` for standard values.

## Operating Model
See `.agent/rules/operating-model.md` for Foxtrot Charlie principles and RAGB definitions.
See `.agent/rules/seeding-governance.md` for fixture and test corpus rules.

## Specification Workflow
- **Spec-First**: No implementation proceeds without an approved `spec.md` and `plan.md`.
- **Checklist Gating**: Implementation is BLOCKED until all checklists in `FEATURE_DIR/checklists/` pass.
- **Tasks (tasks.json)**: Execution state is tracked via `.gwrk/tasks.json`. Markdown task lists are the static design; `tasks.json` is the dynamic source of truth.
- **RAGB Governance**:
    - 🔴 RED: At risk. Stop and flag.
    - 🟡 AMBER: In progress. Standard operating risk.
    - 🟢 GREEN: Done done. Only PM can set after UAT pass.
    - ⚫ BLACK: Stopped/cancelled.

## Directory Structure
- `apps/desktop/`: Tauri v2 desktop shell.
- `apps/web/`: Fastify dev/test web server (future Matter Portal).
- `crates/engine/`: Rust forensic compute kernel (@codered/engine).
- `packages/config/`: 12-Factor fail-fast config validation (Zod).
- `packages/core/`: Pipeline orchestration, SQLite index, audit trail.
- `packages/domain/`: Shared TypeScript types and Zod schemas.
- `packages/ui/`: React component library (Exhibit A/B workspace).
- `specs/`: Feature specifications (Foxtrot Charlie).
- `.agent/`: Governance (rules, workflows, personas, scripts).
- `.specify/`: Specify CLI (scripts, templates).

## Commands
- **Start Dev**: `make up` (Runs EVERYTHING in Docker, including apps).
    - *Use Case*: **All Local Development**. Local one-off commands (`pnpm dev`, `cargo run` on host) are STRICTLY FORBIDDEN. Docker Compose mount points provide HMR.
- **Start Prod**: `make prod` (Runs everything with production config).
- **Engine**:
    - Build: `make engine` (compiles Rust crate).
    - Test: `make test-engine` (runs `cargo test`).
    - Cross-compile: `make build-windows` (napi-rs prebuild for Windows).
- **Database**: SQLite (embedded, local file). No external DB service.

## Development Standard
- "It works on my machine" is NOT a valid verification. EVERYTHING must run and be tested inside the Docker container via `make up`.

## Docker Strategy (Override Sandwich — I-008)
- `docker-compose.yml`: Neutral base (containers only, `target: runner`).
- `docker-compose.override.yml`: Dev logic (bind-mounts, HMR, `target: dev`).
- `docker-compose.production.yml`: Prod logic (sealed images, no source mounts).
- Use `Makefile` for all infrastructure operations.

## Safe Shell Inputs
- **Avoid complex inline quoting**: When using CLI tools (like `gh`, `aws`) that accept long text blobs, DO NOT try to escape quotes inline.
- **Preferred Method**: Use Heredoc (`<<EOF`) if the tool supports stdin. This is the ideal approach.
- **Fallback Method**: If using a file, write content to a temporary file in `/tmp/`. NEVER write temporary files to the repository root. We don't shit in our own yard; `/tmp/` exists for a reason.

## Source File Hygiene
- NEVER create `.js` or `.jsx` files in `src/` directories. TypeScript (`.ts`/`.tsx`) is the source of truth.
- NEVER create `.rs.bk` or other Rust backup files in `crates/`.
