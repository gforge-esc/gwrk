# Gap Analysis: 006 Pulse

**Date**: 2026-02-27
**Feature**: [spec.md](./spec.md) | [plan.md](./plan.md)

---

## Phase 1: Pulse Engine

| File | Status | Gap |
|---|---|---|
| `src/engine/pulse.ts` | `greenfield` | Create: `scanRepository()`, `parseGitLog()`, `bucketByWeek()`. All contract methods. |
| `src/engine/types.ts` | `greenfield` | Create: `PulseSnapshot`, `WeeklyBucket`, `PulseReport`, `SpecProgress` Zod schemas + TS types. |
| `src/utils/git.ts` | `greenfield` | Create: `detectDefaultBranch()`, `gitLog()`, `gitBranches()`, `gitLineCount()` shell helpers. |
| `src/engine/pulse.test.ts` | `greenfield` | Create: Unit tests for TR-001, TR-002, TR-003. |
| `src/utils/git.test.ts` | `greenfield` | Create: Unit tests for git helpers (TR-003). |
| `src/engine/pulse-integration.test.ts` | `greenfield` | Create: Integration test with real temp git repo (TR-007). |

## Phase 2: CLI Commands + Config

| File | Status | Gap |
|---|---|---|
| `src/commands/pulse.ts` | `greenfield` | Create: `registerPulseCommands()`, `renderPulseTable()`, `renderSnapshotTable()`. |
| `src/commands/pulse.test.ts` | `greenfield` | Create: Unit tests for TR-004, TR-005, TR-006. |
| `src/utils/config.ts` | `missing` | Exists, but `GwrkConfigSchema` lacks `pulse` section. Need to add optional `pulse: { repos: z.array(z.string()) }`. Current schema only has `project` and `agents`. |
| `src/utils/config.test.ts` | `missing` | Exists, but no tests for `pulse` config. Need tests for: valid pulse config, missing pulse.repos triggers error in pulse command. |
| `src/cli.ts` | `missing` | Exists, but no `pulse` command registered. Only `initCommand` is registered. Need to import and add `pulseCommand`. |

## Phase 3: Multi-Repo Aggregation

| File | Status | Gap |
|---|---|---|
| `src/engine/pulse.ts` | `missing` | `generatePulseReport()` and `scanSpecProgress()` not yet implemented (Phase 1 creates the file, Phase 3 adds these methods). |
| `src/engine/pulse.test.ts` | `missing` | Tests for multi-repo aggregation and spec progress (TR-008) not yet present. |
| `src/commands/pulse.ts` | `missing` | Multi-repo wiring in `gwrk pulse` command not yet implemented (Phase 2 creates the file, Phase 3 extends it). |
| `src/commands/pulse.test.ts` | `missing` | Tests for multi-repo output formatting not yet present. |

## Summary

- **Greenfield files**: 8 (entire engine, git helpers, CLI commands, all test files)
- **Files needing extension**: 3 (`config.ts`, `config.test.ts`, `cli.ts`)
- **Contract conflicts**: None
- **Governance violations**: None
