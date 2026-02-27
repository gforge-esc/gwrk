# Implementation Plan: 006 Pulse

**Branch**: `006-pulse` | **Date**: 2026-02-27 | **Spec**: [spec.md](./spec.md)

## Summary

Implement the Pulse productivity dashboard engine and CLI commands. Pulse walks the Git log of any repository, generates weekly LOC buckets separated by published (main branch) vs. draft (feature branches), and aggregates across multiple tracked repos. The implementation is split into three phases: (1) the core git log scanning engine, (2) the CLI commands and config integration, (3) multi-repo aggregation and spec progress scanning.

**Upstream dependency**: Phase 1 (`001-cli-core`) — provides Commander.js CLI framework, `loadConfig()`, Zod-validated `.gwrkrc.json`.

**Downstream consumers**: Phase 10 (`010-gforge-integration`), Phase 11 (`011-glass-dashboard`, Pulse View panel).

**Cross-reference notes**:
- `001-cli-core` contracts: Pulse extends `GwrkConfig` with `pulse.repos`. `loadConfig()` from `src/utils/config.ts` will be the config entry point.
- `007-effort-compression`: No shared types. Compression's Git timestamp collection (commit clustering) is separate from Pulse's LOC bucketing. Both consume `git log` but with different `--format` flags and for different purposes.

---

## Phases and File Structure

### Phase 1: Pulse Engine (Git Log Scanner + PulseSnapshot)

Core engine that scans a single git repository and produces a `PulseSnapshot` — the foundational data structure for all Pulse operations.

**Files (6):**
- `src/engine/pulse.ts` (NEW: Git log scanner, weekly bucket generator, branch separator, default branch detector)
- `src/engine/pulse.test.ts` (NEW: Unit tests for git log parsing, bucketing, branch separation, default branch detection)
- `src/engine/types.ts` (NEW: `PulseSnapshot`, `WeeklyBucket`, `PulseReport`, `SpecProgress` type definitions + Zod schemas)
- `src/utils/git.ts` (NEW: Git shell helpers — `gitLog()`, `gitDefaultBranch()`, `gitBranches()`, `gitLineCount()`)
- `src/utils/git.test.ts` (NEW: Unit tests for git helpers with mocked `execFileSync`)
- `src/engine/pulse-integration.test.ts` (NEW: Integration test using real temp git repo)

**Requirements Addressed:** FR-002, FR-003, FR-004, FR-007, FR-008, US-002, US-003, US-004, US-007, US-008, TC-001, TC-002, TC-004, TC-005, DM-001

**Dependencies:** None (engine is standalone)

**Contract Mapping:**
- `contracts/pulse-engine.md` → `scanRepository(repoPath)` → `src/engine/pulse.ts`
- `contracts/pulse-engine.md` → `detectDefaultBranch(repoPath)` → `src/utils/git.ts`
- `contracts/pulse-engine.md` → `parseGitLog(raw)` → `src/engine/pulse.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | TypeScript only, no `.js` in `src/` |
| `workspace.md` | No magic values — session gap thresholds, bucket sizes from config or constants |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/engine/pulse.test.ts` | Given mock `git log --numstat` output, verify weekly buckets match expected counts |
| TR-002 | Unit | `src/engine/pulse.test.ts` | Given mock branch listing + commit ancestry, verify `mainLoc` and `draftLoc` separation |
| TR-003 | Unit | `src/utils/git.test.ts` | Mock `git symbolic-ref` → verify fallback chain: `main` → `master` → `trunk` → error |
| TR-007 | Integration | `src/engine/pulse-integration.test.ts` | Create real git repo in `/tmp/`, commits across 3 weeks, verify bucket counts |

#### Done When
- `npx vitest run src/engine/pulse.test.ts` exits 0
- `npx vitest run src/utils/git.test.ts` exits 0
- `npx vitest run src/engine/pulse-integration.test.ts` exits 0
- `npx tsc --noEmit` exits 0

---

### Phase 2: CLI Commands + Config Integration

Commander.js commands for `gwrk pulse` and `gwrk pulse scan [path]`, plus Zod config extension for `pulse.repos`.

**Files (5):**
- `src/commands/pulse.ts` (NEW: `gwrk pulse` and `gwrk pulse scan [path]` Commander subcommands, terminal table renderer)
- `src/commands/pulse.test.ts` (NEW: Unit tests for pulse commands — config reading, path validation, JSON output, error cases)
- `src/utils/config.ts` (MODIFY: Extend `GwrkConfigSchema` with optional `pulse` section containing `repos: string[]`)
- `src/utils/config.test.ts` (MODIFY: Add tests for pulse config extension)
- `src/cli.ts` (MODIFY: Register `pulse` command group with Commander)

**Requirements Addressed:** FR-001, FR-006, US-001, US-006, TC-003, DM-003

**Dependencies:** Phase 1 (engine must exist)

