# Requirements Checklist: 006 Pulse

**Purpose**: Verify all functional and testing requirements for the Pulse productivity dashboard are implemented.
**Created**: 2026-03-06
**Feature**: [spec.md](../spec.md)

## Functional Requirements

- [ ] CHK-001: Implement `gwrk measure pulse` command to aggregate tracked repos. (FR-001, US-001)
- [ ] CHK-002: Implement `gwrk measure pulse scan [path]` for historical analysis of any git repo. (FR-002, US-002)
- [ ] CHK-003: Separate LOC into `mainLoc` and `draftLoc` in snapshots. (FR-003, US-003)
- [ ] CHK-004: Generate weekly LOC buckets with `weekStart`, `totalMain`, `added`, `deleted`. (FR-004, US-004)
- [ ] CHK-005: Scan `specs/*/spec.md` and `plan.md` for `specProgress` metrics. (FR-005, US-005)
- [ ] CHK-006: Support `--json` output for all pulse commands. (FR-006, US-006)
- [ ] CHK-007: Optimize git log scanning for large repositories (≤ 60s for 50K commits). (FR-007, US-007)
- [ ] CHK-008: Auto-detect default branch (main/master/trunk). (FR-008, US-008)

## Testing Requirements

- [ ] CHK-009: Unit test git log parser in `src/engine/pulse.test.ts`. (TR-001)
- [ ] CHK-010: Unit test branch separation logic in `src/engine/pulse.test.ts`. (TR-002)
- [ ] CHK-011: Unit test default branch detection in `src/engine/pulse.test.ts`. (TR-003)
- [ ] CHK-012: Unit test `gwrk measure pulse` command in `src/commands/pulse.test.ts`. (TR-004)
- [ ] CHK-013: Unit test `gwrk measure pulse scan` command in `src/commands/pulse.test.ts`. (TR-005)
- [ ] CHK-014: Unit test error cases in `src/commands/pulse.test.ts`. (TR-006)
- [ ] CHK-015: Integration test with real git repo in `src/engine/pulse.test.ts`. (TR-007)
- [ ] CHK-016: Unit test spec progress scanning in `src/engine/pulse.test.ts`. (TR-008)

## Technical Constraints

- [ ] CHK-017: Ensure deterministic output for identical git history. (TC-001)
- [ ] CHK-018: Verify zero network calls at runtime (air-gapped). (TC-002)
- [ ] CHK-019: Zod validation for `pulse.repos` with fail-fast. (TC-003)

## Notes
- Check items off as completed: `[x]`
- Items are numbered sequentially (CHK-NNN) for cross-reference
- Link findings to relevant FR-###, US-###, or TR-### identifiers
