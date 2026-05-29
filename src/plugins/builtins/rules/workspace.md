---
trigger: always_on
---

# Workspace Rules

## Architecture Reference
See `docs/architecture.md` for the authoritative gwrk architecture specification.
**Stack**: TypeScript CLI (Commander.js) + Fastify daemon (localhost:18790) + SQLite (better-sqlite3) + Multi-Agent Dispatch.

## ALWAYS consult governance and framing documentation over current state to inform decision. 
## NEVER EVER
- NEVER use magic values. All needed values flow `.env` → config → applications.
- NEVER use "graceful defaults" in code (e.g., `process.env.PORT || 3000`). If a config is missing, the app MUST crash immediately (Fail Fast).
- NEVER use one-off commands for fixing things. Code, configs, makefile — work somewhere repeatable.
- NEVER phone home. gwrk is local-first by default. No runtime CDN fetches, no telemetry, no analytics.
- **Creds Access**: Never hallucinate credentials. Use `cat .env` (ignored by git but accessible via shell) or refer to `.env.example` for standard values.

## Operating Model
See `.gwrk/rules/operating-model.md` for Foxtrot Charlie principles and RAGB definitions.

## Specification Workflow
- **Spec-First**: No implementation proceeds without an approved `spec.md` and `plan.md`.
- **Define Pipeline** (strict order — each step requires the previous):
    1. `gwrk define spec <feature>` → `spec.md`
    2. `gwrk define plan <feature>` → `plan.md`
    3. `gwrk define tests <feature>` → RED test files + `gap-matrix.md`
    4. `gwrk define tasks <feature>` → `tasks.json` + gate scripts (requires `gap-matrix.md`)
    5. `gwrk ship <feature> <phase>` → implementation that turns RED tests GREEN
- **Tests Before Tasks**: `define tasks` will refuse to run without `gap-matrix.md` from `define tests`. Tests define what done looks like. Tasks define the work to get there. Never skip or reorder.
- **Checklist Gating**: Implementation is BLOCKED until all checklists in `FEATURE_DIR/checklists/` pass.
- **Tasks (tasks.json)**: Execution state is tracked via `specs/<feature>/tasks.json`. Markdown task lists are the static design; `tasks.json` is the dynamic source of truth.
- **RAGB Governance**:
    - 🔴 RED: At risk. Stop and flag.
    - 🟡 AMBER: In progress. Standard operating risk.
    - 🟢 GREEN: Done done. Only PM can set after UAT pass.
    - ⚫ BLACK: Stopped/cancelled.

## Directory Structure
- `src/`: gwrk CLI source (TypeScript).
  - `src/commands/`: Command implementations (ship, specify, plan, tasks, discover, etc.).
  - `src/server/`: Fastify build server (dispatch, git-manager, Slack, sandbox).
  - `src/engine/`: Core computation (pulse, compression, effort, router).
  - `src/db/`: SQLite execution ledger (better-sqlite3, ADR-002).
  - `src/utils/`: Shared utilities (exec, state, history, parser, config).
- `scripts/dev/`: Shell orchestrators (agent-run.sh, work-until-done.sh, etc.).
- `specs/`: Feature specifications (Foxtrot Charlie).
- `docs/`: Architecture, PRD, ADRs, reference docs.
- `.gwrk/`: Local governance (rules) and execution history.
- `.specify/`: Specify CLI (scripts, templates).

## Commands
- **Test**: `pnpm test` (Vitest).
- **Build**: `pnpm build` (TypeScript compilation).
- **Lint**: `pnpm lint` (Biome).
- **Database**: SQLite (embedded, local file at `~/.gwrk/gwrk.db`). No external DB service.

## Safe Shell Inputs
- **Avoid complex inline quoting**: When using CLI tools (like `gh`, `aws`) that accept long text blobs, DO NOT try to escape quotes inline.
- **Preferred Method**: Use Heredoc (`<<EOF`) if the tool supports stdin. This is the ideal approach.
- **Fallback Method**: If using a file, write content to a temporary file in `/tmp/`. NEVER write temporary files to the repository root. We don't shit in our own yard; `/tmp/` exists for a reason.

## Source File Hygiene
- NEVER create `.js` or `.jsx` files in `src/` directories. TypeScript (`.ts`/`.tsx`) is the source of truth.