**Contract Mapping:**
- `contracts/pulse-cli.md` → `registerPulseCommands(program)` → `src/commands/pulse.ts`
- `contracts/config.md` (001-cli-core) → `loadConfig()` → `src/utils/config.ts` (extended)

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | Fail-fast config — no `.default()` calls on required fields |
| `workspace.md` | TypeScript only |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-004 | Unit | `src/commands/pulse.test.ts` | Mock engine, verify `gwrk pulse` reads `pulse.repos` from config and invokes scanner per repo |
| TR-005 | Unit | `src/commands/pulse.test.ts` | Verify `gwrk pulse scan <path>` validates path, calls engine, outputs JSON when `--json` |
| TR-006 | Unit | `src/commands/pulse.test.ts` | Verify error cases: non-existent path → exit 1, non-git-repo → exit 1, missing config → exit 1 |

#### Done When
- `npx vitest run src/commands/pulse.test.ts` exits 0
- `npx vitest run src/utils/config.test.ts` exits 0
- `npx tsc --noEmit` exits 0
- `node dist/cli.js pulse --help` exits 0
- `node dist/cli.js pulse scan --help` exits 0

---

### Phase 3: Multi-Repo Aggregation + Spec Progress

Multi-repo Pulse report generation, spec progress scanning, and terminal table formatting.

**Files (4):**
- `src/engine/pulse.ts` (MODIFY: Add `generatePulseReport()` for multi-repo aggregation and `scanSpecProgress()` for spec counting)
- `src/engine/pulse.test.ts` (MODIFY: Add tests for multi-repo aggregation and spec progress scanning)
- `src/commands/pulse.ts` (MODIFY: Wire multi-repo aggregation into `gwrk pulse` command, add terminal table renderer)
- `src/commands/pulse.test.ts` (MODIFY: Add tests for multi-repo output formatting)

**Requirements Addressed:** FR-001, FR-005, US-001, US-005, DM-002

**Dependencies:** Phase 1 (engine), Phase 2 (CLI commands)

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | TypeScript only |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-004 | Unit | `src/commands/pulse.test.ts` | Verify multi-repo aggregation renders all repos in terminal table |
| TR-008 | Unit | `src/engine/pulse.test.ts` | Given mock `specs/` directory, verify correct `totalSpecs` and `totalPlans` counts |

#### Done When
- `npx vitest run src/engine/pulse.test.ts` exits 0
- `npx vitest run src/commands/pulse.test.ts` exits 0
- `npx tsc --noEmit` exits 0
- `gwrk pulse --json | jq '.specProgress.totalSpecs'` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `PulseSnapshot` | `src/engine/types.ts` | `src/engine/pulse.ts`, `src/commands/pulse.ts`, future: `010-gforge-integration` |
| `WeeklyBucket` | `src/engine/types.ts` | `src/engine/pulse.ts`, `src/commands/pulse.ts` |
| `PulseReport` | `src/engine/types.ts` | `src/commands/pulse.ts`, future: `011-glass-dashboard` |
| `SpecProgress` | `src/engine/types.ts` | `src/engine/pulse.ts`, `src/commands/pulse.ts` |
| `PulseConfig` | `src/utils/config.ts` | `src/commands/pulse.ts` (config extension within GwrkConfig) |
| `GwrkConfig` | `src/utils/config.ts` (001-cli-core) | Extended with `pulse?: PulseConfig` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| US-007 / FR-007 | Performance on 50K-commit repos | Performance validation requires large synthetic repo; constraint is enforced by design (single-pass `git log --numstat`) but formal 60s benchmark deferred to integration testing during `/implement` | Phase 1 integration test |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | Phase 2, Phase 3 | Planned |
| US-002 | Phase 1 | Planned |
| US-003 | Phase 1 | Planned |
| US-004 | Phase 1 | Planned |
| US-005 | Phase 3 | Planned |
| US-006 | Phase 2 | Planned |
| US-007 | Phase 1 (deferred benchmark) | Planned |
| US-008 | Phase 1 | Planned |
| FR-001 | Phase 2, Phase 3 | Planned |
| FR-002 | Phase 1 | Planned |
| FR-003 | Phase 1 | Planned |
| FR-004 | Phase 1 | Planned |
| FR-005 | Phase 3 | Planned |
| FR-006 | Phase 2 | Planned |
| FR-007 | Phase 1 | Planned |
| FR-008 | Phase 1 | Planned |
| TR-001 | Phase 1 | Planned |
| TR-002 | Phase 1 | Planned |
| TR-003 | Phase 1 | Planned |
| TR-004 | Phase 2, Phase 3 | Planned |
| TR-005 | Phase 2 | Planned |
| TR-006 | Phase 2 | Planned |
| TR-007 | Phase 1 | Planned |
| TR-008 | Phase 3 | Planned |
| TC-001 | Phase 1 | Planned |
| TC-002 | Phase 1 | Planned |
| TC-003 | Phase 2 | Planned |
| TC-004 | Phase 1 | Planned |
| TC-005 | Phase 1 | Planned |
| DM-001 | Phase 1 | Planned |
| DM-002 | Phase 3 | Planned |
| DM-003 | Phase 2 | Planned |
| SC-001 | Phase 1 | Planned |
| SC-002 | Phase 2, Phase 3 | Planned |
| SC-003 | Phase 1 | Planned |
| SC-004 | Phase 1 | Planned |
| VR-001 | Phase 1 | Planned |
| VR-002 | Phase 2 | Planned |
| VR-003 | Phase 2 | Planned |
| VR-004 | Phase 1 | Planned |
