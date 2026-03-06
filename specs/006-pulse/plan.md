# Implementation Plan: 006 Pulse

**Branch**: `006-pulse` | **Date**: 2026-03-06 | **Spec**: [spec.md](./spec.md)

## Summary

This plan addresses the remaining gaps in the Pulse productivity dashboard. While the basic structure exists, this implementation will focus on ensuring high-performance git scanning, accurate historical "Draft" line counts, robust default branch detection with overrides, and polished Unicode terminal output. It also fulfills the requirement for multi-repo aggregation and spec progress tracking.

---

## Phases and File Structure

### Phase 1: Engine & Git Utility Refinement

Focus on improving the performance of the git scanner and ensuring the engine supports branch overrides and accurate historical bucketing of draft LOC.

**Files (4):**
- `src/utils/git.ts` (MODIFY: Update `detectDefaultBranch` to support overrides; Replace slow `gitLineCount` loop with a single `git rev-list --objects --all` or `git ls-tree` based approach for better performance; Implement `gitDraftLineCount` correctly.)
- `src/engine/pulse.ts` (MODIFY: Update `scanRepository` and `bucketByWeek` signatures to accept `branch` override; Implement `totalDrafts` calculation in `bucketByWeek`.)
- `src/engine/types.ts` (MODIFY: Ensure Zod schemas align with DM-001/DM-002; remove hardcoded stubs.)
- `src/utils/config.ts` (MODIFY: Verify `pulse.repos` Zod validation.)

**Requirements Addressed**: FR-003, FR-004, FR-007, FR-008, US-003, US-004, US-007, US-008, TC-001, TC-003

**Dependencies**: None

**Contract Mapping**:
- `specs/006-pulse/contracts/pulse-engine.md` → `scanRepository` → `src/engine/pulse.ts`
- `specs/006-pulse/contracts/pulse-engine.md` → `detectDefaultBranch` → `src/utils/git.ts`
- `specs/006-pulse/contracts/pulse-engine.md` → `bucketByWeek` → `src/engine/pulse.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agent/rules/coding-style.md | Ensure idiomatic TypeScript and consistent error handling. |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/engine/pulse.test.ts` | Verify weekly buckets (added/deleted) from mock git log. |
| TR-002 | Unit | `src/engine/pulse.test.ts` | Verify mainLoc vs draftLoc separation with branch ancestry. |
| TR-003 | Unit | `src/engine/pulse.test.ts` | Verify default branch detection fallback chain. |
| TR-007 | Integration | `src/engine/pulse-integration.test.ts` | Scan real temp repo; verify LOC totals and performance (<60s). |

#### Done When
- `npm test src/engine/pulse.test.ts` exits 0
- `npm test src/engine/pulse-integration.test.ts` exits 0

### Phase 2: CLI Commands & Terminal Rendering

Update the CLI implementation to support all flags, handle multi-repo aggregation, and render high-quality terminal tables using Unicode box-drawing characters.

**Files (2):**
- `src/commands/pulse.ts` (MODIFY: Implement `renderPulseTable` and `renderSnapshotTable` using Unicode box-drawing; Support `--branch` and `--json` flags; Implement `gwrk pulse` multi-repo logic.)
- `src/engine/pulse.ts` (MODIFY: Complete `generatePulseReport` and `scanSpecProgress` implementation.)

**Requirements Addressed**: FR-001, FR-002, FR-005, FR-006, US-001, US-002, US-005, US-006

**Dependencies**: Phase 1

