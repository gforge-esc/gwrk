# Gap Analysis: 001 CLI Core

**Date**: 2026-02-26
**Status**: All Greenfield

---

## Phase 1: Project Bootstrap & `gwrk init`

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `package.json` | — | 🟢 greenfield | Does not exist. Create with commander, zod, vitest, biome, tsx |
| `tsconfig.json` | — | 🟢 greenfield | ES2022, ESM, strict, NodeNext |
| `biome.json` | — | 🟢 greenfield | Lint + format, no `any` |
| `.gitignore` | — | 🟡 exists | Needs `dist/`, `node_modules/` entries |
| `src/cli.ts` | — | 🟢 greenfield | Commander program, version, command routing |
| `src/commands/init.ts` | — | 🟢 greenfield | Scaffold dirs, create `.gwrkrc.json` |
| `src/utils/config.ts` | `loadConfig()`, `GwrkConfigSchema` | 🟢 greenfield | Zod schema, fail-fast |
| `src/utils/exec.ts` | `runGate()` | 🟢 greenfield | execFile wrapper |

## Phase 2: Agent Dispatch Commands

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/commands/specify.ts` | — | 🟢 greenfield | Wraps `dispatchAgent()` with `/specify` workflow |
| `src/commands/plan.ts` | — | 🟢 greenfield | Wraps `dispatchAgent()` with `/plan` workflow |
| `src/commands/analyze.ts` | — | 🟢 greenfield | Wraps `dispatchAgent()` with `/analyze` workflow |
| `src/commands/effort.ts` | — | 🟢 greenfield | Wraps `dispatchAgent()` with `/effort` workflow |
| `src/utils/agent.ts` | `dispatchAgent()`, `AgentBackend` | 🟢 greenfield | Backend resolution, CLI arg building |

## Phase 3: Task Engine

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/commands/tasks.ts` | — | 🟢 greenfield | Commander subcommands: generate, list, next, done |
| `src/utils/state.ts` | `loadTaskState()`, `saveTaskState()`, `markTaskComplete()`, `listTasks()`, `nextTask()` | 🟢 greenfield | Zod-validated state management |
| `src/utils/parser.ts` | `parsePlan()` | 🟢 greenfield | Markdown → phases + tasks |
| `src/utils/gate-gen.ts` | `generateGates()` | 🟢 greenfield | Gate script generation |
| `src/utils/history.ts` | `appendHistory()` | 🟢 greenfield | JSONL append |

## Phase 4: Task Query

| File | Contract Method | Status | Notes |
|---|---|---|---|
| `src/commands/tasks.ts` | `listTasks()`, `nextTask()` | 🟡 depends on Phase 3 | Add `list` and `next` subcommands |

---

## Summary

- **Greenfield files**: 18
- **Modified files**: 2 (`.gitignore`, `tasks.ts` in Phase 4)
- **Existing implementations**: 0
- **Contract violations**: 0 (nothing exists to violate)

This is a pure greenfield build. Every task is a `create from scratch` task.