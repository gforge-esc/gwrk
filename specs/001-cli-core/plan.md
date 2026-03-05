# Implementation Plan: 001 CLI Core

**Branch**: `001-cli-core` | **Date**: 2026-02-26 | **Spec**: [spec.md](./spec.md)

## Summary

Bootstrap the `gwrk` CLI from a greenfield TypeScript project. Deliver: project scaffolding (`gwrk init` for existing projects, `gwrk new` for greenfield), multi-CLI provisioning (`GEMINI.md`, `CLAUDE.md`, `AGENTS.md`), agent dispatch wrappers (`specify`, `plan`, `analyze`, `effort`), the SQLite-backed task tracking engine (`tasks generate`, `tasks list`, `tasks next`, `tasks done`) per ADR-002, Hard Gate enforcement, history logging, and Zod-validated configuration. This is Phase 1 of the master build plan — the keystone that everything else depends on.

> **ADR-002 (2026-03-05):** Task state and execution history stored in global SQLite (`~/.gwrk/gwrk.db`) via `better-sqlite3`. `tasks.json` remains as a generated export for git diffs and agent consumption.

---

## Phases and File Structure

### Phase 1: Project Bootstrap, `gwrk init`, `gwrk new`

Bootstrap the TypeScript project infrastructure. Deliver `gwrk init` (add gwrk to existing project: scaffold, CLI provisioning, Slack channel, SQLite registration) and `gwrk new <name>` (full greenfield provisioning: mkdir, git init, gh repo create, scaffold, CLI provisioning, Slack channel, SQLite registration). Both detect available CLIs (`gemini`, `claude`, `codex`) and provision context files.

**Files (8):**
- `package.json` (NEW: Project manifest — commander, zod, vitest, biome, tsx)
- `tsconfig.json` (NEW: ES2022 target, ESM, strict mode, NodeNext module resolution)
- `biome.json` (NEW: Lint + format config, no `any` allowed)
- `.gitignore` (MODIFY: Add `dist/`, `node_modules/`)
- `src/cli.ts` (NEW: Commander program definition, version, top-level command routing)
- `src/commands/init.ts` (NEW: `gwrk init` — scaffold directories, detect CLIs, provision context files, create Slack channel, register in SQLite)
- `src/commands/new.ts` (NEW: `gwrk new <name>` — mkdir, git init, gh repo create, then delegates to init)
- `src/utils/config.ts` (NEW: Zod schema for `.gwrkrc.json`, fail-fast loader)
- `src/db/index.ts` (NEW: SQLite connection to `~/.gwrk/gwrk.db`, schema init via migrations)
- `src/db/migrations/001-initial.sql` (NEW: Create tables: projects, tasks, task_types, runs, compression, history)
- `src/utils/exec.ts` (NEW: Shell command execution wrapper via `child_process.execFile`)

**Requirements Addressed:** FR-001, FR-008, US-001, US-008, TC-003, TC-005, TC-006

**Dependencies:** None

