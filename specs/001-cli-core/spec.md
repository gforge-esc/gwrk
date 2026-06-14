---
type: specification
feature: 001-cli-core
last_modified: "2026-05-30T00:18:00Z"
revision: 3
---

# Feature Specification: 001 CLI Core

**Feature Branch**: `001-cli-core`
**Created**: 2026-02-26
**Revised**: 2026-03-06
**Status**: Active (Rewrite v3)
**Input**: gwrk CLI — the TypeScript entry point, hierarchical command routing, flat-file task tracking with Hard Gate enforcement, agent dispatch wrappers, SQLite execution ledger, shell-script orchestration passthroughs, project-aware prompt conditioning, and unified interactive onboarding.

---

## 1. Design Decisions

### Command Taxonomy

The CLI uses a **Foxtrot Charlie pillar-based hierarchy** to organize commands by user intent (Clarity → Throughput → Value).

| Pillar | Category | Commands | Purpose |
|---|---|---|---|
| **Clarity** | **Define** | `define <feature>`, `define spec`, `define plan`, `define tasks` | Specification, planning, and task decomposition (definition loop) |
| **Throughput**| **Ship** | `ship <feature> <phase>` | Full autonomous shipping lifecycle (branch→implement→review→PR→CI) |
| **Value** | **Measure**| `measure pulse`, `measure effort`, `measure compression` | Productivity, estimation, and ratio reporting |
| **-** | **Task Engine** | `tasks list`, `tasks next`, `tasks done` | Task state management with Hard Gate enforcement |
| **-** | **Data** | `db runs`, `db stats` | SQLite execution ledger queries |
| **-** | **Scaffolding**| `init` | Project onboarding (profile, workstation, Slack, agents) |
| **-** | **Diagnostics** | `project info` | Project profile introspection |

### Architecture Principles

1. **Shell scripts ARE the product.** `define` and `ship` are thin CLI wrappers around `scripts/dev/define-until-solid.sh` and `scripts/dev/work-until-done.sh`. The TS layer adds SQLite run recording, manifest writing, and CLI UX — it does NOT reimplement orchestration logic.
2. **Git-native task state.** `tasks.json` lives in `specs/<feature>/.gwrk/tasks.json` alongside the spec. Branch checkouts carry isolated state.
3. **SQLite is the analytical ledger.** `~/.gwrk/gwrk.db` records execution history for compression tracking and agent routing. It is NOT the source of truth for task state.
4. **Fail-fast config.** Zod validation with no `.default()` calls. Missing config → `process.exit(1)`.
5. **Quiet agent output.** All agent dispatch uses `spawn` with piped stdio, timestamped progress lines, and full output logged to `.runs/`. Agent narration MUST NOT dump raw to the terminal. Callers use `quiet: true` for spinner-only mode.
6. **Private by default.** All local data (SQLite, tasks) and upstream integrations (GitHub visibility) default to private.

---

## 2. User Scenarios & Acceptance Criteria

### US-001 - Project Initialization (P0) ⭐ **REWRITE (2026-05-30 R3)**
As a PE, I want `gwrk init` to be a comprehensive interactive wizard that provisions everything gwrk needs to operate on this project — project profile, workstation config, Slack channel, agent detection — so that one command gets me fully operational whether this is a new project or an existing one.

**Implements**: FR-001, FR-022, FR-030, FR-031, FR-032

**Acceptance**:
1. `gwrk init` auto-detects project type from filesystem signals and presents for confirmation: "Detected: pnpm-monorepo (typescript). Correct? [Y/n]"
2. Walks through profile sections interactively: stack (language, framework, build, test, package manager), source layout, architecture docs, conventions.
3. Detects installed agent CLIs (`which gemini`, `which claude`, `which codex`) and configures `agents` block.
4. Runs workstation provisioning steps (TCC guidance, SSH key gen, gh auth check) — absorbs former `gwrk setup` behavior.
5. Provisions Slack channel if tokens available: "Slack channel name? [project-name]" → creates via API.
6. Writes complete `.gwrkrc.json` with full project profile.
7. Scaffolds directories: `.gwrk/`, `.gwrk/rules/`, `.specify/templates/`, `specs/`, `~/.gwrk/plugins/{skills,agents,workflows}/`.
8. Seeds skills, workflows, rules, and git hooks from builtins.
9. Registers project in `~/.gwrk/gwrk.db`.
10. Running `gwrk init` again shows current config and offers to update (idempotent).
11. `--non-interactive` flag uses auto-detection for all fields with zero prompts (CI/scripting path).
12. `--agent` flag: agent-optimized mode — auto-detect, zero prompts, structured JSON to stdout, relaxed pre-requisites (no gh auth or SSH required), graceful skip for unavailable steps. Designed for agent-driven project bootstrapping (e.g., setting up `gwrk-plugins` from a gwrk session).
13. Final output: summary of everything provisioned (interactive/non-interactive) or JSON status (agent mode).

> **Note**: This absorbs former US-021 (`gwrk setup`). The `setup` command is removed. Workstation provisioning steps (TCC, SSH, gh) are integrated as steps within `init`.

### US-002 - Agent Specification (P0)
As a PE, I want `gwrk define spec <feature> [--refs <path>]` to dispatch the `/specify` workflow.

**Implements**: FR-002

**Acceptance**:
1. `gwrk define spec "a calculator"` dispatches the configured agent and streams output to terminal.
2. Agent exit code propagates to CLI exit code.
3. `--dry-run` prints the agent backend and workflow path without dispatching.

### US-003 - Agent Planning (P0)
As a PE, I want `gwrk define plan <feature> [--refs <path>]` to generate `plan.md`.

**Implements**: FR-003

**Acceptance**:
1. `gwrk define plan 001-cli-core` dispatches the agent with `/plan` workflow.
2. If `spec.md` is missing, exits 1 with `spec.md not found`.
3. If `spec.md` is marked `**Status:** Stub`, exits 1 with `[BLOCKED]` error.
4. `--dry-run` prints the agent backend and workflow path without dispatching.