**Contract Mapping**:
- `specs/006-pulse/contracts/pulse-cli.md` → `registerPulseCommands` → `src/commands/pulse.ts`
- `specs/006-pulse/contracts/pulse-cli.md` → `renderPulseTable` → `src/commands/pulse.ts`
- `specs/006-pulse/contracts/pulse-engine.md` → `generatePulseReport` → `src/engine/pulse.ts`
- `specs/006-pulse/contracts/pulse-engine.md` → `scanSpecProgress` → `src/engine/pulse.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agent/rules/workspace.md | Follow terminal output standards and Unicode usage rules. |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-004 | Unit | `src/commands/pulse.test.ts` | `gwrk pulse` reads config and aggregates repos. |
| TR-005 | Unit | `src/commands/pulse.test.ts` | `gwrk pulse scan` validates path and outputs JSON. |
| TR-008 | Unit | `src/engine/pulse.test.ts` | `scanSpecProgress` returns correct counts for `specs/`. |

#### Done When
- `npm test src/commands/pulse.test.ts` exits 0
- `gwrk pulse --json | jq '.'` (in a repo with config) exits 0

### Phase 3: Final Verification & E2E

Perform exhaustive testing of all user scenarios, error states, and cross-feature compatibility (especially with 007-effort-compression).

**Files (2):**
- `src/cli.test.ts` (MODIFY: Add E2E scenarios for `pulse` and `pulse scan`.)
- `src/engine/pulse-integration.test.ts` (MODIFY: Add performance benchmark and large-repo simulation.)

**Requirements Addressed**: VR-001, VR-002, VR-003, VR-004, SC-001, SC-002, SC-003, SC-004

**Dependencies**: Phase 2

**Contract Mapping**: None (Verification Phase)

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-006 | Unit | `src/commands/pulse.test.ts` | Verify stderr and exit codes for all error conditions. |
| VR-001 | E2E | `src/cli.test.ts` | Full scan of temp repo matches expected JSON schema and values. |
| VR-004 | E2E | `src/cli.test.ts` | Determinism: two runs on same repo produce identical JSON output. |

#### Done When
- `npm test` (all tests) exits 0
- `npx tsc` (full project) exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| PulseSnapshot | `src/engine/types.ts` | `src/engine/pulse.ts`, `src/commands/pulse.ts`, `007-effort-compression` |
| PulseReport | `src/engine/types.ts` | `src/engine/pulse.ts`, `src/commands/pulse.ts` |
| WeeklyBucket | `src/engine/types.ts` | `src/engine/pulse.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature (Terminal-based)._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| US-007 | 50K Commit Perf | Validated via simulation, but full validation against massive real-world mono-repos is deferred to Phase 4 (Profiling). | Future |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| FR-001 | 2 | PLANNED |
| FR-002 | 2 | PLANNED |
| FR-003 | 1 | PLANNED |
| FR-004 | 1 | PLANNED |
| FR-005 | 2 | PLANNED |
| FR-006 | 2 | PLANNED |
| FR-007 | 1 | PLANNED |
| FR-008 | 1 | PLANNED |
| US-001 | 2 | PLANNED |
| US-002 | 2 | PLANNED |
| US-003 | 1 | PLANNED |
| US-004 | 1 | PLANNED |
| US-005 | 2 | PLANNED |
| US-006 | 2 | PLANNED |
| US-007 | 1 | PLANNED |
| US-008 | 1 | PLANNED |
| DM-001 | 1 | PLANNED |
| DM-002 | 1 | PLANNED |
| DM-003 | 1 | PLANNED |
| TC-001 | 1, 3 | PLANNED |
| TC-002 | 1 | PLANNED |
| TC-003 | 1 | PLANNED |
| TR-001 | 1 | PLANNED |
| TR-002 | 1 | PLANNED |
| TR-003 | 1 | PLANNED |
| TR-004 | 2 | PLANNED |
| TR-005 | 2 | PLANNED |
| TR-006 | 3 | PLANNED |
| TR-007 | 1, 3 | PLANNED |
| TR-008 | 2 | PLANNED |
| SC-001 | 3 | PLANNED |
| SC-002 | 3 | PLANNED |
| SC-003 | 3 | PLANNED |
| SC-004 | 3 | PLANNED |
| VR-001 | 3 | PLANNED |
| VR-002 | 3 | PLANNED |
| VR-003 | 3 | PLANNED |
| VR-004 | 3 | PLANNED |
