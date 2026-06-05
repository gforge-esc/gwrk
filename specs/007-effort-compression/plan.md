---
type: implementation_plan
feature: 007-effort-compression
last_modified: "2026-06-03T14:00:00Z"
---

# Implementation Plan: 007 Effort + Compression

**Branch**: `007-effort-compression` | **Date**: 2026-06-03 | **Spec**: [spec.md](./spec.md) | **Data Model**: [data-model.md](./data-model.md)

## Summary

Phase 7 ships the **Effort Engine** (story extraction, role bracketing, SP-derived hours, markdown reports) and the **Compression Engine** (timestamp collection, commit clustering, Point/Total compression ratios, leading indicators, dormancy tracking, cross-feature summaries). Both engines are pure TypeScript — deterministic from spec artifacts, Git log, and SQLite execution ledger, no LLM required.

The plan is split into 5 phases aligned with the architecture from `docs/architecture.md` §3:
- **Phase 1**: Effort Engine — `src/engine/effort.ts` + spec parser + report writer
- **Phase 2**: Compression Engine — `src/engine/compression.ts` + Git timestamp collector + commit clustering + leading indicators + SQLite persistence
- **Phase 3**: CLI Commands + Integration — `src/commands/effort.ts`, `src/commands/compression.ts`, config schema extension, `--json` output
- **Phase 4**: LOC-Derived SP Fallback — `computeForecastFromLOC`, profile-keyed rates (TS=50, Rust=35, Python=65), and `resolveEffortConfig` three-layer chain.
- **Phase 5**: Harvest Integration — Wire LOC fallback into `harvestFeature`, include define-run elapsed from DB in actuals, and surface both Point and Full compression.

**Dependencies**: Phase 1 (CLI Core) must ship first — this plan consumes `src/utils/config.ts` (`loadConfig()`), `src/db/index.ts` (SQLite connection), and the Commander routing in `src/cli.ts`.

**Cross-spec compatibility**: 
- `001-cli-core`: Uses the `runs` table from the shared SQLite ledger for leading indicators.
- `006-pulse`: Complementary Git analysis. Pulse focus on velocity/LOC; Compression focus on SP vs Actuals.
- `011-harvest`: Phase 5 integrates the fallback mechanism directly into the harvest cycle.

---

## Phases and File Structure

### Phase 1: Effort Engine

Core effort estimation: parse spec.md for user stories, bracket by role, compute hours with the 1.25× overhead factor, generate a markdown report.

