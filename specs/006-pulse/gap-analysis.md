---
type: gap_analysis
feature: 006-pulse
last_modified: "2026-03-05T21:50:05Z"
---

# Gap Analysis: 006 Pulse

**Date**: 2026-03-05
**Feature**: 006-pulse

## 1. Overview of Existing State

A substantial portion of the Pulse feature has been implemented, including the core engine, git utilities, CLI commands, and multi-repo aggregation. However, several critical functional gaps and technical refinements remain to fully satisfy the specifications and contracts.

### Implemented Files
- `src/engine/pulse.ts`: Core scanning logic, weekly bucketing, spec progress.
- `src/engine/types.ts`: Zod schemas and TypeScript types for Pulse.
- `src/utils/git.ts`: Git shell helpers for log, branches, line counts.
- `src/commands/pulse.ts`: CLI command registration and basic table rendering.
- `src/utils/config.ts`: Configuration extension for `pulse.repos`.
- `src/cli.ts`: Registration of the `pulse` command.

## 2. Gap Analysis

### Functional Gaps

| Requirement | Status | Gap Description |
|---|---|---|
| **FR-003: Draft separation** | `partial` | `totalDrafts` in `WeeklyBucket` is hardcoded to 0. `mainLoc` and `draftLoc` in `PulseSnapshot` are computed but not for historical buckets. |
| **FR-004: Weekly bucketing** | `partial` | `totalMain` in `WeeklyBucket` is a running total of `added - deleted`, which is an approximation of LOC at that time. |
| **FR-008: Default branch** | `partial` | `detectDefaultBranch` doesn't support the `--branch` override parameter in its signature, though the CLI accepts it. |
| **FR-001: Terminal Table** | `wrong` | Current tables use simple text/dashes. Contract specifies "Unicode box-drawing characters" and "PRD §14 example format". |
| **US-007: Performance** | `missing` | `gitLineCount` uses a slow per-file `git show` loop in a bash pipeline. Needs a more performant approach for large repos. |

### Technical Gaps

| Area | Gap Description |
|---|---|
| **Contracts** | `scanRepository` signature in `src/engine/pulse.ts` lacks the `branch` override defined in `contracts/pulse-engine.md`. |
| **Robustness** | `parseGitLog` needs more robust handling of complex git renames and binary file markers in `--numstat`. |
| **Tests** | Existing tests are "RED" stubs and need to be verified/updated to match implementation. `src/engine/pulse-integration.test.ts` exists but implementation completeness is unknown. |

### Governance & Standards Gaps

| Rule | Status | Gap Description |
|---|---|---|
| **workspace.md** | `wrong` | Hardcoded values in `renderSnapshotTable` (e.g., `.slice(-4)`) should be configurable or follow "no magic values" rule. |

## 3. Classification

- `greenfield`: None. All core files exist.
- `wrong`: `renderPulseTable` (style), `bucketByWeek` (missing `totalDrafts`), `gitLineCount` (performance).
- `missing`: Historical `totalDrafts` in buckets, `--branch` override propagation to engine.

## 4. Proposed Adjustments to Plan

The original Phase 1/2/3 structure is mostly complete, so the remaining work should focus on **Fulfillment & Refinement**:

1.  **Refine Git Utils**: Improve `gitLineCount` performance, implement `detectDefaultBranch` override, and fix `gitDraftLineCount` overlap.
2.  **Enhance Engine**: Implement `totalDrafts` bucketing in `bucketByWeek` and propagate branch overrides.
3.  **Polish CLI**: Update table rendering to match PRD/Contract style (Unicode box-drawing).
4.  **Validate**: Complete and run all unit and integration tests.

---
**Status**: Awaiting approval to proceed to task generation.
