---
type: specification
feature: 001-cli-core
last_modified: "2026-03-08T14:22:00Z"
---

# Feature Specification: 001 CLI Core

**Feature Branch**: `001-cli-core`
**Created**: 2026-02-26
**Revised**: 2026-03-06
**Status**: Active (Rewrite v2)
**Input**: gwrk CLI — the TypeScript entry point, hierarchical command routing, flat-file task tracking with Hard Gate enforcement, agent dispatch wrappers, SQLite execution ledger, and shell-script orchestration passthroughs.

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
| **-** | **Scaffolding**| `init` | Project setup |

### Architecture Principles

1. **Shell scripts ARE the product.** `define` and `ship` are thin CLI wrappers around `scripts/dev/define-until-solid.sh` and `scripts/dev/work-until-done.sh`. The TS layer adds SQLite run recording, manifest writing, and CLI UX — it does NOT reimplement orchestration logic.
2. **Git-native task state.** `tasks.json` lives in `specs/<feature>/.gwrk/tasks.json` alongside the spec. Branch checkouts carry isolated state.
3. **SQLite is the analytical ledger.** `~/.gwrk/gwrk.db` records execution history for compression tracking and agent routing. It is NOT the source of truth for task state.
4. **Fail-fast config.** Zod validation with no `.default()` calls. Missing config → `process.exit(1)`.
5. **Streaming output.** All agent dispatch uses `spawn` with `stdio: 'inherit'`. No buffering.
6. **Private by default.** All local data (SQLite, tasks) and upstream integrations (GitHub visibility) default to private.

---

## 2. User Scenarios & Acceptance Criteria

### US-001 - Project Initialization (P0)
As a developer, I want to run `gwrk init` to scaffold a gwrk project.

**Implements**: FR-001

**Acceptance**:
1. `gwrk init` in an empty directory creates `.agent/workflows/`, `.agent/rules/`, `.specify/templates/`, `specs/`, `.gwrkrc.json`.
2. `gwrk init` does NOT create a `.gwrk/` directory. Per-feature `.gwrk/` dirs are created by `gwrk define tasks`. The global ledger lives at `~/.gwrk/gwrk.db`.
3. Running `gwrk init` again prints `gwrk already initialized` and exits 0 (idempotent).

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

---

## 3. Functional Requirements

- **FR-001**: `gwrk init` — scaffold project. Idempotent. (US-001)
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

### Error States

| FR | Condition | stderr contains | Exit code |
|---|---|---|---|
| FR-001 | Already initialized | `gwrk already initialized` | 0 |
| FR-003 | spec.md missing | `spec.md not found` | 1 |
| FR-003 | spec.md is Stub | `[BLOCKED] Spec ... is marked as a Stub` | 1 |
| FR-006 | Gate fails | `Gate failed for <taskId>` | 1 |
| FR-006 | Gate missing | `CRITICAL: gates/<taskId>-gate.sh not found` | 1 |
| FR-006 | Already completed | `Task <taskId> already completed` | 1 |
| FR-008 | Config missing | `Configuration file .gwrkrc.json not found` | 1 |
| FR-008 | Config invalid | `Configuration error: <zod message>` | 1 |

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

### DM-003: Configuration (`.gwrkrc.json`)

Validated by Zod at startup. No defaults.

```typescript
interface GwrkConfig {
  project: { name: string };
  agents: {
    define: "gemini" | "claude" | "codex";
    implement: "gemini" | "claude" | "codex" | "codex-cloud";
  };
}
```

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
- **TC-008**: Streaming output. `spawn` with `stdio: 'inherit'` for all agent dispatch.

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
- **TR-012**: `src/utils/agent.test.ts` — streaming dispatch with `stdio: 'inherit'` (FR-002, FR-003, FR-009)
- **TR-013**: `src/db/db.test.ts` — SQLite schema, startRun, finishRun, listRuns (FR-014, FR-015)
- **TR-014**: `src/commands/runs.test.ts` — execution history query (FR-014)
- **TR-015**: `src/commands/stats.test.ts` — aggregate statistics (FR-015)
- **TR-016**: `src/commands/compression.test.ts` — compression ratio calculation (FR-016)
- **TR-017**: `src/commands/pulse.test.ts` — git log scanning (FR-017)
- **TR-018**: `src/cli.test.ts` — command registration hierarchy (FR-018)
- **TR-019**: `src/cli.e2e.test.ts` — compiled binary E2E: `--help` output, stub rejection (FR-018, FR-003)

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

---

## 8. Verification Requirements

- **VR-001**: E2E: `gwrk init` → mock spec/plan → `gwrk tasks generate` → gate pass → `gwrk tasks done` → verify state + history.
- **VR-002**: Negative: `gwrk tasks done` with failing gate → state unchanged, exit 1.
- **VR-003**: Config: remove required field → any gwrk command crashes with Zod error.
- **VR-004**: E2E: `gwrk --help` output matches FR-018 exactly.
- **VR-005**: E2E: `gwrk run plan` with stub spec → `[BLOCKED]` error, exit 1.

---

## 9. Coverage Matrix

| US | FR | TR |
|---|---|---|
| US-001 | FR-001 | TR-001 |
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