**Contract Mapping:**
- `contracts/config.md` → `loadConfig()` → `src/utils/config.ts`
- `contracts/config.md` → `GwrkConfigSchema` → `src/utils/config.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agent/rules/coding-style.md | Strict TypeScript, Biome, Zod schemas |
| .agent/rules/workspace.md | Fail-fast config, no magic values |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit (Vitest) | `src/commands/init.test.ts` | `init` creates `.agent/`, `.specify/`, `specs/`, `.gwrkrc.json` in a temp dir. Running twice is idempotent. |
| TR-008 | Unit (Vitest) | `src/utils/config.test.ts` | Valid `.gwrkrc.json` loads. Missing field → `process.exit(1)`. Invalid type → `process.exit(1)`. |

#### Done When
- `pnpm install` exits 0
- `pnpm exec tsc --noEmit` exits 0
- `node --import tsx src/cli.ts --help` prints commands including `init`
- `node --import tsx src/cli.ts init` creates scaffold directories in a temp dir
- `pnpm test` passes TR-001 and TR-008

---

### Phase 2: Agent Dispatch Commands

Implement `specify`, `plan`, `analyze`, and `effort` as thin wrappers that invoke the configured agent backend (gemini/claude/codex) with the appropriate workflow file.

**Files (5):**
- `src/commands/specify.ts` (NEW: `gwrk specify <prompt>` — dispatches agent with `/specify` workflow)
- `src/commands/plan.ts` (NEW: `gwrk plan <feature>` — dispatches agent with `/plan` workflow)
- `src/commands/analyze.ts` (NEW: `gwrk analyze <feature>` — dispatches agent with `/analyze` workflow)
- `src/commands/effort.ts` (NEW: `gwrk effort <feature>` — dispatches agent with `/effort` workflow)
- `src/utils/agent.ts` (NEW: Agent dispatch abstraction — resolves backend from config, builds CLI args, invokes via `exec.ts`)

**Requirements Addressed:** FR-002, FR-003, FR-009, FR-010, US-002, US-003, US-009, US-010, TC-002

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/agent.md` → `dispatchAgent()` → `src/utils/agent.ts`
- `contracts/agent.md` → `AgentBackend` type → `src/utils/agent.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agent/rules/coding-style.md | No `any`, strict types for agent dispatch |
| .agent/rules/workspace.md | Air-gapped — CLI itself makes no HTTP calls |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-002 | Unit (Vitest) | `src/commands/specify.test.ts` | `specify` invokes agent with correct workflow path and prompt. Mock `execFile`. |
| TR-003 | Unit (Vitest) | `src/commands/plan.test.ts` | `plan` validates spec.md exists for feature, invokes agent with `/plan` workflow. |
| TR-009 | Unit (Vitest) | `src/commands/analyze.test.ts` | `analyze` invokes agent with `/analyze` workflow and correct feature dir. |
| TR-010 | Unit (Vitest) | `src/commands/effort.test.ts` | `effort` invokes agent with `/effort` workflow and correct feature dir. |

#### Done When
- `node --import tsx src/cli.ts specify "test feature"` spawns the configured agent process
- `node --import tsx src/cli.ts plan 001-cli-core` spawns the agent with correct workflow
- `pnpm test` passes TR-002, TR-003, TR-009, TR-010

---

### Phase 3: Task Engine — State, Gates & History

Implement the core task tracking engine: `gwrk tasks generate` (parse plan.md → tasks.json + gates), `gwrk tasks done` (gate-enforced state transitions), and JSONL history logging.

**Files (5):**
- `src/commands/tasks.ts` (NEW: Commander subcommands — `generate`, `list`, `next`, `done`)
- `src/utils/state.ts` (NEW: Read/write task state via SQLite, atomic operations, export to tasks.json)
- `src/utils/parser.ts` (NEW: Parse plan.md → extract phases and tasks)
- `src/utils/gate-gen.ts` (NEW: Generate `gates/T0xx-gate.sh` from plan task assertions)
- `src/utils/history.ts` (NEW: Insert into SQLite `history` table on every state transition)

**Requirements Addressed:** FR-004, FR-006, FR-007, US-004, US-006, US-007, TC-001, TC-004, TC-007, DM-001, DM-002

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/tasks.md` → `TaskStateSchema` → `src/utils/state.ts`
- `contracts/tasks.md` → `loadTaskState()` → `src/utils/state.ts`
- `contracts/tasks.md` → `saveTaskState()` → `src/utils/state.ts`
- `contracts/tasks.md` → `markTaskComplete()` → `src/utils/state.ts`
- `contracts/tasks.md` → `runGate()` → `src/utils/exec.ts`
- `contracts/tasks.md` → `appendHistory()` → `src/utils/history.ts`
- `contracts/tasks.md` → `parsePlan()` → `src/utils/parser.ts`
- `contracts/tasks.md` → `generateGates()` → `src/utils/gate-gen.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agent/rules/coding-style.md | Zod for all task state schemas |
| .agent/rules/workspace.md | Fail-fast, deterministic IDs |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-004 | Unit (Vitest) | `src/commands/tasks-generate.test.ts` | `generate` parses plan.md → creates tasks.json matching schema. Gate scripts exist with `+x`. |
| TR-006 | Unit (Vitest) | `src/commands/tasks-done.test.ts` | `done` with passing gate → status=completed. Failing gate → status=open. Missing gate → exit 1. Already completed → exit 1. |
| TR-007 | Unit (Vitest) | `src/utils/state.test.ts` | Atomic read/write of tasks.json. Zod validation rejects invalid state. `appendHistory()` writes valid JSONL. |

#### Done When
- `node --import tsx src/cli.ts tasks generate 001-cli-core` creates `specs/001-cli-core/.gwrk/tasks.json` and `specs/001-cli-core/gates/T*-gate.sh`
- `jq '.phases | length' specs/001-cli-core/.gwrk/tasks.json` returns ≥ 1
- `ls specs/001-cli-core/gates/T*-gate.sh | wc -l` matches task count
- Gate files have `+x` permission: `test -x specs/001-cli-core/gates/T001-gate.sh`
- `node --import tsx src/cli.ts tasks done 001-cli-core T001` with a failing gate exits 1
- `node --import tsx src/cli.ts tasks done 001-cli-core T001` with a passing gate exits 0 and updates tasks.json
- `tail -1 .gwrk/history.jsonl | jq -r '.taskId'` outputs `T001`
- `pnpm test` passes TR-004, TR-006, TR-007

---

### Phase 4: Task Query Commands

Implement `gwrk tasks list` and `gwrk tasks next` for agent-friendly state queries, plus the full end-to-end verification.

**Files (1):**
- `src/commands/tasks.ts` (MODIFY: Add `list` and `next` subcommands with `--json` output)

**Requirements Addressed:** FR-005, US-005

**Dependencies:** Phase 3

**Contract Mapping:**
- `contracts/tasks.md` → `listTasks()` → `src/utils/state.ts`
- `contracts/tasks.md` → `nextTask()` → `src/utils/state.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agent/rules/coding-style.md | Strict TypeScript for query output types |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit (Vitest) | `src/commands/tasks-query.test.ts` | `list` returns all tasks. `next` returns first open task for phase. `--json` outputs valid JSON. |
| VR-001 | Integration (Vitest) | `tests/integration/lifecycle.test.ts` | Full E2E: init → create mock spec/plan → generate → done → verify state + history |
| VR-002 | Integration (Vitest) | `tests/integration/lifecycle.test.ts` | Negative: failing gate → state NOT mutated, exit 1 |
| VR-003 | Integration (Vitest) | `tests/integration/config.test.ts` | Remove required field → any command crashes with Zod error |