### US-004 - Task Decomposition (P0)
As the definition engine, I want `gwrk define tasks <feature>` to create tasks.json + gate scripts from plan.md.

**Implements**: FR-004

**Acceptance**:
1. Creates `specs/<feature>/.gwrk/tasks.json` with valid schema.
2. Creates `gates/T0xx-gate.sh` for every task.
3. Gate count equals task count.

### US-005 - Task State Query (P0)
As a ship engine, I want `gwrk tasks list <feature>` and `gwrk tasks next <feature> <phase>` to discover work.

**Implements**: FR-005

**Acceptance**:
1. `gwrk tasks list <feature>` shows all tasks with status indicators.
2. `gwrk tasks list <feature> --json` returns valid JSON.
3. `gwrk tasks next <feature> <phase>` returns the next open task.
4. When no open tasks remain, `gwrk tasks next` prints exactly: `All tasks completed or phase not found`.

### US-006 - Hard Gate Enforcement (P0)
As the ship engine, I want `gwrk tasks done <feature> <taskId>` to execute the gate script and only update state on exit 0.

**Implements**: FR-006

**Acceptance**:
1. Failing gate → exit 1, state unchanged.
2. Passing gate → exit 0, task marked `completed`, history.jsonl entry appended.
3. Missing gate → exit 1 with `CRITICAL: gates/<taskId>-gate.sh not found`.
4. Already completed → exit 1 with `Task <taskId> already completed`.
5. After success: `tail -1 .gwrk/history.jsonl | jq -r '.taskId'` returns the completed task ID.
6. After success: `tail -1 .gwrk/history.jsonl | jq -r '.toStatus'` returns `completed`.

### US-007 - Status Transition History (P1)
As the compression engine, I want state transitions appended to `.gwrk/history.jsonl`.

**Implements**: FR-007

**Acceptance**:
1. After `gwrk tasks done` succeeds, `tail -1 .gwrk/history.jsonl | jq -r '.taskId'` returns the task ID.

### US-008 - Configuration Validation (P0)
As a developer, I want `.gwrkrc.json` validated by Zod at startup.

**Implements**: FR-008

**Acceptance**:
1. Missing `.gwrkrc.json` → exit 1 with `Configuration file .gwrkrc.json not found`.
2. Invalid schema → exit 1 with Zod error.
3. Valid config → command proceeds.

### US-010 - Effort Estimation (P1)
As a PE, I want `gwrk measure effort <feature>` to generate SP-driven estimates.

**Implements**: FR-010

**Acceptance**:
1. Creates `docs/assessments/effort-<feature>-<date>.md`.

### US-011 - Define Pillar (P0)
As a PE, I want `gwrk define <feature>` to run the full DUS loop: spec→plan→tasks→checklist→analyze→tests.

**Implements**: FR-011

**Acceptance**:
1. Wraps `scripts/dev/define-until-solid.sh`.
2. Records run in SQLite (start time, exit code, duration).
3. Streams output to terminal.
4. `--dry-run` prints the command without executing.
5. `analyze`, `checklist`, and `tests` run internally as DUS stages.

### US-012 - Ship Pillar (P0)
As a PE, I want `gwrk ship <feature> <phase>` to dispatch agent implementation.

**Implements**: FR-012

**Acceptance**:
1. Wraps `scripts/dev/agent-run.sh implement`.
2. Records run in SQLite.
3. Streams output to terminal.

### US-013 - Ship (Full Lifecycle) (P0)
As a PE, I want `gwrk ship <feature> <phase> [--max-iterations] [--ci-timeout]` to run the full autonomous lifecycle: branch → implement → review → PR → CI.

**Implements**: FR-013

**Acceptance**:
1. Wraps `scripts/dev/work-until-done.sh`.
2. Records run in SQLite.
3. Supports `--max-iterations` and `--ci-timeout`.
4. Streams output to terminal.
5. Creates feature branch, pushes commits, creates PR, waits for CI.

### US-014 - Execution History Query (P1)
As a PE, I want `gwrk db runs <feature>` to show execution history.

**Implements**: FR-014

**Acceptance**:
1. Renders a table with column headers: `#`, `Command`, `Phase`, `Agent`, `Exit`, `Duration`, `Started`.
2. `--json` returns structured output.
3. When no runs exist, prints `No runs found for <feature>`.

### US-015 - Aggregate Statistics (P1)
As a PE, I want `gwrk db stats` to show success rates by command/agent.

**Implements**: FR-015

**Acceptance**:
1. Shows aggregate stats: command, workflow, agent, run count, success%, avg duration.

### US-016 - Compression Tracking (P1)
As a PE, I want `gwrk measure compression <feature>` to show SP vs actual delivery time.

**Implements**: FR-016

**Acceptance**:
1. Shows point compression, total compression, coding time, elapsed window.

### US-017 - Pulse Dashboard (P1)
As a PE, I want `gwrk measure pulse [--days N]` to scan git history and show productivity metrics.

**Implements**: FR-017

**Acceptance**:
1. `gwrk measure pulse` scans git log.
2. Shows commit density, active features, recent activity.

### US-018 - CLI E2E Surface Verification (P0)
As a developer, I want `gwrk --help` to show exactly the settled command hierarchy with no stubs.

**Implements**: FR-018

**Acceptance**:
1. `gwrk --help` shows: `init`, `define`, `ship`, `measure`, `db`, `tasks`.
2. `gwrk define --help` shows: `spec`, `plan`, `tasks`.
3. `gwrk ship --help` shows options: `--dry-run`, `--max-iterations`, `--ci-timeout`, `--agent`.
4. `gwrk measure --help` shows: `pulse`, `effort`, `compression`.
5. `gwrk db --help` shows: `runs`, `stats`.
6. No other top-level commands exist (no `specify`, `plan`, `analyze`, `effort`, `pulse`, `metrics`, `run`, `implement`).

### US-019 - Execution Manifest Writer (P1)
As a PE, I want every `gwrk ship` and `gwrk define` run to write a structured execution manifest to `specs/<feature>/.gwrk/runs/` so that distributed agents produce durable analytical data via git alone.

