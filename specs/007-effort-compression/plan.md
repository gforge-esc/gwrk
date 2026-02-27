# Implementation Plan: 007 Effort + Compression

**Branch**: `007-effort-compression` | **Date**: 2026-02-27 | **Spec**: [spec.md](./spec.md)

## Summary

Phase 7 ships the **Effort Engine** (story extraction, role bracketing, SP-derived hours, markdown reports) and the **Compression Engine** (timestamp collection, commit clustering, Point/Total compression ratios, dormancy tracking, cross-feature summaries). Both engines are pure TypeScript — deterministic from spec artifacts and Git log, no LLM required.

The plan is split into 3 phases aligned with the architecture from `docs/architecture.md` §3:
- **Phase 1**: Effort Engine — `src/engine/effort.ts` + spec parser + report writer
- **Phase 2**: Compression Engine — `src/engine/compression.ts` + Git timestamp collector + commit clustering
- **Phase 3**: CLI Commands + Integration — `src/commands/effort.ts`, `src/commands/compression.ts`, config schema extension, `--json` output

**Dependencies**: Phase 1 (CLI Core) must ship first — this plan consumes `src/utils/config.ts` (`loadConfig()`), `src/utils/exec.ts` (`runGate()`), and the Commander routing in `src/cli.ts`.

**Cross-spec compatibility**: 
- `001-cli-core/contracts/agent.md` lists `effort.ts` as a consumer of `dispatchAgent()` — but per TC-005, the effort engine is deterministic from artifacts, NOT agent-dispatched. The `001-cli-core` `gwrk effort` command (FR-010) is a thin CLI wrapper that calls the engine directly. No conflict.
- `001-cli-core/contracts/config.md` defines `GwrkConfigSchema` — this plan extends it additively with `effort.roles` and `compression.sessionGapMinutes`. No breaking change.

---

## Phases and File Structure

### Phase 1: Effort Engine

Core effort estimation: parse spec.md for user stories, bracket by role, compute hours with the 1.25× overhead factor, generate a markdown report.