#### Done When
- `node --import tsx src/cli.ts tasks list 001-cli-core --json | jq '.tasks | length'` returns task count
- `node --import tsx src/cli.ts tasks next 001-cli-core 1 --json | jq -r '.id'` returns a task ID
- `pnpm test` passes TR-005, VR-001, VR-002, VR-003
- All tests pass: `pnpm test` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `GwrkConfig` | `src/utils/config.ts` | `src/cli.ts`, `src/utils/agent.ts`, all commands |
| `GwrkConfigSchema` (Zod) | `src/utils/config.ts` | `src/cli.ts` |
| `TaskState` | `src/utils/state.ts` | `src/commands/tasks.ts`, `src/utils/parser.ts` |
| `Phase` | `src/utils/state.ts` | `src/commands/tasks.ts`, `src/utils/parser.ts` |
| `Task` | `src/utils/state.ts` | `src/commands/tasks.ts`, `src/utils/gate-gen.ts` |
| `HistoryEntry` | `src/utils/history.ts` | `src/commands/tasks.ts` |
| `AgentBackend` | `src/utils/agent.ts` | `src/commands/specify.ts`, `plan.ts`, `analyze.ts`, `effort.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

_None — full coverage._

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 1 | Planned |
| US-002 | 2 | Planned |
| US-003 | 2 | Planned |
| US-004 | 3 | Planned |
| US-005 | 4 | Planned |
| US-006 | 3 | Planned |
| US-007 | 3 | Planned |
| US-008 | 1 | Planned |
| US-009 | 2 | Planned |
| US-010 | 2 | Planned |
| FR-001 | 1 | Planned |
| FR-002 | 2 | Planned |
| FR-003 | 2 | Planned |
| FR-004 | 3 | Planned |
| FR-005 | 4 | Planned |
| FR-006 | 3 | Planned |
| FR-007 | 3 | Planned |
| FR-008 | 1 | Planned |
| FR-009 | 2 | Planned |
| FR-010 | 2 | Planned |
| TC-001 | 3 | Planned |
| TC-002 | 2 | Planned |
| TC-003 | 1 | Planned |
| TC-004 | 3 | Planned |
| TC-005 | 1 | Planned |
| TC-006 | 1 | Planned |
| TC-007 | 3 | Planned |
| DM-001 | 3 | Planned |
| DM-002 | 3 | Planned |
| DM-003 | 1 | Planned |
| TR-001 | 1 | Planned |
| TR-002 | 2 | Planned |
| TR-003 | 2 | Planned |
| TR-004 | 3 | Planned |
| TR-005 | 4 | Planned |
| TR-006 | 3 | Planned |
| TR-007 | 3 | Planned |
| TR-008 | 1 | Planned |
| TR-009 | 2 | Planned |
| TR-010 | 2 | Planned |
| SC-001 | 1 | Planned |
| SC-002 | 3 | Planned |
| SC-003 | 4 | Planned |
| VR-001 | 4 | Planned |
| VR-002 | 4 | Planned |
| VR-003 | 4 | Planned |