**Files (7):**
- `src/engine/effort.ts` (NEW: effort engine — story extraction, role bracketing, hour computation, report generation)
- `src/engine/spec-parser.ts` (NEW: markdown parser that extracts US-### blocks with SP values and role assignments from spec.md)
- `src/engine/types.ts` (NEW: shared TypeScript interfaces for EffortReport, RoleBreakdown, StoryEstimate, CompressionReport, DeliveryActuals, CompressionRatios, CompressionSummary, LeadingIndicators)
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

Timestamp collection from Git log, commit clustering, Point/Total compression ratio calculation, leading indicator computation (convergence, density, spec quality), dormancy tracking, SQLite persistence, and summary aggregation.

**Files (7):**
- `src/engine/compression.ts` (NEW: compression engine — ratio computation, leading indicators, summary generation, SQLite persistence)
- `src/engine/git-timestamps.ts` (NEW: extracts spec creation date, first/last impl commit, PR merge time from Git log and `gh` CLI)
- `src/engine/commit-cluster.ts` (NEW: clusters commits by gap threshold, computes active coding time)
- `src/engine/compression.test.ts` (NEW: unit tests — ratios, indicators, summary, fail-fast on no impl, SQLite persistence)
- `src/engine/git-timestamps.test.ts` (NEW: unit tests — Git log parsing, `gh` fallback)
- `src/engine/commit-cluster.test.ts` (NEW: unit tests — gap detection, session boundaries)
- `src/db/compression.ts` (NEW: SQLite adapters for `compression` table — insert, query, aggregate)

**Requirements Addressed:** FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-013, FR-014, US-003, US-004, US-005, US-006, US-009, US-010, TC-001, TC-002, TC-004, TC-006, DM-002, DM-003

**Dependencies:** Phase 1 of this plan (effort forecast data). 001-cli-core (SQLite ledger).

**Contract Mapping:**
- `contracts/compression-engine.md` → `collectTimestamps()` → `src/engine/git-timestamps.ts`
- `contracts/compression-engine.md` → `clusterCommits()` → `src/engine/commit-cluster.ts`
- `contracts/compression-engine.md` → `computeCompression()` → `src/engine/compression.ts`
- `contracts/compression-engine.md` → `computeIndicators()` → `src/engine/compression.ts`
- `contracts/compression-engine.md` → `generateSummary()` → `src/engine/compression.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md | TypeScript only, fail-fast config |
| seeding-governance.md | SQLite migrations and seed data for summary testing |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit | `src/engine/git-timestamps.test.ts` | Timestamps extracted from mocked `git log` |
| TR-006 | Unit | `src/engine/commit-cluster.test.ts` | [0,5,10,120,125] → 2 sessions, 15 min active |
| TR-007 | Unit | `src/engine/compression.test.ts` | 287.5h / 0.75h = 383× point compression |
| TR-008 | Unit | `src/engine/compression.test.ts` | 36 days / 0.73 days = 49× total compression |
| TR-009 | Unit | `src/engine/compression.test.ts` | Summary across features with best/worst/trend |
| TR-010 | Unit | `src/engine/compression.test.ts` | No impl commits → exit 1 |
| TR-014 | Unit | `src/db/db.test.ts` | SQLite record inserted/queried from `compression` table |
| TR-015 | Unit | `src/engine/compression.test.ts` | Convergence and density indicators computed correctly from mock runs and git |

#### Done When
- `pnpm vitest run src/engine/compression.test.ts` exits 0
- `pnpm vitest run src/engine/git-timestamps.test.ts` exits 0
- `pnpm vitest run src/engine/commit-cluster.test.ts` exits 0
- `test -f src/db/compression.ts` exits 0

---

### Phase 3: CLI Commands + Integration

Commander commands `measure effort` and `measure compression`, `--json` output mode, config schema extension. Wires engines into `src/cli.ts`.

**Files (7):**
- `src/commands/effort.ts` (NEW: Commander command — loads config, calls effort engine, writes report)
- `src/commands/compression.ts` (NEW: Commander command — calls compression engine, formats output, persistence)
- `src/commands/effort.test.ts` (NEW: unit tests — command wiring, `--json` output)
- `src/commands/compression.test.ts` (NEW: unit tests — command wiring, indicators in output)
- `src/cli.ts` (MODIFY: register `measure effort` and `measure compression` subcommands)
- `src/utils/config.ts` (MODIFY: extend `GwrkConfigSchema` with `effort.roles` and `compression.sessionGapMinutes`)
- `src/utils/config.test.ts` (MODIFY: add tests for extended config schema)

**Requirements Addressed:** FR-011, FR-012, FR-015, US-007, US-008, US-010, TC-003, TC-004

**Dependencies:** Phase 1 and Phase 2 of this plan. 001-cli-core for CLI structure.

**Contract Mapping:**
- `contracts/effort-engine.md` → `effortCommand()` → `src/commands/effort.ts`
- `contracts/compression-engine.md` → `compressionCommand()` → `src/commands/compression.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md | TypeScript only, fail-fast config |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-011 | Unit | `src/commands/effort.test.ts` | `--json` flag outputs valid JSON with `totalSP` |
| TR-012 | Unit | `src/commands/compression.test.ts` | Indicators appear in output and JSON |

#### Done When
- `pnpm vitest run src/commands/effort.test.ts` exits 0
- `pnpm vitest run src/commands/compression.test.ts` exits 0
- `grep -q 'measure effort' src/cli.ts` exits 0

---

### Phase 4: LOC-Derived SP Fallback

Implements LOC-derived Story Points as a fallback when spec explicit SP is missing. Adds three-layer config resolution (defaults -> profile -> overrides) for language-specific LOC rates.

**Files (6):**
- `src/engine/effort-defaults.ts` (NEW: compiled-in profile-keyed rates — TS=50, Rust=35, Python=65, DE=25)
- `src/engine/compression.ts` (MODIFY: add `computeForecastFromLOC` deriving SP from git numstat and spec/plan/research LOC)
- `src/utils/config.ts` (MODIFY: formal effort section in `GwrkConfigSchema`, add `resolveEffortConfig` three-layer chain)
- `src/engine/effort-defaults.test.ts` (NEW: unit tests for profile rate mapping)
- `src/engine/compression.test.ts` (MODIFY: test `computeForecastFromLOC` with mocked git and files)
- `src/utils/config.test.ts` (MODIFY: tests for three-layer resolution and schema validation)

**Requirements Addressed:** US-001, US-004, FR-016, FR-017, FR-019, DM-001, TC-001, TC-003

**Dependencies:** Phase 1 and Phase 2.

**Contract Mapping:**
- `contracts/compression-engine.md` → `computeForecastFromLOC()` → `src/engine/compression.ts`
- `contracts/effort-engine.md` → `resolveEffortConfig()` → `src/utils/config.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md | TypeScript only, fail-fast config |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/engine/compression.test.ts` | Verify LOC-derived SP calculation for TS, Rust, and Definitional text |
| TR-003 | Unit | `src/utils/config.test.ts` | Verify language detection and config overrides select the correct LOC/SP rate |
| TR-004 | Unit | `src/commands/effort.test.ts` | Verify fallback behavior when spec has no SP |

#### Done When
- `pnpm vitest run src/engine/effort-defaults.test.ts` exits 0
- `pnpm vitest run src/utils/config.test.ts` exits 0
- `grep -q 'computeForecastFromLOC' src/engine/compression.ts` exits 0

---

### Phase 5: Harvest Integration

Integrates the effort/compression engines with the Harvest cycle. Surfaces dual compression metrics (Point vs Full) and accurately accounts for total agent time including define runs from the DB.

**Files (4):**
- `src/engine/harvest.ts` (MODIFY: wire LOC fallback into `harvestFeature` when plan has no SP)
- `src/engine/compression.ts` (MODIFY: include define-run elapsed from DB `runs` table in actuals)
- `src/commands/compression.ts` (MODIFY: surface both Point and Full compression in CLI text and JSON output)
- `src/commands/compression.test.ts` (MODIFY: test dual compression CLI output)

**Requirements Addressed:** US-003, US-005, FR-007, FR-008, FR-009, FR-018, DM-002, TC-002

**Dependencies:** Phase 4 and Feature 011 (Harvest).

**Contract Mapping:**
- `contracts/compression-engine.md` → `computeFullCompression()` → `src/engine/compression.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md | TypeScript only |
| seeding-governance.md | Mocking SQLite runs data for total agent time tests |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-002 | Unit | `src/engine/compression.test.ts` | Verify Point vs Full calculation using mocked DB runs and git clusters |
| TR-012 | Unit | `src/commands/compression.test.ts` | Dual compression metrics (Point and Full) appear in output |

#### Done When
- `pnpm vitest run src/engine/compression.test.ts` exits 0
- `pnpm vitest run src/commands/compression.test.ts` exits 0
- `grep -q 'harvestFeature' src/engine/harvest.ts` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `EffortReport` | `src/engine/types.ts` | `src/engine/effort.ts`, `src/engine/report-writer.ts`, `src/commands/effort.ts`, `src/engine/compression.ts` |
| `RoleBreakdown` | `src/engine/types.ts` | `src/engine/effort.ts`, `src/engine/report-writer.ts` |
| `StoryEstimate` | `src/engine/types.ts` | `src/engine/effort.ts`, `src/engine/spec-parser.ts` |
| `RoleConfig` | `src/engine/types.ts` | `src/engine/roles.ts`, `src/utils/config.ts` |
| `CompressionReport` | `src/engine/types.ts` | `src/engine/compression.ts`, `src/commands/compression.ts`, `src/db/compression.ts` |
| `DeliveryActuals` | `src/engine/types.ts` | `src/engine/compression.ts`, `src/engine/git-timestamps.ts`, `src/engine/harvest.ts` |
| `CompressionRatios` | `src/engine/types.ts` | `src/engine/compression.ts`, `src/commands/compression.ts` |
| `LeadingIndicators` | `src/engine/types.ts` | `src/engine/compression.ts`, `src/commands/compression.ts`, `src/db/compression.ts` |
| `CompressionSummary` | `src/engine/types.ts` | `src/engine/compression.ts`, `src/commands/compression.ts` |
| `CommitCluster` | `src/engine/types.ts` | `src/engine/commit-cluster.ts`, `src/engine/compression.ts` |
| `EffortForecast` | `src/engine/types.ts` | `src/engine/compression.ts`, `src/commands/effort.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| FR-### | Compression summary in Slack | Requires Phase 3 (Slack) infrastructure | Spec 003-slack |
| SC-003 | Cross-feature `--all` trend analysis | Requires ≥3 shipped features to meaningfully test | VR-002 covers math |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | Phase 1, Phase 4 | Planned |
| US-002 | Phase 1 | Planned |
| US-003 | Phase 2, Phase 5 | Planned |
| US-004 | Phase 4 | Planned |
| US-005 | Phase 2, Phase 5 | Planned |
| US-006 | Phase 2 | Planned |
| US-007 | Phase 3 | Planned |
| US-008 | Phase 3 | Planned |
| US-009 | Phase 2 | Planned |
| US-010 | Phase 2, Phase 3 | Planned |
| FR-001 | Phase 1 | Planned |
| FR-002 | Phase 1 | Planned |
| FR-003 | Phase 1 | Planned |
| FR-004 | Phase 1 | Planned |
| FR-005 | Phase 2 | Planned |
| FR-006 | Phase 2 | Planned |
| FR-007 | Phase 2, Phase 5 | Planned |
| FR-008 | Phase 2, Phase 5 | Planned |
| FR-009 | Phase 2, Phase 5 | Planned |
| FR-010 | Phase 2 | Planned |
| FR-011 | Phase 3 | Planned |
| FR-012 | Phase 1, Phase 3, Phase 4 | Planned |
| FR-013 | Phase 2 | Planned |
| FR-014 | Phase 2 | Planned |
| FR-015 | Phase 3 | Planned |
| FR-016 | Phase 4 | Planned |
| FR-017 | Phase 4 | Planned |
| FR-018 | Phase 5 | Planned |
| FR-019 | Phase 4 | Planned |
| TC-001 | Phase 1, Phase 2, Phase 4 | Planned |
| TC-002 | Phase 2, Phase 5 | Planned |
| TC-003 | Phase 3, Phase 4 | Planned |
| TC-004 | Phase 2, Phase 3 | Planned |
| TC-005 | Phase 1 | Planned |
| TC-006 | Phase 2 | Planned |
| DM-001 | Phase 1, Phase 4 | Planned |
| DM-002 | Phase 2, Phase 5 | Planned |
| DM-003 | Phase 2 | Planned |
| TR-001 | Phase 1, Phase 4 | Planned |
| TR-002 | Phase 1, Phase 5 | Planned |
| TR-003 | Phase 1, Phase 4 | Planned |
| TR-004 | Phase 1, Phase 4 | Planned |
| TR-005 | Phase 2 | Planned |
| TR-006 | Phase 2 | Planned |
| TR-007 | Phase 2 | Planned |
| TR-008 | Phase 2 | Planned |
| TR-009 | Phase 2 | Planned |
| TR-010 | Phase 2 | Planned |
| TR-011 | Phase 3 | Planned |
| TR-012 | Phase 3, Phase 5 | Planned |
| TR-013 | Phase 1, Phase 3 | Planned |
| TR-014 | Phase 2 | Planned |
| TR-015 | Phase 2 | Planned |
| SC-001 | Phase 1, Phase 4 | Planned |
| SC-002 | Phase 2, Phase 5 | Planned |
| SC-003 | Phase 2 | Deferred (see above) |
| SC-004 | Phase 2 | Planned |
| VR-001 | Phase 1 | Planned |
| VR-002 | Phase 2 | Planned |
| VR-003 | Phase 1 | Planned |
| VR-004 | Phase 2 | Planned |
| VR-005 | Phase 2 | Planned |
| VR-006 | Phase 2 | Planned |
