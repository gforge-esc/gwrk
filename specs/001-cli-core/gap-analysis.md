---
type: gap_analysis
feature: 001-cli-core
last_modified: "2026-03-05T23:42:33Z"
---

# Gap Analysis: 001 CLI Core (Updated)

**Date**: 2026-03-05
**Status**: Partial Gap Identified

---

## Phase 1: Project Bootstrap & Config

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `package.json` | — | ✅ tested | Commander, Zod, Vitest, Biome, Tsx present |
| `tsconfig.json` | — | ✅ tested | ES2022, ESM, NodeNext present |
| `biome.json` | — | ✅ tested | Lint + format config present |
| `src/cli.ts` | — | ✅ tested | Entry point with hierarchical routing |
| `src/utils/config.ts` | `loadConfig()`, `GwrkConfigSchema` | ✅ tested | Zod schema and fail-fast loader |
| `src/utils/exec.ts` | `run()` | ✅ tested | execFile wrapper for commands |
| `src/utils/format.ts` | `banner()`, `success()`, `fail()` | ✅ tested | Unified CLI output formatting |
| `src/commands/init.ts` | — | ✅ tested | `gwrk init` scaffolding |

## Phase 2: Execution Ledger (SQLite)

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/db/index.ts` | `getDb()` | ✅ tested | better-sqlite3 connection, WAL mode |
| `src/db/migrations/001-initial.sql` | — | ✅ tested | Initial schema for projects, runs, etc. |
| `src/db/runs.ts` | `startRun()`, `finishRun()` | ✅ tested | Run recording persistence |
| `src/commands/db.ts` | — | ✅ tested | `gwrk db runs/stats` routing |
| `src/commands/runs.ts` | — | ✅ tested | `gwrk db runs` implementation |
| `src/commands/stats.ts` | — | ✅ tested | `gwrk db stats` implementation |

## Phase 3: Agent Dispatch

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/utils/agent.ts` | `dispatchAgent()` | ⚠️ wrong | **Contract mismatch**: Contract requires `Promise<{ exitCode: number; stdout: string; stderr: string }>`. Implementation only returns `Promise<{ exitCode: number }>`. Output is streamed and logged but not returned to caller. |
| `src/commands/run.ts` | — | ✅ tested | `gwrk run` group routing |
| `src/commands/specify.ts` | — | ✅ tested | `gwrk run specify` wrapper |
| `src/commands/plan.ts` | — | ✅ tested | `gwrk run plan` wrapper |
| `src/commands/analyze.ts` | — | ✅ tested | `gwrk run analyze` wrapper |

## Phase 4: Task Engine — Generation

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/utils/parser.ts` | `parsePlan()` | ✅ tested | Markdown parser for `plan.md` |
| `src/utils/gate-gen.ts` | `generateGates()` | ⚠️ missing | **Weak Implementation**: Current implementation uses simple regex heuristics on task description instead of generating assertions FROM contracts/data models. Rule mandate: "Gates MUST be generated FROM contracts, not from task description prose." |
| `src/utils/state.ts` | `loadTaskState()`, `saveTaskState()` | ✅ tested | Zod-validated state management |
| `src/commands/tasks.ts` | — | ✅ tested | `gwrk tasks generate` implementation |

## Phase 5: Task Engine — Lifecycle & Gates

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/commands/tasks.ts` | — | ✅ tested | `list`, `next`, `done` subcommands |
| `src/utils/history.ts` | `appendHistory()` | ✅ tested | JSONL history logging |
| `src/utils/state.ts` | `markTaskComplete()` | ✅ tested | Immutable state update logic |

## Phase 6: Orchestration Wrappers

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/commands/define.ts` | — | ✅ tested | Wraps `define-until-solid.sh` |
| `src/commands/implement.ts` | — | ✅ tested | Wraps `agent-run.sh` |
| `src/commands/wud.ts` | — | ✅ tested | Wraps `work-until-done.sh` |

## Phase 7: Productivity & Metrics Dashboard

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/engine/pulse.ts` | `generatePulseReport()` | ✅ tested | Git log scanner and report generator |
| `src/commands/pulse.ts` | — | ✅ tested | `gwrk pulse` dashboard |
| `src/engine/effort.ts` | `computeEffort()` | ✅ tested | SP-driven effort estimation |
| `src/commands/effort.ts` | — | ✅ tested | `gwrk metrics effort` assessment report |
| `src/engine/compression.ts` | `computeCompression()` | ✅ tested | Compression ratio calculation |
| `src/commands/compression.ts` | — | ✅ tested | `gwrk metrics compression` dashboard |
| `src/commands/metrics.ts` | — | ✅ tested | metrics group container |

## Phase 8: E2E Verification & Hardening

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/cli.test.ts` | — | ✅ tested | Command hierarchy validation |
| `src/cli.e2e.test.ts` | — | ✅ tested | Compiled binary E2E lifecycle |
| `src/utils/agent.test.ts` | — | ✅ tested | Streaming output verification |
| `src/db/db.test.ts` | — | ✅ tested | SQLite persistence tests |

---

## Hard Gates Audit

- **Current Gates**: `specs/001-cli-core/gates/*.sh` exist but are mostly **WEAK**.
- **Issue**: Most gates only assert `test -f <file>`. They fail to assert the existence of specific methods, schemas, or type signatures defined in contracts.
- **Action**: Regenerate gates using an improved `gate-gen.ts` (or a more rigorous manual template) that pulls from `contracts/` and `data-model.md`.

---

## Summary

- **Contract Gaps**: `dispatchAgent` return type.
- **Enforcement Gaps**: `generateGates` is heuristic-based and weak.
- **Consistency**: Most files match the plan structure.