**Implements**: FR-019

**Acceptance**:
1. After any `ship` or `define` run completes, a JSON manifest is written to `specs/<feature>/.gwrk/runs/<timestamp>_<command>_<phase>_<agent>.json`.
2. Manifest contains: `runId`, `feature`, `phase`, `command`, `agent`, `model`, `startedAt`, `finishedAt`, `durationS`, `exitCode`, `attempt`, `gateResult`, `reviewVerdict`, `filesChanged`, `linesAdded`, `linesDeleted`, `gitCommit`, `gitBranch`.
3. Manifest is committed alongside code changes by the agent.
4. Manifest file size is under 1KB.

### US-020 - Post-Merge Task Verification (P1)
As a PE, I want `gwrk tasks verify <feature>` to validate task state integrity after merge operations.

**Implements**: FR-020

**Acceptance**:
1. Validates `tasks.json` schema via Zod.
2. Checks every `completed` task has a corresponding execution manifest in `runs/`.
3. Reports orphaned tasks (manifest exists but task is not `completed`) or regressed tasks (was `completed`, now `open`).
4. Exit 0 if clean, exit 1 with report if issues found.

### US-021 - Workstation Setup (P1) ⭐ **ABSORBED into US-001 (R3)**
_This user story is fully absorbed into US-001 (Project Initialization). The `gwrk setup` command is removed. Workstation provisioning (TCC, SSH, gh) is integrated as interactive steps within `gwrk init`. See US-001 acceptance criteria 4._

**Implements**: FR-022 (now delivered via FR-001)

**Acceptance**: See US-001.

### US-022 - Help Text Examples (P1)
As a developer, I want every command with arguments to show concrete `Examples:` in `--help` output so I can discover the correct syntax without guessing.

**Implements**: FR-023

**Acceptance**:
1. `gwrk ship --help` shows at least 3 examples.
2. `gwrk define spec --help` shows at least 2 examples.
3. `gwrk define plan --help` shows at least 2 examples.
4. `gwrk define tasks --help` shows at least 2 examples.
5. `gwrk tasks list --help` shows at least 2 examples.
6. `gwrk tasks done --help` shows at least 2 examples.
7. `gwrk tasks next --help` shows at least 2 examples.
8. `gwrk measure pulse --help` shows at least 2 examples.
9. `gwrk measure effort --help` shows at least 2 examples.
10. `gwrk measure compression --help` shows at least 2 examples.
11. `gwrk db runs --help` shows at least 2 examples.
12. `gwrk test --help` shows at least 2 examples.

### US-023 - Feature-Arg Consistency (P1)
As a developer, I want all feature-scoped commands to accept feature as the first positional argument after the verb so the CLI feels predictable.

**Implements**: FR-024

**Acceptance**:
1. Every command accepting `<feature>` has it as positional arg 1 (after the subcommand verb if applicable).
2. No command requires feature as a flag or in a non-standard position.
3. Every command accepting `<feature>` calls `resolveFeature()` to resolve prefix aliases (e.g., `001` → `001-cli-core`). Specifically: `define plan`, `define tests`, `db runs`, and `harvest` are currently missing this.
4. `gwrk define plan 001` resolves to `001-cli-core` and succeeds.
5. `gwrk define tests 001` resolves to `001-cli-core` and succeeds.
6. `gwrk db runs 001` resolves to `001-cli-core` and succeeds.

### US-024 - No Duplicate Surfaces (P1)
As a developer, I want each capability exposed through exactly one command path so I'm never confused by overlapping commands with different interfaces.

**Implements**: FR-025

**Acceptance**:
1. `gwrk project gates` is removed. ✅ (Done — 2026-05-07)
2. No two commands provide the same functionality with different argument syntax.

### US-025 - CLI Grammar Governance (P1)
As a maintainer, I want a documented CLI grammar standard so new commands are consistent by default.

**Implements**: FR-026

**Acceptance**:
1. `docs/governance/cli-grammar.md` exists.
2. Documents the canonical grammar: `gwrk <verb> [subverb] <feature> [phase] [--options]`.
3. Lists all current commands with their argument patterns.
4. Defines the rules for adding new commands.

### US-026 - Define Pillar Output Parity (P0) ⭐ **NEW (2026-05-13)**
As a PE, I want all `define` subcommands (`define spec`, `define plan`, `define tasks`, `define tests`) to have the same quiet, logged output as `ship` — no raw agent narration in the terminal, progress via spinner or timestamped summary lines, full output in `.runs/` log files — so that the CLI presents a consistent, professional UX across all Foxtrot Charlie pillars.

**Implements**: FR-028, FR-029

**Acceptance**:
1. `gwrk define spec 001` shows a spinner or timestamped summary lines, not raw agent narration.
2. `gwrk define tests 003 --force` shows a spinner, not hundreds of lines of agent thinking.
3. Agent output is written to `.runs/` log file for debugging.
4. When an agent commits work natively but returns prose instead of JSON, the command exits 0 (not 1).
5. `gwrk define plan 001` and `gwrk define tasks 001` follow the same pattern.

### US-027 - Project Profile Auto-Detection (P0) ⭐ **NEW (2026-05-30 R3)**
As a PE, I want gwrk to auto-detect my project's tech stack, source layout, and build system from filesystem signals, so that workflows produce correct artifacts without manual configuration.

**Implements**: FR-030, FR-031

