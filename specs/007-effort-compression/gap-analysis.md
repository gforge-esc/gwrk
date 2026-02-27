# Gap Analysis: 007 Effort + Compression

**Date**: 2026-02-27 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

---

## Summary

All 10 planned engine and command files are **greenfield**. Two existing files (`src/cli.ts`, `src/utils/config.ts`) require modification.

---

## Phase 1: Effort Engine

| File | Status | Finding |
|---|---|---|
| `src/engine/types.ts` | `greenfield` | Does not exist. Must create all shared interfaces: `EffortReport`, `RoleBreakdown`, `StoryEstimate`, `RoleConfig`, `CompressionReport`, `DeliveryActuals`, `CompressionRatios`, `CompressionSummary`, `CommitCluster`, `EffortForecast` |
| `src/engine/spec-parser.ts` | `greenfield` | Does not exist. Must implement `extractStories()` — parse `spec.md` markdown for `US-###` blocks, extract SP values and role codes |
| `src/engine/roles.ts` | `greenfield` | Does not exist. Must implement `resolveRoleMultipliers()` — canonical defaults + config override merge |
| `src/engine/effort.ts` | `greenfield` | Does not exist. Must implement `computeEffort()` — role-bracketed hour computation with 1.25× overhead |
| `src/engine/report-writer.ts` | `greenfield` | Does not exist. Must implement `writeEffortReport()` — markdown generation to `docs/assessments/` |
| `src/engine/effort.test.ts` | `greenfield` | Does not exist |
| `src/engine/spec-parser.test.ts` | `greenfield` | Does not exist |

## Phase 2: Compression Engine

| File | Status | Finding |
|---|---|---|
| `src/engine/git-timestamps.ts` | `greenfield` | Does not exist. Must implement `collectTimestamps()` — OS file dates, `git log`, `gh pr view` with graceful fallback |
| `src/engine/commit-cluster.ts` | `greenfield` | Does not exist. Must implement `clusterCommits()` — gap-based clustering of sorted timestamps |
| `src/engine/compression.ts` | `greenfield` | Does not exist. Must implement `computeCompression()` and `generateSummary()` |
| `src/engine/git-timestamps.test.ts` | `greenfield` | Does not exist |
| `src/engine/commit-cluster.test.ts` | `greenfield` | Does not exist |
| `src/engine/compression.test.ts` | `greenfield` | Does not exist |

## Phase 3: CLI Commands + Integration

| File | Status | Finding |
|---|---|---|
| `src/commands/effort.ts` | `greenfield` | Does not exist. Must create Commander command wiring + `--json` flag |
| `src/commands/compression.ts` | `greenfield` | Does not exist. Must create Commander command wiring + `--json` + `--all` flags |
| `src/commands/effort.test.ts` | `greenfield` | Does not exist |
| `src/commands/compression.test.ts` | `greenfield` | Does not exist |
| `src/cli.ts` | `missing` | Exists with `init` command only. Must add `effort` and `compression` subcommand registrations. Currently has 1 `addCommand()` call. |
| `src/utils/config.ts` | `missing` | Exists with `project` + `agents` keys only. Must extend `GwrkConfigSchema` with optional `effort.roles` and `compression.sessionGapMinutes` keys. Current schema: `z.object({ project, agents })`. |
| `src/utils/config.test.ts` | `missing` | May exist from 001-cli-core. Must add tests for extended schema with effort/compression config keys |

---

## Cross-Contract Compatibility

| Contract | Status |
|---|---|
| `001-cli-core/contracts/config.md` | ✅ Compatible — extension is additive (new optional keys) |
| `001-cli-core/contracts/agent.md` | ✅ Compatible — `effort.ts` listed as `dispatchAgent()` consumer, but per TC-005 effort engine is deterministic (no agent dispatch needed) |
| `007-effort-compression/contracts/effort-engine.md` | ✅ All 5 methods unimplemented (greenfield) |
| `007-effort-compression/contracts/compression-engine.md` | ✅ All 5 methods unimplemented (greenfield) |

---

## Conclusion

Pure greenfield build. No conflicts, no wrong implementations. All work is `greenfield` except 3 file modifications (cli.ts, config.ts, config.test.ts) which are `missing` (additive changes to existing files).
