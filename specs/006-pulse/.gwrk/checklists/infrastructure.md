# Infrastructure Checklist: 006 Pulse

**Purpose**: Verify the foundational Pulse engine, git utilities, and data models.
**Created**: 2026-03-05
**Feature**: [spec.md](../../spec.md)

## Pulse Engine & Git Utilities

- [ ] CHK-001: Git log parser handles renames and binary file markers in `--numstat` (FR-002, US-002, T003)
- [ ] CHK-002: Weekly bucketing correctly groups commits by ISO week (Monday-based) (FR-004, US-004)
- [ ] CHK-003: Default branch detection uses `symbolic-ref` with fallback to `main/master/trunk` (FR-008, US-008, T001)
- [ ] CHK-004: Branch separation: `mainLoc` vs `draftLoc` calculation (FR-003, US-003, T002, T004)
- [ ] CHK-005: Engine performance: scan ≤ 50K-commit repo in under 60s (FR-007, US-007)
- [ ] CHK-006: Spec progress scanner correctly counts `spec.md` and `plan.md` in `specs/` (FR-005, US-005)

## Data Models & Configuration

- [ ] CHK-007: `PulseSnapshot` schema matches DM-001 requirements
- [ ] CHK-008: `PulseReport` schema matches DM-002 requirements
- [ ] CHK-009: `GwrkConfig` is extended with `pulse.repos` using Zod validation (DM-003, TC-003)
- [ ] CHK-010: All Pulse engine outputs (Snapshot, Report) are Zod-validated before return (TC-003)

## CLI Integration

- [ ] CHK-011: `gwrk pulse` aggregates all repos in `.gwrkrc.json` (FR-001, US-001)
- [ ] CHK-012: `gwrk pulse scan [path]` works on any git repo (FR-002, US-002)
- [ ] CHK-013: Both commands support `--json` output (FR-006, US-006)
- [ ] CHK-014: Error handling for missing config, invalid paths, and non-git repos (FR-001, FR-002, FR-008)

## Verification Infrastructure

- [ ] CHK-015: Unit tests for git utilities in `src/utils/git.test.ts` (TR-003, T006)
- [ ] CHK-016: Unit tests for pulse engine in `src/engine/pulse.test.ts` (TR-001, TR-002, TR-008, T007)
- [ ] CHK-017: Integration tests with real temp git repository in `src/engine/pulse-integration.test.ts` (TR-007, T008)
- [ ] CHK-018: CLI command unit tests in `src/commands/pulse.test.ts` (TR-004, TR-005, TR-006, T011)

## Notes
- Check items off as completed: `[x]`
- Items are numbered sequentially (CHK-NNN) for cross-reference
- Link findings to relevant FR-###, US-###, or TR-### identifiers