**Acceptance**:
1. **Given** a project with `package.json` containing `"workspaces"` and `pnpm-workspace.yaml`, **When** auto-detection runs, **Then** profile resolves: `type: "pnpm-monorepo"`, `stack.packageManager: "pnpm"`, `stack.testFramework` from devDependencies.
2. **Given** a project with `Cargo.toml`, **When** auto-detection runs, **Then** profile resolves: `type: "rust-workspace"` or `"rust-binary"`, `stack.language: "rust"`, `stack.buildSystem: "cargo"`.
3. **Given** a project with `pyproject.toml`, **When** auto-detection runs, **Then** profile resolves: `type: "python-package"`, `stack.language: "python"`, `stack.testFramework` from `[tool.pytest]` or `[tool.tox]`.
4. **Given** a project with `docs/architecture.md` (gwrk-specific), **When** auto-detection runs, **Then** profile resolves: `type: "gwrk-native"`.
5. **Given** an empty directory, **When** auto-detection runs, **Then** profile resolves: `type: "unknown"`. No error.
6. **Given** explicit profile in `.gwrkrc.json` AND auto-detection results, **When** profile resolves, **Then** explicit config wins on every field; auto-detected fields fill gaps.
7. Auto-detection runs on every workflow invocation as a fallback when `.gwrkrc.json` profile fields are missing.

### US-028 - Project-Aware Prompt Conditioning (P0) ⭐ **NEW (2026-05-30 R3)**
As a PE, I want the resolved project profile injected into every workflow prompt, so that `define plan`, `ship`, and `review` produce artifacts grounded in my project's actual architecture — not gwrk's.

**Implements**: FR-033, FR-034

**Acceptance**:
1. **Given** a pnpm monorepo profile, **When** `gwrk define plan` runs, **Then** the prompt contains a `<project_profile>` XML block with detected type, stack, and layout. Plan references `apps/` and `packages/` — NOT `src/commands/`.
2. **Given** a `gwrk-native` profile, **When** any workflow runs, **Then** all current gwrk-native prompt sections are included verbatim. No behavioral regression.
3. **Given** a non-gwrk project, **When** `gwrk ship` UAT runs, **Then** review evaluates the project's commands — NOT gwrk CLI commands. No ADR-004, no `[exit:N|Xs]` checks.
4. **Given** a non-gwrk project, **When** `gwrk ship` author-gates runs, **Then** gate patterns match the project's test framework (jest, pytest, cargo test) — NOT vitest-only.
5. All 15 PROMPT.md files are refactored: gwrk-native sections gated behind `type: "gwrk-native"`, generic sections for everything else.

### US-029 - Project Profile Introspection (P1) ⭐ **NEW (2026-05-30 R3)**
As a PE, I want `gwrk project info` to show me what gwrk thinks my project is, so that I can debug prompt contamination when it happens.

**Implements**: FR-035

**Acceptance**:
1. `gwrk project info` shows: type, stack (all fields), layout, architecture docs found/missing, conditioning mode (gwrk-native vs generic), source of each field (auto-detected vs explicit).
2. `--format json` returns valid JSON matching `ProjectProfileSchema`. Pipeable to jq.

### US-030 - Project-Scoped DB Isolation (P0) ⭐ **NEW (2026-06-01)**
As a PE, I want my project data (plans, runs, stats) to be isolated by project in the global SQLite database, so that using gwrk on multiple projects doesn't lead to cross-project pollution or leaked features.

**Implements**: FR-036, FR-037, FR-038, FR-039, FR-040

**Acceptance**:
1. `gwrk plan status` on Project A only shows features belonging to Project A.
2. `gwrk db runs` only shows runs for the current project.
3. `gwrk db stats` aggregates stats only for the current project.
4. `gwrk tasks next` correctly identifies the next task for the current project even if multiple projects are being managed in the same workstation.
5. Project ID is derived canonically using `MD5(projectRoot)`.

---

## 3. Functional Requirements

