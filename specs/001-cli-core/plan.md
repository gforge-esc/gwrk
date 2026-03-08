---
type: implementation_plan
feature: 001-cli-core
last_modified: "2026-03-06T19:45:00Z"
---

# Implementation Plan: 001 CLI Core

**Branch**: `develop` | **Revised**: 2026-03-06 | **Spec**: [spec.md](./spec.md)

## Summary

The gwrk CLI — the Principal Engineer's Operating System. Delivers the Foxtrot Charlie pillar hierarchy (`define`, `ship`, `measure`), project scaffolding (`init`), agent dispatch, SQLite execution ledger, task engine with Hard Gate enforcement, provenance tracking, and standardized output formatting.

> **Status**: Phases 1–6 are **implemented and tested** (132 tests, 26 files, all passing). Phases 7–8 require completion.

---

## Phases and File Structure

### Phase 1: Project Bootstrap & Config ✅

Bootstrap the TypeScript project infrastructure. Deliver `gwrk init` and Zod-validated configuration.

**Files (6):**
- `package.json` ✅ — Project manifest (commander, zod, vitest, biome, tsx)
- `tsconfig.json` ✅ — ES2022, ESM, strict, NodeNext
- `src/cli.ts` ✅ — Custom help with flamingo branding, pillar-based command routing
- `src/commands/init.ts` ✅ — Scaffold directories, detect CLIs, provision context
- `src/utils/config.ts` ✅ — Zod schema for `.gwrkrc.json`, fail-fast loader
- `src/utils/format.ts` ✅ — Unified output: banners, success/fail boxes, color exports

**Requirements Addressed:** FR-001, FR-008, US-001, US-008, TC-003

**Tests:**
- `src/commands/init.test.ts` ✅ — TR-001
- `src/utils/config.test.ts` ✅ — TR-008
- `src/cli.test.ts` ✅ — Registration, pillar hierarchy
- `src/cli.e2e.test.ts` ✅ — E2E surface verification

---

### Phase 2: SQLite Execution Ledger ✅

Global SQLite at `~/.gwrk/gwrk.db` for run recording and analytics.

**Files (4):**
- `src/db/index.ts` ✅ — Connection, migration runner
- `src/db/migrations/001-initial.sql` ✅ — Schema: projects, runs, compression, history
- `src/db/runs.ts` ✅ — startRun/finishRun
- `src/commands/db.ts` ✅ — `gwrk db runs`, `gwrk db stats`

**Requirements Addressed:** FR-014, FR-015, US-014, US-015, DM-001, DM-002, DM-003

**Tests:**
- `src/db/db.test.ts` ✅
- `src/commands/runs.test.ts` ✅
- `src/commands/stats.test.ts` ✅

---

### Phase 3: Clarity Pillar — Define (DUS) ✅

Agent dispatch wrappers under `gwrk define` for spec, plan, tasks, and bare DUS loop.

**Files (8):**
- `src/commands/define.ts` ✅ — Parent: bare=DUS loop, subcommands: spec, plan, tasks
- `src/commands/specify.ts` ✅ — `gwrk define spec <feature> [--refs]`
- `src/commands/plan.ts` ✅ — `gwrk define plan <feature> [--refs]`
- `src/commands/analyze.ts` ✅ — Internal DUS stage (not user-facing)
- `src/commands/tasks-generate.ts` ✅ — `gwrk define tasks` with `--force` and `--reconcile`
- `src/utils/agent.ts` ✅ — Agent dispatch: backend resolution, log streaming, logPath return
- `src/utils/parser.ts` ✅ — Parse plan.md → phases and tasks
- `src/utils/exec.ts` ✅ — Shell command execution wrapper

**Requirements Addressed:** FR-002, FR-003, FR-004, FR-011, US-002, US-003, US-004, US-011, TC-002

**Tests:**
- `src/commands/specify.test.ts` ✅ — TR-002
- `src/commands/plan.test.ts` ✅ — TR-003
- `src/commands/analyze.test.ts` ✅ — TR-009
- `src/commands/define.test.ts` ✅
- `src/commands/tasks-generate.test.ts` ✅ — TR-004
- `src/commands/tasks-reconcile.test.ts` ✅ — 4 reconcile scenarios
- `src/utils/agent.test.ts` ✅
- `src/engine/spec-parser.test.ts` ✅

---

### Phase 4: Throughput Pillar — Ship (ZFG/WUD) ✅

`gwrk ship <feature> <phase>` for the autonomous implement→review→PR loop.

**Files (2):**
- `src/commands/ship.ts` ✅ — Ship (WUD)
- `src/commands/implement.ts` ✅ — Internal isolated delegate (no WUD loop)

**Requirements Addressed:** FR-012, FR-013, US-012, US-013

---

### Phase 5: Task Engine — State, Gates & History ✅

Task tracking engine: state management, gate-enforced transitions, provenance.

**Files (5):**
- `src/commands/tasks.ts` ✅ — Subcommands: list, next, done + drift detection
- `src/utils/state.ts` ✅ — TaskState schema (with `generatedFrom`, `cancelled`), contentHash()
- `src/utils/gate-gen.ts` ✅ — Generate gate scripts
- `src/utils/history.ts` ✅ — JSONL history append

**Requirements Addressed:** FR-005, FR-006, FR-007, US-005, US-006, US-007, TC-001, TC-004, TC-007

