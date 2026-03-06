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
| `package.json` | — | 🟢 implemented | Commander, Zod, Vitest, Biome, Tsx present |
| `tsconfig.json` | — | 🟢 implemented | ES2022, ESM, NodeNext present |
| `biome.json` | — | 🟢 implemented | Lint + format config present |
| `src/cli.ts` | — | 🟢 implemented | Entry point with hierarchical routing |
| `src/utils/config.ts` | `loadConfig()`, `GwrkConfigSchema` | 🟢 implemented | Zod schema and fail-fast loader |
| `src/utils/exec.ts` | `run()` | 🟢 implemented | execFile wrapper for commands |
| `src/utils/format.ts` | `banner()`, `success()`, `fail()` | 🟢 implemented | Unified CLI output formatting |
| `src/commands/init.ts` | — | 🟢 implemented | `gwrk init` scaffolding |

## Phase 2: Execution Ledger (SQLite)

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/db/index.ts` | `getDb()` | 🟢 implemented | better-sqlite3 connection, WAL mode |
| `src/db/migrations/001-initial.sql` | — | 🟢 implemented | Initial schema for projects, runs, etc. |
| `src/db/runs.ts` | `startRun()`, `finishRun()` | 🟢 implemented | Run recording persistence |
| `src/commands/db.ts` | — | 🟢 implemented | `gwrk db runs/stats` routing |
| `src/commands/runs.ts` | — | 🟢 implemented | `gwrk db runs` implementation |
| `src/commands/stats.ts` | — | 🟢 implemented | `gwrk db stats` implementation |

## Phase 3: Agent Dispatch

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/utils/agent.ts` | `dispatchAgent()` | 🟡 wrong | **Contract mismatch**: Contract requires `Promise<{ exitCode: number; stdout: string; stderr: string }>`. Implementation only returns `Promise<{ exitCode: number }>`. Output is streamed and logged but not returned to caller. |
| `src/commands/run.ts` | — | 🟢 implemented | `gwrk run` group routing |
| `src/commands/specify.ts` | — | 🟢 implemented | `gwrk run specify` wrapper |
| `src/commands/plan.ts` | — | 🟢 implemented | `gwrk run plan` wrapper |
| `src/commands/analyze.ts` | — | 🟢 implemented | `gwrk run analyze` wrapper |

## Phase 4: Task Engine — Generation

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/utils/parser.ts` | `parsePlan()` | 🟢 implemented | Markdown parser for `plan.md` |
| `src/utils/gate-gen.ts` | `generateGates()` | 🟡 missing | **Weak Implementation**: Current implementation uses simple regex heuristics on task description instead of generating assertions FROM contracts/data models. Rule mandate: "Gates MUST be generated FROM contracts, not from task description prose." |
| `src/utils/state.ts` | `loadTaskState()`, `saveTaskState()` | 🟢 implemented | Zod-validated state management |
| `src/commands/tasks.ts` | — | 🟢 implemented | `gwrk tasks generate` implementation |

## Phase 5: Task Engine — Lifecycle & Gates

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/commands/tasks.ts` | — | 🟢 implemented | `list`, `next`, `done` subcommands |
| `src/utils/history.ts` | `appendHistory()` | 🟢 implemented | JSONL history logging |
| `src/utils/state.ts` | `markTaskComplete()` | 🟢 implemented | Immutable state update logic |

## Phase 6: Orchestration Wrappers

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/commands/define.ts` | — | 🟢 implemented | Wraps `define-until-solid.sh` |
| `src/commands/implement.ts` | — | 🟢 implemented | Wraps `agent-run.sh` |
| `src/commands/wud.ts` | — | 🟢 implemented | Wraps `work-until-done.sh` |

## Phase 7: Productivity & Metrics Dashboard

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/engine/pulse.ts` | `generatePulseReport()` | 🟢 implemented | Git log scanner and report generator |
| `src/commands/pulse.ts` | — | 🟢 implemented | `gwrk pulse` dashboard |
| `src/engine/effort.ts` | `computeEffort()` | 🟢 implemented | SP-driven effort estimation |
| `src/commands/effort.ts` | — | 🟢 implemented | `gwrk metrics effort` assessment report |
| `src/engine/compression.ts` | `computeCompression()` | 🟢 implemented | Compression ratio calculation |
| `src/commands/compression.ts` | — | 🟢 implemented | `gwrk metrics compression` dashboard |
| `src/commands/metrics.ts` | — | 🟢 implemented | metrics group container |

## Phase 8: E2E Verification & Hardening

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/cli.test.ts` | — | 🟢 implemented | Command hierarchy validation |
| `src/cli.e2e.test.ts` | — | 🟢 implemented | Compiled binary E2E lifecycle |
| `src/utils/agent.test.ts` | — | 🟢 implemented | Streaming output verification |
| `src/db/db.test.ts` | — | 🟢 implemented | SQLite persistence tests |

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