- **FR-001**: ⭐ **REWRITE (R3)** `gwrk init` — Comprehensive interactive onboarding wizard. Auto-detects project profile, provisions workstation (TCC, SSH, gh), clones plugin registry, detects extensions, configures agents, provisions Slack, scaffolds directories, seeds plugins. Absorbs former `gwrk setup`. Idempotent. Supports `--non-interactive` for CI and `--agent` for agent-driven bootstrapping. (US-001, US-021, US-032)
- **FR-046**: ⭐ **NEW (2026-06-14)** `gwrk init --agent` — Agent-optimized init mode. MUST: (1) auto-detect project type with zero prompts, (2) write `.gwrkrc.json` with detected profile, (3) scaffold required directories, (4) skip workstation provisioning steps that require human interaction (TCC, SSH, Slack), (5) skip steps that fail gracefully (gh auth, registry clone if offline), (6) output structured JSON to stdout: `{"status": "ok", "profile": {...}, "created": [...], "skipped": [...]}`, (7) exit 0 on success, exit 1 on fatal error (not in git repo). Differs from `--non-interactive`: agent mode outputs JSON (not human summary), relaxes pre-requisites, and is designed for programmatic consumption by other gwrk agents. (US-001)
- **FR-002**: `gwrk define spec <feature>` — dispatch `/specify` workflow. Streaming. (US-002)
- **FR-003**: `gwrk define plan <feature>` — dispatch `/plan` workflow. Validate spec exists and is not a Stub. (US-003)
- **FR-004**: `gwrk define tasks <feature>` — parse plan.md → tasks.json + gate scripts. (US-004)
- **FR-005**: `gwrk tasks list/next` — query task state. (US-005)
- **FR-006**: `gwrk tasks done <feature> <taskId>` — gate-enforced state transition. (US-006)
- **FR-007**: History.jsonl append on every state transition. (US-007)
- **FR-008**: Zod config validation, fail-fast. (US-008)
- **FR-010**: `gwrk measure effort <feature>` — deterministic SP estimation. (US-010)
- **FR-011**: `gwrk define <feature>` — DUS loop wrapper with SQLite recording. (US-011)
- **FR-012**: `gwrk implement <feature> <phase>` — Internal agent dispatch wrapper with SQLite recording. (US-012)
- **FR-013**: `gwrk ship <feature> <phase>` — Autonomous ship loop wrapper with SQLite recording. (US-013)
- **FR-014**: `gwrk db runs <feature>` — query execution history. (US-014)
- **FR-015**: `gwrk db stats` — aggregate success rates. (US-015)
- **FR-016**: `gwrk measure compression <feature>` — SP vs actual. (US-016)
- **FR-017**: `gwrk measure pulse` — git log scanner. (US-017)
- **FR-018**: CLI surface shows exactly the settled hierarchy. No stubs. (US-018)
- **FR-019**: Execution manifest writer. Every `ship`/`define` run → `.gwrk/runs/*.json`. (US-019)
- **FR-020**: `gwrk tasks verify <feature>` — post-merge schema + orphan + regression check. (US-020)
- **FR-021**: `history.jsonl` deprecation. Reads still supported; writes redirected to `gwrk.db history` + manifest. Removal deferred until `gwrk harvest` is operational.
- **FR-022**: ⭐ **ABSORBED into FR-001 (R3)** Workstation provisioning (TCC, SSH, gh auth, `setup.json`) is now delivered as interactive steps within `gwrk init`. The standalone `gwrk setup` command is removed. Ship pre-flight still checks `~/.gwrk/setup.json`. (US-001)
- **FR-023**: Every command with arguments MUST include an `Examples:` section in `--help` output. (US-022)
- **FR-024**: Feature-arg consistency. All feature-scoped commands accept feature as first positional argument AND call `resolveFeature()` for prefix resolution. (US-023)
- **FR-025**: No duplicate command surfaces. Each capability has exactly one CLI path. (US-024)
- **FR-026**: CLI grammar governance doc at `docs/governance/cli-grammar.md`. (US-025)
- **FR-027**: `gwrk define tests` output contract fix. Agent test file output must not require `gap-matrix.md` when the workflow produces test files directly. The command must accept either `gap-matrix.md` OR test files in `src/` as valid output. (US-022)
- **FR-028**: ⭐ **NEW (2026-05-13)** All `define` subcommands MUST pass `quiet: true` to `WorkflowRuntime.executeWorkflow()`. Terminal output limited to: banner, spinner/progress, success/fail box. (US-026)
- **FR-029**: ⭐ **NEW (2026-05-13)** `WorkflowRuntime.executeWorkflow()` MUST tolerate agents that do work natively and return prose instead of JSON. When `extractJsonFromOutput()` fails, check for committed artifacts. If present, return synthetic success. (US-026)
- **FR-030**: ⭐ **NEW (2026-05-30 R3)** Auto-detect project type from filesystem signals. Detection rules (priority order): 1) `Cargo.toml` → rust, 2) `pyproject.toml` → python, 3) `pnpm-workspace.yaml` → pnpm-monorepo, 4) `package.json` with workspaces → npm/yarn-monorepo, 5) `package.json` without → node-package, 6) `go.mod` → go-module, 7) `docs/architecture.md` → gwrk-native, 8) none → unknown. (US-027)
- **FR-031**: ⭐ **NEW (2026-05-30 R3)** Extract tech stack details: language (from manifests), package manager (from lockfiles), test framework (from devDependencies or config files), build system (from scripts/Makefile/turbo.json), source layout (from workspace globs/tsconfig). (US-027)
- **FR-032**: ⭐ **NEW (2026-05-30 R3)** Extend `GwrkConfigSchema` with optional `project.type`, `project.stack`, `project.layout`, `project.architecture`, `project.conventions`. All optional. Existing `.gwrkrc.json` files MUST continue to parse without error. Explicit config overrides auto-detection field-by-field. (US-027)
- **FR-033**: ⭐ **NEW (2026-05-30 R3)** Inject `<project_profile>` XML block into every workflow prompt at `WorkflowRuntime.executeWorkflow()`, BEFORE the prompt is sent to the agent. Single integration point for all workflows. (US-028)
- **FR-034**: ⭐ **NEW (2026-05-30 R3)** Refactor all 15 PROMPT.md files: architecture references, source layouts, build/test commands, and protocol references (ADR-004, agent-native) MUST be gated behind `type: "gwrk-native"`. Non-gwrk profiles get generic "detect from project" language. (US-028)
- **FR-035**: ⭐ **NEW (2026-05-30 R3)** `gwrk project info` — display resolved profile with: type, stack, layout, architecture, conventions, conditioning mode (gwrk-native vs generic), source of each field (auto vs explicit). Supports `--format json`. (US-029)
- **FR-036**: ⭐ **NEW (2026-06-01)** Canonical `resolveProjectId(cwd)` utility using MD5(projectRoot). (US-030)
- **FR-037**: ⭐ **NEW (2026-06-01)** Migration 009 adds `project_id TEXT` and indexes to 8 tables: `plan_features`, `plan_phases`, `plan_edges`, `plan_proposals`, `gate_results`, `compression`, `issues`, and `routing_history`. (US-030)
- **FR-038**: ⭐ **NEW (2026-06-01)** DB access layer updates: all query functions for the 8 target tables accept and filter by `projectId`. (US-030)
- **FR-039**: ⭐ **NEW (2026-06-01)** `PlanStore` refactor to accept `projectId` and scope all internal DB calls. (US-030)
- **FR-040**: ⭐ **NEW (2026-06-01)** CLI command updates: `plan`, `stats`, and `runs` derive `projectId` from `cwd` and pass it through the engine/DB layers. (US-030)
- **FR-041**: ⭐ **NEW (2026-06-14)** `gwrk plugin search <query>` — Search the local registry at `~/.gwrk/registry/` for matching plugin manifests. (US-031)
- **FR-042**: ⭐ **NEW (2026-06-14)** `gwrk plugin install <id|url>` — Resolve plugin ID from registry or use direct URL. Clone to `~/.gwrk/plugins/`. Validate `manifest.yaml`. (US-031)
- **FR-043**: ⭐ **NEW (2026-06-14)** `gwrk plugin update [id]` — Update installed plugins via `git pull`. (US-031)
- **FR-044**: ⭐ **NEW (2026-06-14)** `gwrk init` Workstation Provisioning MUST clone `https://github.com/gwrk-org/gwrk-plugins` to `~/.gwrk/registry/` if not present, and `git pull` if present. (US-001)
- **FR-045**: ⭐ **NEW (2026-06-14)** `gwrk init` Extension Discovery MUST check for installed CLIs (e.g. `obsidian-cli`) and populate the `extensions` block in `.gwrkrc.json`. (US-032)