**Files (7):**
- `src/engine/effort.ts` (NEW: effort engine — story extraction, role bracketing, hour computation, report generation)
- `src/engine/spec-parser.ts` (NEW: markdown parser that extracts US-### blocks with SP values and role assignments from spec.md)
- `src/engine/types.ts` (NEW: shared TypeScript interfaces for EffortReport, RoleBreakdown, StoryEstimate, CompressionReport, DeliveryActuals, CompressionRatios, CompressionSummary)
- `src/engine/roles.ts` (NEW: canonical role multiplier defaults — RE=6, TS=4, PM=2, PE=1.5, DE=5 — and config override resolution)
- `src/engine/report-writer.ts` (NEW: generates effort markdown report to `docs/assessments/effort-<feature>-YYYY-MM-DD.md`)
- `src/engine/effort.test.ts` (NEW: unit tests — story extraction, hour calculation, report generation, missing spec fail-fast)
- `src/engine/spec-parser.test.ts` (NEW: unit tests — US block extraction, SP parsing, role parsing, edge cases)

**Requirements Addressed:** FR-001, FR-002, FR-003, FR-004, FR-012, US-001, US-002, US-008, TC-001, TC-005, DM-001

**Dependencies:** None within this plan. Depends on `src/utils/config.ts` from 001-cli-core.

**Contract Mapping:**
- `contracts/effort-engine.md` → `extractStories()` → `src/engine/spec-parser.ts`
- `contracts/effort-engine.md` → `computeEffort()` → `src/engine/effort.ts`
- `contracts/effort-engine.md` → `resolveRoleMultipliers()` → `src/engine/roles.ts`
- `contracts/effort-engine.md` → `writeEffortReport()` → `src/engine/report-writer.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md | TypeScript only, no `.js` in `src/`, fail-fast config |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/engine/spec-parser.test.ts` | Story extraction from spec.md: US-001 with SP=5 and role=TS extracted correctly |
| TR-002 | Unit | `src/engine/effort.test.ts` | 5 SP × TS(4h) = 20h raw, 25h with 1.25× overhead |
| TR-003 | Unit | `src/engine/effort.test.ts` | Report file exists at `docs/assessments/effort-<feature>-*.md` |
| TR-004 | Unit | `src/engine/effort.test.ts` | Missing spec.md → exit 1, stderr contains "spec.md not found" |
| TR-013 | Unit | `src/engine/effort.test.ts` | Config override: TS multiplier set to 6 in config → 6h/SP used |

#### Done When
- `pnpm vitest run src/engine/effort.test.ts` exits 0
- `pnpm vitest run src/engine/spec-parser.test.ts` exits 0
- `test -f src/engine/effort.ts` exits 0
- `test -f src/engine/spec-parser.ts` exits 0
- `test -f src/engine/roles.ts` exits 0
- `test -f src/engine/report-writer.ts` exits 0
- `test -f src/engine/types.ts` exits 0

---

### Phase 2: Compression Engine

Timestamp collection from Git log and OS file dates, commit clustering with configurable gap threshold, Point/Total compression ratio calculation, dormancy tracking, cross-feature summary aggregation.

**Files (6):**
- `src/engine/compression.ts` (NEW: compression engine — timestamp collection, ratio computation, summary generation)
- `src/engine/git-timestamps.ts` (NEW: extracts spec creation date, first/last impl commit, PR merge time from Git log and `gh` CLI, with graceful degradation)
- `src/engine/commit-cluster.ts` (NEW: clusters commits by configurable gap threshold, computes session count and active coding time)
- `src/engine/compression.test.ts` (NEW: unit tests — timestamp collection, clustering, ratios, summary, fail-fast on no impl)
- `src/engine/git-timestamps.test.ts` (NEW: unit tests — Git log parsing, `gh` fallback, OS file dates)
- `src/engine/commit-cluster.test.ts` (NEW: unit tests — gap detection, session boundaries, edge cases)

**Requirements Addressed:** FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, US-003, US-004, US-005, US-006, TC-001, TC-002, TC-004, TC-006, DM-002, DM-003

**Dependencies:** Phase 1 of this plan (effort engine provides the forecast data for compression ratios).

**Contract Mapping:**
- `contracts/compression-engine.md` → `collectTimestamps()` → `src/engine/git-timestamps.ts`
- `contracts/compression-engine.md` → `clusterCommits()` → `src/engine/commit-cluster.ts`
- `contracts/compression-engine.md` → `computeCompression()` → `src/engine/compression.ts`
- `contracts/compression-engine.md` → `generateSummary()` → `src/engine/compression.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md | TypeScript only, no `.js` in `src/`, fail-fast config |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit | `src/engine/git-timestamps.test.ts` | Spec creation date, first/last impl commit extracted from mocked `git log` output |
| TR-006 | Unit | `src/engine/commit-cluster.test.ts` | Timestamps [0,5,10,120,125] → 2 sessions, 15 min active |
| TR-007 | Unit | `src/engine/compression.test.ts` | 287.5h / 0.75h = 383× point compression |
| TR-008 | Unit | `src/engine/compression.test.ts` | 36 days / 0.73 days = 49× total compression |
| TR-009 | Unit | `src/engine/compression.test.ts` | Summary across 3 features with best/worst/trend |
| TR-010 | Unit | `src/engine/compression.test.ts` | No impl commits → exit 1, stderr "No implementation commits found" |

#### Done When
- `pnpm vitest run src/engine/compression.test.ts` exits 0
- `pnpm vitest run src/engine/git-timestamps.test.ts` exits 0
- `pnpm vitest run src/engine/commit-cluster.test.ts` exits 0
- `test -f src/engine/compression.ts` exits 0
- `test -f src/engine/git-timestamps.ts` exits 0
- `test -f src/engine/commit-cluster.ts` exits 0

---

### Phase 3: CLI Commands + Integration

Commander commands `gwrk effort` and `gwrk compression`, `--json` output mode, config schema extension for role multipliers and session gap threshold. Wires the engine modules from Phase 1 and Phase 2 into the CLI and registers them in `src/cli.ts`.

**Files (7):**
- `src/commands/effort.ts` (NEW: Commander command — loads config, calls effort engine, writes report, supports `--json`)
- `src/commands/compression.ts` (NEW: Commander command — loads config, calls compression engine, formats output, supports `--json` and `--all`)
- `src/commands/effort.test.ts` (NEW: unit tests — command wiring, `--json` output schema, error handling)
- `src/commands/compression.test.ts` (NEW: unit tests — command wiring, `--json` output, `--all` flag, error handling)
- `src/cli.ts` (MODIFY: register `effort` and `compression` subcommands)
- `src/utils/config.ts` (MODIFY: extend `GwrkConfigSchema` with `effort.roles` and `compression.sessionGapMinutes`)
- `src/utils/config.test.ts` (MODIFY: add tests for extended config schema)

**Requirements Addressed:** FR-011, FR-012, US-007, US-008, TC-003, TC-004

**Dependencies:** Phase 1 and Phase 2 of this plan. Also depends on `001-cli-core` for Commander setup and config infrastructure.

**Contract Mapping:**
- `contracts/effort-engine.md` → `effortCommand()` → `src/commands/effort.ts`
- `contracts/compression-engine.md` → `compressionCommand()` → `src/commands/compression.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md | TypeScript only, fail-fast config, no `.default()` for required fields |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-011 | Unit | `src/commands/effort.test.ts` | `--json` flag outputs valid JSON with `totalSP`, `roles` fields |
| TR-012 | Unit | `src/commands/compression.test.ts` | `--json` flag outputs valid JSON with `pointCompression`, `totalCompression` fields |
| TR-013 | Unit | `src/utils/config.test.ts` | Config with `effort.roles.TS.hoursPerSP: 6` → effort engine uses 6h/SP |

#### Done When
- `pnpm vitest run src/commands/effort.test.ts` exits 0
- `pnpm vitest run src/commands/compression.test.ts` exits 0
- `pnpm vitest run src/utils/config.test.ts` exits 0
- `grep -q 'effort' src/cli.ts` exits 0
- `grep -q 'compression' src/cli.ts` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `EffortReport` | `src/engine/types.ts` | `src/engine/effort.ts`, `src/engine/report-writer.ts`, `src/commands/effort.ts`, `src/engine/compression.ts` |
| `RoleBreakdown` | `src/engine/types.ts` | `src/engine/effort.ts`, `src/engine/report-writer.ts` |
| `StoryEstimate` | `src/engine/types.ts` | `src/engine/effort.ts`, `src/engine/spec-parser.ts` |
| `RoleConfig` | `src/engine/types.ts` | `src/engine/roles.ts`, `src/utils/config.ts` |
| `CompressionReport` | `src/engine/types.ts` | `src/engine/compression.ts`, `src/commands/compression.ts` |
| `DeliveryActuals` | `src/engine/types.ts` | `src/engine/compression.ts`, `src/engine/git-timestamps.ts` |
| `CompressionRatios` | `src/engine/types.ts` | `src/engine/compression.ts`, `src/commands/compression.ts` |
| `CompressionSummary` | `src/engine/types.ts` | `src/engine/compression.ts`, `src/commands/compression.ts` |
| `CommitCluster` | `src/engine/types.ts` | `src/engine/commit-cluster.ts`, `src/engine/compression.ts` |
| `GwrkConfig` (extended) | `src/utils/config.ts` | `src/commands/effort.ts`, `src/commands/compression.ts`, `src/engine/roles.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| FR-008 (Telegram) | Compression summary on merge | Requires Phase 3 (Telegram) infrastructure | Spec 003-telegram |
| SC-003 | Cross-feature `--all` trend analysis | Requires ≥2 shipped features to meaningfully test | VR-002 covers math; real validation at GForge integration (Phase 10) |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | Phase 1 | Planned |
| US-002 | Phase 1 | Planned |
| US-003 | Phase 2 | Planned |
| US-004 | Phase 2 | Planned |
| US-005 | Phase 2 | Planned |
| US-006 | Phase 2 | Planned |
| US-007 | Phase 3 | Planned |
| US-008 | Phase 3 | Planned |
| FR-001 | Phase 1 | Planned |
| FR-002 | Phase 1 | Planned |
| FR-003 | Phase 1 | Planned |
| FR-004 | Phase 1 | Planned |
| FR-005 | Phase 2 | Planned |
| FR-006 | Phase 2 | Planned |
| FR-007 | Phase 2 | Planned |
| FR-008 | Phase 2 | Planned |
| FR-009 | Phase 2 | Planned |
| FR-010 | Phase 2 | Planned |
| FR-011 | Phase 3 | Planned |
| FR-012 | Phase 1, Phase 3 | Planned |
| TC-001 | Phase 1, Phase 2 | Planned |
| TC-002 | Phase 2 | Planned |
| TC-003 | Phase 3 | Planned |
| TC-004 | Phase 2, Phase 3 | Planned |
| TC-005 | Phase 1 | Planned |
| TC-006 | Phase 2 | Planned |
| DM-001 | Phase 1 | Planned |
| DM-002 | Phase 2 | Planned |
| DM-003 | Phase 2 | Planned |
| TR-001 | Phase 1 | Planned |
| TR-002 | Phase 1 | Planned |
| TR-003 | Phase 1 | Planned |
| TR-004 | Phase 1 | Planned |
| TR-005 | Phase 2 | Planned |
| TR-006 | Phase 2 | Planned |
| TR-007 | Phase 2 | Planned |
| TR-008 | Phase 2 | Planned |
| TR-009 | Phase 2 | Planned |
| TR-010 | Phase 2 | Planned |
| TR-011 | Phase 3 | Planned |
| TR-012 | Phase 3 | Planned |
| TR-013 | Phase 1, Phase 3 | Planned |
| SC-001 | Phase 1 | Planned |
| SC-002 | Phase 2 | Planned |
| SC-003 | Phase 2 | Deferred (see above) |
| SC-004 | Phase 2 | Planned |
| VR-001 | Phase 1 | Planned |
| VR-002 | Phase 2 | Planned |
| VR-003 | Phase 1 | Planned |
| VR-004 | Phase 2 | Planned |
| VR-005 | Phase 2 | Planned |
| VR-006 | Phase 2 | Planned |
