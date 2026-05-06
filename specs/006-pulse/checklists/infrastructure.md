# Infrastructure Checklist: 006 Pulse

**Purpose**: Verify the foundational data models, git utilities, engine logic, and CLI command structure for the Pulse productivity dashboard.
**Created**: 2026-03-05
**Feature**: [spec.md](../spec.md)

## Data Models & Types (DM-001, DM-002)

- [x] CHK-001: `PulseSnapshot` schema and type defined in `src/engine/types.ts` with required fields: `repoPath`, `repoName`, `defaultBranch`, `scannedAt`, `mainLoc`, `draftLoc`, `weeklyBuckets`. (DM-001, FR-003)
- [x] CHK-002: `WeeklyBucket` schema and type defined in `src/engine/types.ts` with fields: `weekStart`, `totalMain`, `totalDrafts`, `added`, `deleted`. (DM-001, FR-004)
- [x] CHK-003: `PulseReport` schema and type defined in `src/engine/types.ts` for multi-repo aggregation. (DM-002)
- [x] CHK-004: `SpecProgress` schema and type defined in `src/engine/types.ts` for tracking definitional work. (DM-002, FR-005)

## Git Integration Utilities (FR-008, TC-005)

- [x] CHK-005: `detectDefaultBranch` implemented in `src/utils/git.ts` with fallback logic: `symbolic-ref` -> `main` -> `master` -> `trunk` -> error. (FR-008, TC-005)
- [x] CHK-006: `gitLog` helper implemented in `src/utils/git.ts` using `--numstat` for efficient single-pass extraction. (TC-004)
- [x] CHK-007: `gitLineCount` implemented to count total lines at a specific ref. (FR-003)
- [x] CHK-008: `gitDraftLineCount` implemented to calculate LOC in non-default branches. (FR-003)

## Core Engine Logic (FR-002, FR-004)

- [x] CHK-009: `parseGitLog` implemented in `src/engine/pulse.ts` to transform raw git log into `ParsedCommit` objects. (FR-002)
- [x] CHK-010: `bucketByWeek` implemented in `src/engine/pulse.ts` to group commits by ISO week. (FR-004)
- [x] CHK-011: `scanRepository` implemented in `src/engine/pulse.ts` as the primary entry point for single-repo scans. (FR-002)
- [x] CHK-012: `generatePulseReport` implemented in `src/engine/pulse.ts` for multi-repo aggregation from config. (FR-001)
- [x] CHK-013: `scanSpecProgress` implemented in `src/engine/pulse.ts` to scan `specs/` directory for metrics. (FR-005)

## CLI Command Framework (FR-001, FR-006)

- [x] CHK-014: `pulse` command registered in `src/commands/pulse.ts` with support for `--json` output. (FR-001, FR-006)
- [x] CHK-015: `pulse scan <path>` subcommand registered in `src/commands/pulse.ts` for historical repo scanning. (FR-002, FR-006)
- [x] CHK-016: Path validation and error handling for `pulse scan` implemented (non-existent path, non-git-repo). (FR-002 Error States)
- [x] CHK-017: Terminal table rendering logic (`renderPulseTable`, `renderSnapshotTable`) implemented for human-readable output. (FR-001)

## Configuration & Schema Extension (DM-003, TC-003)

- [x] CHK-018: `GwrkConfigSchema` in `src/utils/config.ts` extended with optional `pulse` section containing `repos: string[]`. (DM-003)
- [x] CHK-019: `loadConfig` uses Zod for fail-fast validation of the new pulse configuration. (TC-003)

## Testing & Verification Foundation (TR-###, VR-###)

- [x] CHK-020: Unit tests for `parseGitLog` and `bucketByWeek` implemented in `src/engine/pulse.test.ts`. (TR-001)
- [x] CHK-021: Unit tests for published/draft separation implemented in `src/engine/pulse.test.ts`. (TR-002)
- [x] CHK-022: Unit tests for default branch detection implemented in `src/utils/git.test.ts`. (TR-003)
- [x] CHK-023: Unit tests for CLI commands implemented in `src/commands/pulse.test.ts`. (TR-004, TR-005, TR-006)
- [x] CHK-024: Integration test for engine implemented in `src/engine/pulse-integration.test.ts`. (TR-007)

## Verification Gate (Gate)

- [x] GATE-001: `npx vitest run src/engine/pulse.test.ts` passes.
- [x] GATE-002: `npx vitest run src/utils/git.test.ts` passes.
- [x] GATE-003: `npx vitest run src/commands/pulse.test.ts` passes.
- [x] GATE-004: `npx vitest run src/engine/pulse-integration.test.ts` passes.
- [x] GATE-005: `npx tsc --noEmit` passes (no type errors in infrastructure).
- [x] GATE-006: `gwrk pulse --help` and `gwrk pulse scan --help` display correct help text.

## Notes
- All core types and engine functions are implemented.
- Git utilities are in place; performance on large repos (FR-007) is addressed by design (single-pass `git log --numstat`).
- All infrastructure tests and verification gates pass.
- CLI entrypoint (`src/cli.ts`) was fixed by restoring the `implementCommand` shim.