### Error States

| FR | Condition | stderr contains | Exit code |
|---|---|---|---|
| FR-001 | Already initialized (no flags) | `gwrk already initialized. Run with --non-interactive to update.` | 0 |
| FR-001 | Not in a git repo | `Not a git repository. Run git init first.` | 1 |
| FR-001 | Not interactive terminal + no --non-interactive/--agent | `Must be run in an interactive terminal, or use --non-interactive/--agent.` | 1 |
| FR-046 | --agent mode, already initialized | `{"status": "ok", "message": "already initialized", "profile": {...}}` (JSON) | 0 |
| FR-046 | --agent mode, not in git repo | `{"status": "error", "message": "Not a git repository"}` (JSON) | 1 |
| FR-003 | spec.md missing | `spec.md not found` | 1 |
| FR-003 | spec.md is Stub | `[BLOCKED] Spec ... is marked as a Stub` | 1 |
| FR-006 | Gate fails | `Gate failed for <taskId>` | 1 |
| FR-006 | Gate missing | `CRITICAL: gates/<taskId>-gate.sh not found` | 1 |
| FR-006 | Already completed | `Task <taskId> already completed` | 1 |
| FR-008 | Config missing | `Configuration file .gwrkrc.json not found` | 1 |
| FR-008 | Config invalid | `Configuration error: <zod message>` | 1 |
| FR-001 | gh CLI not authenticated | `gh auth status failed — re-run gwrk init` | 1 |
| FR-001 | SSH key generation fails | `Failed to generate SSH key` | 1 |
| FR-001 | Workstation setup incomplete (ship pre-flight) | `Run gwrk init first` | 1 |
| FR-030 | Detection returns unknown | (no error — graceful degradation) | 0 |
| FR-032 | Invalid project.stack schema | `Configuration error in .gwrkrc.json: project.stack.language must be a string` | 1 |
| FR-035 | Not a gwrk-managed directory | `Not a gwrk project. Run gwrk init to set up this project.` | 1 |

---

## 4. Data Model

### DM-001: Task State (`specs/<feature>/.gwrk/tasks.json`)

```typescript
interface TaskState {
  featureId: string;
  createdAt: string;          // ISO 8601
  phases: Phase[];
}

interface Phase {
  id: string;                 // "phase-01"
  title: string;
  tasks: Task[];
}

interface Task {
  id: string;                 // "T001"
  title: string;
  description: string;
  status: "open" | "in_progress" | "completed";
  gateScript: string;         // "gates/T001-gate.sh"
  completedAt?: string;
}
```

### DM-002: History Log (`.gwrk/history.jsonl`) — **DEPRECATED**

Append-only JSONL per state transition. Superseded by `gwrk.db history` table and `git log --follow tasks.json`. Will be removed once `gwrk harvest` is operational. See [ADR-003](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-003-state-contract.md).

### DM-005: Execution Manifest (`specs/<feature>/.gwrk/runs/*.json`)

Git-tracked structured JSON per agent run. See [ADR-003](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-003-state-contract.md) §3 for full schema.

```typescript
interface ExecutionManifest {
  runId: string;          // "2026-03-08T14:02:33Z_ship_p01"
  feature: string;
  phase: string;
  command: string;        // "ship" | "define"
  agent: string;          // "gemini" | "claude" | "codex" | "codex-cloud"
  model: string;
  startedAt: string;      // ISO 8601
  finishedAt: string;
  durationS: number;
  exitCode: number;
  attempt: number;
  gateResult?: string;
  reviewVerdict?: string;
  filesChanged?: number;
  linesAdded?: number;
  linesDeleted?: number;
  gitCommit: string;
  gitBranch: string;
}
```

### DM-003: Configuration (`.gwrkrc.json`) ⭐ **EXTENDED (R3)**

Validated by Zod at startup. No defaults. Extended with optional project profile fields.

```typescript
interface GwrkConfig {
  project: {
    name: string;
    githubRepo?: string;
    slack?: {
      channelId?: string;
      channelName?: string;
      opsChannelId?: string;
      opsChannelName?: string;
      webhookUrl?: string;
    };
    // R3: Project Profile (all optional — auto-detected if missing)
    type?: string;             // e.g., "pnpm-monorepo", "gwrk-native", "python-package", "unknown"
    stack?: {
      language?: string;       // e.g., "typescript", "python", "rust"
      framework?: string;      // e.g., "next.js", "fastify", "django"
      buildSystem?: string;    // e.g., "turbo", "tsc", "cargo"
      testFramework?: string;  // e.g., "vitest", "jest", "pytest"
      packageManager?: string; // e.g., "pnpm", "npm", "yarn", "cargo", "pip"
    };
    layout?: {
      sourceRoot?: string;     // e.g., "src/", "apps/", "lib/"
      apps?: string;           // e.g., "apps/"
      packages?: string;       // e.g., "packages/"
      specs?: string;          // e.g., "specs/"
      docs?: string;           // e.g., "docs/"
    };
    architecture?: {
      doc?: string;            // e.g., "docs/architecture.md", "ARCHITECTURE.md"
      decisions?: string;      // e.g., "docs/decisions/", "docs/adr/"
    };
    conventions?: {
      branchPrefix?: string;   // e.g., "feat/", "feature/"
      testPattern?: string;    // e.g., "*.test.ts", "test_*.py", "*_test.go"
    };
  };
  agents: {
    define: "gemini" | "claude" | "codex";
    implement: "gemini" | "claude" | "codex" | "codex-cloud";
  };
  server?: { ... };
  parallelism?: { ... };
}
```

All `project.type`, `project.stack`, `project.layout`, `project.architecture`, `project.conventions` fields are optional. Missing → auto-detected at runtime. Explicit → overrides auto-detection.

### DM-004: SQLite Execution Ledger (`~/.gwrk/gwrk.db`)

Tables: `projects`, `runs`, `history`. WAL mode. Managed by `better-sqlite3`.

