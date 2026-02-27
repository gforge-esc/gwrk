# Gap Analysis: 001 CLI Core

**Date**: 2026-02-26
**Status**: Greenfield Audit

## Summary
All files identified in the Implementation Plan are currently missing. This is a 100% greenfield implementation.

## Detailed Findings

| File / Component | Status | Finding | Recommendation |
|---|---|---|---|
| `package.json` | `greenfield` | Project manifest missing. | Initialize with Commander, Vitest, and Biome. |
| `tsconfig.json` | `greenfield` | TypeScript config missing. | Configure for ES2022. |
| `src/cli.ts` | `greenfield` | CLI entry point missing. | Implement Commander route registration. |
| `src/utils/exec.ts` | `greenfield` | Execution utility missing. | Implement `runAgent` and `runGate`. |
| `src/commands/specify.ts` | `greenfield` | Specify command missing. | Implement wrapper for gemini specify. |
| `src/commands/plan.ts` | `greenfield` | Plan command missing. | Implement wrapper for gemini plan. |
| `src/utils/parser.ts` | `greenfield` | Markdown parser missing. | Implement extraction of phases/tasks from plan.md. |
| `src/utils/gate-gen.ts` | `greenfield` | Gate generator missing. | Implement shell script emission. |
| `src/commands/plan-to-tasks.ts` | `greenfield` | plan-to-tasks command missing. | Orchestrate parsing and gate generation. |
| `src/utils/state.ts` | `greenfield` | State service missing. | Implement Zod-validated state persistence. |
| `src/commands/tasks.ts` | `greenfield` | Tasks command missing. | Implement `done` logic and status mutation. |

## Contract Audit

| Contract | File | Match? | Notes |
|---|---|---|---|
| `tasks.md` | `src/utils/state.ts` | `greenfield` | Must implement `getTaskState`, `saveTaskState`, `markTaskComplete`. |
| `tasks.md` | `src/utils/exec.ts` | `greenfield` | Must implement `runGate`, `runAgent`. |

## Governance Compliance
- **TC-003 (Fail-Fast)**: Ensure Zod validation in `src/utils/state.ts` uses strict checking without defaults.
- **TC-004 (Hard Gates)**: Ensure `tasks.json` is only mutated via `gwrk tasks done` success.