**Tests:**
- `src/commands/tasks-done.test.ts` ✅ — TR-006
- `src/commands/tasks-query.test.ts` ✅ — TR-005
- `src/utils/state.test.ts` ✅ — TR-007

---

### Phase 6: Value Pillar — Measure ✅

`gwrk measure pulse`, `gwrk measure effort`, `gwrk measure compression`.

**Files (7):**
- `src/commands/measure.ts` ✅ — Parent: pulse, effort, compression subcommands
- `src/commands/pulse.ts` ✅ — Git activity dashboard
- `src/commands/effort.ts` ✅ — SP-driven estimation
- `src/commands/compression.ts` ✅ — Effort vs actual ratio
- `src/engine/pulse.ts` ✅ — Pulse engine
- `src/engine/effort.ts` ✅ — Effort engine
- `src/engine/compression.ts` ✅ — Compression engine

**Requirements Addressed:** FR-010, FR-016, FR-017, US-010, US-016, US-017

**Tests:**
- `src/commands/pulse.test.ts` ✅
- `src/commands/effort.test.ts` ✅ — TR-010
- `src/commands/compression.test.ts` ✅
- `src/engine/pulse.test.ts` ✅
- `src/engine/pulse-integration.test.ts` ✅ — TR-007/VR-004
- `src/engine/effort.test.ts` ✅
- `src/engine/compression.test.ts` ✅

---

### Phase 7: Init Hardening ✅

`gwrk init` currently scaffolds directories but needs: multi-CLI provisioning (detect gemini/claude/codex), SQLite project registration, Slack channel creation (optional), and GitHub repo visibility (private by default).

**Files (2):**
- `src/commands/init.ts` ✅ (MODIFY: Add CLI detection, SQLite registration, Slack optional)
- `src/commands/new.ts` ✅ (NEW: `gwrk new <name>` — mkdir, git init, gh repo create, then delegates to init)

**Requirements Addressed:** FR-001 (full acceptance), US-001 (acceptance 2-3), TC-005, TC-006

**Tests:**
- Expand `src/commands/init.test.ts` ✅ — CLI detection, idempotency, SQLite registration, GH repo creation
- New `src/commands/new.test.ts` ✅ — Greenfield flow

#### Done When
- `gwrk init` detects available CLIs and provisions GEMINI.md/CLAUDE.md/AGENTS.md ✅
- `gwrk init` registers project in `~/.gwrk/gwrk.db` ✅
- `gwrk new test-project` creates dir, initializes git, runs init ✅
- Running `gwrk init` twice is idempotent ✅

---

### Phase 8: E2E Surface Hardening ✅

Final verification that the CLI surface matches US-018 exactly. Clean up dead command files.

**Files (3):**
- `src/commands/run.ts` ✅ (DELETE: Dead `run` group — commands moved to `define`)
- `src/commands/metrics.ts` ✅ (DELETE: Dead `metrics` group — moved to `measure`)
- `src/cli.e2e.test.ts` ✅ (MODIFY: Update E2E assertions to match US-018 exactly)

**Verification:**
- `gwrk --help` shows exactly: `define`, `ship`, `measure`, `init`, `tasks`, `db` ✅
- `gwrk define --help` shows: `spec`, `plan`, `tasks` ✅
- `gwrk ship --help` shows: `done` ✅
- `gwrk measure --help` shows: `pulse`, `effort`, `compression` ✅
- No other top-level commands exist ✅

**Requirements Addressed:** FR-018, US-018

#### Done When
- All dead files removed ✅
- `pnpm test` — all passing (verified CLI core tests) ✅
- `gwrk --help` output matches spec US-018 acceptance criteria exactly ✅

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 1, 7 | ✅ Done |
| US-002 | 3 | ✅ Done |
| US-003 | 3 | ✅ Done |
| US-004 | 3 | ✅ Done |
| US-005 | 5 | ✅ Done |
| US-006 | 5 | ✅ Done |
| US-007 | 5 | ✅ Done |
| US-008 | 1 | ✅ Done |
| US-010 | 6 | ✅ Done |
| US-011 | 3 | ✅ Done |
| US-012 | 4 | ✅ Done |
| US-013 | 4 | ✅ Done |
| US-014 | 2 | ✅ Done |
| US-015 | 2 | ✅ Done |
| US-016 | 6 | ✅ Done |
| US-017 | 6 | ✅ Done |
| US-018 | 8 | ✅ Done |
| FR-001 | 1, 7 | ✅ Done |
| FR-002 | 3 | ✅ Done |
| FR-003 | 3 | ✅ Done |
| FR-004 | 3 | ✅ Done |
| FR-005 | 5 | ✅ Done |
| FR-006 | 5 | ✅ Done |
| FR-007 | 5 | ✅ Done |
| FR-008 | 1 | ✅ Done |
| FR-010 | 6 | ✅ Done |
| FR-011 | 3 | ✅ Done |
| FR-012 | 4 | ✅ Done |
| FR-013 | 4 | ✅ Done |
| FR-014 | 2 | ✅ Done |
| FR-015 | 2 | ✅ Done |
| FR-016 | 6 | ✅ Done |
| FR-017 | 6 | ✅ Done |
| FR-018 | 8 | ✅ Done |

## Deferred Items

- US-009 / FR-009: Cross-artifact analysis — now internal DUS stage, no standalone command.