---

## 5. Technical Constraints

- **TC-001**: Sequential task IDs (`T001`, `T002`). No UUIDs.
- **TC-002**: Air-gapped CLI. No network calls. Agents handle network.
- **TC-003**: Fail-fast config. No `.default()`.
- **TC-004**: Hard Gates. Only `gwrk tasks done` can mutate task state.
- **TC-005**: TypeScript only. No `.js` in `src/`.
- **TC-006**: ESM (ES2022).
- **TC-007**: Branch-scoped state. `tasks.json` lives with the spec.
- **TC-008**: Quiet agent output. `spawn` with piped stdio, timestamped progress lines to terminal, full output to `.runs/` log file. No raw agent narration on stdout.
- **TC-009**: ⭐ **NEW (R3)** Single prompt integration point. Profile injection happens in `WorkflowRuntime.executeWorkflow()` and `ship-orchestrator.ts` review dispatch. No workflow-by-workflow injection logic.
- **TC-010**: ⭐ **NEW (R3)** Backward compatibility. gwrk operating on its own codebase MUST produce identical prompt assembly to pre-R3 behavior. Hard regression gate.
- **TC-011**: ⭐ **NEW (R3)** Schema extension backward compat. `GwrkConfigSchema` with new optional fields MUST parse existing `.gwrkrc.json` files without error.

---

## 6. Testing Requirements

- **TR-001**: `src/commands/init.test.ts` — scaffold + idempotency (FR-001)
- **TR-002**: `src/commands/specify.test.ts` — agent dispatch mock (FR-002)
- **TR-003**: `src/commands/plan.test.ts` — agent dispatch + spec validation + stub rejection (FR-003)
- **TR-004**: `src/commands/tasks-generate.test.ts` — plan.md parsing, tasks.json schema, gate scripts (FR-004)
- **TR-005**: `src/commands/tasks-query.test.ts` — list + next queries (FR-005)
- **TR-006**: `src/commands/tasks-done.test.ts` — gate enforcement, state mutation, history append (FR-006, FR-007)
- **TR-007**: `src/utils/state.test.ts` — atomic read/write, Zod validation (FR-006, FR-007)
- **TR-008**: `src/utils/config.test.ts` — Zod schema validation (FR-008)
- **TR-009**: `src/commands/analyze.test.ts` — agent dispatch + stub rejection (FR-009)
- **TR-010**: `src/commands/effort.test.ts` — effort report generation (FR-010)
- **TR-011**: `src/commands/define.test.ts` — shell passthrough + SQLite recording (FR-011)
- **TR-012**: `src/utils/agent.test.ts` — piped dispatch with log file output, quiet mode, 429 squelch (FR-002, FR-003, FR-009)
- **TR-013**: `src/db/db.test.ts` — SQLite schema, startRun, finishRun, listRuns (FR-014, FR-015)
- **TR-014**: `src/commands/runs.test.ts` — execution history query (FR-014)
- **TR-015**: `src/commands/stats.test.ts` — aggregate statistics (FR-015)
- **TR-016**: `src/commands/compression.test.ts` — compression ratio calculation (FR-016)
- **TR-017**: `src/commands/pulse.test.ts` — git log scanning (FR-017)
- **TR-018**: `src/cli.test.ts` — command registration hierarchy (FR-018)
- **TR-019**: `src/cli.e2e.test.ts` — compiled binary E2E: `--help` output, stub rejection (FR-018, FR-003)
- **TR-021**: `src/commands/init.test.ts` — ⭐ **UPDATED (R3)** Init test now covers: interactive profile wizard, workstation provisioning (SSH key gen mock, config write), `setup.json` write, idempotency, ship pre-flight rejection, `--non-interactive` mode. (FR-001, FR-022)
- **TR-022**: Help text examples audit — every command file with arguments includes `Examples:` in addHelpText (FR-023)
- **TR-023**: Feature-arg consistency audit — programmatic check of Commander argument positions (FR-024)
- **TR-024**: No duplicate surfaces audit — no two commands share overlapping functionality (FR-025)
- **TR-025**: CLI grammar doc exists and contains required sections (FR-026)
- **TR-026**: ⭐ **NEW (2026-05-13)** `src/plugins/workflow-runtime.test.ts` — tolerant JSON extraction. (FR-028, FR-029)
- **TR-027**: ⭐ **NEW (R3)** `src/engine/profile-detector.test.ts` — Unit test auto-detection: temp dirs with `package.json`, `Cargo.toml`, `pyproject.toml`, `pnpm-workspace.yaml` → verify correct type/stack/layout resolution. (FR-030, FR-031)
- **TR-028**: ⭐ **NEW (R3)** `src/engine/profile-detector.test.ts` — Test explicit config override: `.gwrkrc.json` with partial profile, verify auto-detected fields fill gaps. (FR-032)
- **TR-029**: ⭐ **NEW (R3)** `src/engine/profile-detector.test.ts` — Test gwrk-native detection: project with `docs/architecture.md` resolves as `gwrk-native`. (FR-030)
- **TR-030**: ⭐ **NEW (R3)** `src/engine/profile-detector.test.ts` — Test unknown project: empty directory resolves as `type: "unknown"` without error. (FR-030)
- **TR-031**: ⭐ **NEW (R3)** `src/engine/prompt-conditioner.test.ts` — Unit test prompt conditioning: given a profile, verify `<project_profile>` XML block generated and injected. Verify gwrk-native profile preserves ADR-004/Commander.js sections. Verify non-gwrk profile omits them. (FR-033, FR-034)
- **TR-032**: ⭐ **NEW (R3)** `src/commands/project-info.test.ts` — Unit test `gwrk project info`: verify JSON output matches `ProjectProfileSchema`. (FR-035)
- **TR-033**: ⭐ **NEW (R3)** Verify `GwrkConfigSchema` accepts old-format (no profile) and new-format (with profile) `.gwrkrc.json`. (TC-011)
- **TR-034**: ⭐ **NEW (R3)** Regression test — gwrk-native prompt snapshot: run prompt assembly on gwrk codebase pre-R3 vs post-R3, diff must be empty. Vitest snapshot. (TC-010)
- **TR-035**: ⭐ **NEW (2026-06-14)** `src/commands/plugin.test.ts` — plugin search/install/update command tests. (FR-041, FR-042, FR-043)
- **TR-036**: ⭐ **NEW (2026-06-14)** `src/engine/registry.test.ts` — registry resolution and cloning logic. (FR-044)
- **TR-037**: ⭐ **NEW (2026-06-14)** `src/engine/extension-detector.test.ts` — extension CLI discovery. (FR-045)


---

## 7. Success Criteria

- **SC-001**: `gwrk --help` shows exactly the settled hierarchy. No stubs. No dead commands.
- **SC-002**: `gwrk tasks done` enforces gates strictly — failing gate NEVER updates state.
- **SC-003**: `gwrk define <feature>` runs the full DUS loop and records the run in SQLite.
- **SC-004**: `gwrk ship <feature> <phase>` runs the full ship lifecycle (branch→implement→review→PR→CI) and records the run in SQLite.
- **SC-005**: `pnpm test` passes with 100% of tests GREEN.
- **SC-006**: `pnpm run build` compiles clean with zero TypeScript errors.
- **SC-007**: Every `ship`/`define` run produces a manifest in `.gwrk/runs/` that survives git push.
- **SC-008**: `gwrk tasks verify <feature>` detects and reports post-merge state corruption.
- **SC-009**: ⭐ **UPDATED (R3)** `gwrk init` provisions profile + workstation + agents + Slack in one interactive flow. `gwrk ship` pre-flight passes. `gwrk setup` is removed.
- **SC-010**: ⭐ **NEW (2026-05-13)** All `define` subcommands produce the same quiet, logged output as `ship`. No raw agent narration in terminal.
- **SC-011**: ⭐ **NEW (R3)** `gwrk define plan` in skills-connection produces a plan with `apps/companion/` paths — not `src/commands/`.
- **SC-012**: ⭐ **NEW (R3)** `gwrk define plan` in the gwrk repo produces identical prompt structure to pre-R3 behavior.
- **SC-013**: ⭐ **NEW (R3)** `gwrk project info --format json` returns a valid `ProjectProfile` in any gwrk-managed project.
- **SC-014**: ⭐ **NEW (R3)** All 15 PROMPT.md files refactored with conditional profile sections. `grep -r` for ungated gwrk-native references returns zero.

---

## 8. Verification Requirements

- **VR-001**: E2E: `gwrk init` → mock spec/plan → `gwrk tasks generate` → gate pass → `gwrk tasks done` → verify state + history.
- **VR-002**: Negative: `gwrk tasks done` with failing gate → state unchanged, exit 1.
- **VR-003**: Config: remove required field → any gwrk command crashes with Zod error.
- **VR-004**: E2E: `gwrk --help` output matches FR-018 exactly.
- **VR-005**: E2E: `gwrk run plan` with stub spec → `[BLOCKED]` error, exit 1.
- **VR-006**: ⭐ **NEW (R3)** E2E: `gwrk init --non-interactive` in a pnpm monorepo → `.gwrkrc.json` contains auto-detected profile.
- **VR-007**: ⭐ **NEW (R3)** E2E: `gwrk define plan` in skills-connection → plan.md has no gwrk-native references.
- **VR-008**: ⭐ **NEW (R3)** E2E: `gwrk project info` in skills-connection → type: "pnpm-monorepo".
- **VR-009**: ⭐ **NEW (R3)** Snapshot: Pre-R3 gwrk plan prompt matches post-R3 when profile is gwrk-native.
- **VR-010**: ⭐ **NEW (R3)** Audit: `grep -r "src/commands\\|src/engine\\|ADR-004\\|Commander.js\\|better-sqlite3" src/plugins/builtins/workflows/*/PROMPT.md` returns ZERO ungated matches.

---

## 9. Coverage Matrix

| US | FR | TR |
|---|---|---|
| US-001 | FR-001, FR-022, FR-030, FR-031, FR-032, FR-044, FR-045 | TR-001, TR-021, TR-027, TR-028, TR-033, TR-036, TR-037 |
| US-002 | FR-002 | TR-002, TR-012 |
| US-003 | FR-003 | TR-003, TR-012, TR-019 |
| US-004 | FR-004 | TR-004 |
| US-005 | FR-005 | TR-005 |
| US-006 | FR-006 | TR-006, TR-007 |
| US-007 | FR-007 | TR-007 |
| US-008 | FR-008 | TR-008 |
| US-009 | FR-009 | TR-009, TR-019 |
| US-010 | FR-010 | TR-010 |
| US-011 | FR-011 | TR-011, TR-013 |
| US-012 | FR-012 | TR-013 |
| US-013 | FR-013 | TR-013 |
| US-014 | FR-014 | TR-014, TR-013 |
| US-015 | FR-015 | TR-015, TR-013 |
| US-016 | FR-016 | TR-016 |
| US-017 | FR-017 | TR-017 |
| US-018 | FR-018 | TR-018, TR-019 |
| US-019 | FR-019 | TR-020 |
| US-020 | FR-020 | TR-021 |
| US-021 | FR-001 (absorbed) | TR-021 |
| US-022 | FR-023 | TR-022 |
| US-023 | FR-024 | TR-023 |
| US-024 | FR-025 | TR-024 |
| US-025 | FR-026 | TR-025 |
| US-026 | FR-028, FR-029 | TR-026 |
| US-027 | FR-030, FR-031, FR-032 | TR-027, TR-028, TR-029, TR-030, TR-033 |
| US-028 | FR-033, FR-034 | TR-031, TR-034 |
| US-029 | FR-035 | TR-032 |
| US-030 | FR-036, FR-037, FR-038, FR-039, FR-040 | TR-013 |
| US-031 | FR-041, FR-042, FR-043 | TR-035 |
| US-032 | FR-045 | TR-037 |
