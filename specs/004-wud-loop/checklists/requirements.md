# Requirements Checklist: 004 WUD Loop

**Purpose**: Verify all spec requirements are complete and internally consistent before proceeding to `/plan`.
**Created**: 2026-02-27
**Revised**: 2026-03-06
**Feature**: [spec.md](../spec.md)

## User Stories

- [ ] CHK-001: US-001 (Single Phase Implementation) has executable assertions — FR-001, FR-002, FR-003, FR-011
- [ ] CHK-002: US-002 (Hard Gate Pre-flight) has executable assertions — FR-003
- [ ] CHK-003: US-003 (Autonomous WUD Lifecycle) has executable assertions — FR-004, FR-005, FR-006, FR-007, FR-011
- [ ] CHK-004: US-004 (Circuit Breaker) has executable assertions — FR-007
- [ ] CHK-005: US-005 (Crash Recovery) has executable assertions — FR-008
- [ ] CHK-006: US-006 (PR Creation) has executable assertions — FR-006
- [ ] CHK-007: US-007 (Branch Management) has executable assertions — FR-002
- [ ] CHK-008: US-008 (Agent Dispatch Configuration) has executable assertions — FR-009
- [ ] CHK-009: US-009 (WUD Run Logging) has executable assertions — FR-010

## Functional Requirements

- [ ] CHK-010: FR-001 (`gwrk ship`) maps to US-001, tested by TR-001
- [ ] CHK-011: FR-002 (branch management) maps to US-001/US-007, tested by TR-002
- [ ] CHK-012: FR-003 (pre-flight gate) maps to US-001/US-002, tested by TR-001
- [ ] CHK-013: FR-004 (`gwrk ship done`) maps to US-003, tested by TR-003
- [ ] CHK-014: FR-005 (review dispatch) maps to US-003, tested by TR-004
- [ ] CHK-015: FR-006 (PR + CI) maps to US-003/US-006, tested by TR-003
- [ ] CHK-016: FR-007 (circuit breaker) maps to US-004, tested by TR-003
- [ ] CHK-017: FR-008 (crash recovery) maps to US-005, tested by TR-003
- [ ] CHK-018: FR-009 (agent dispatch config) maps to US-008, tested by TR-006
- [ ] CHK-019: FR-010 (run logging) maps to US-009, tested by TR-003
- [ ] CHK-020: FR-011 (SQLite recording) maps to US-001/US-003, tested by TR-005/TR-006
- [ ] CHK-021: FR-012 (`gwrk db record`) maps to FR-011, tested by TR-005

## Testing Requirements

- [ ] CHK-022: TR-001 through TR-006 all name a specific target file and assert specific behavior
- [ ] CHK-023: Every FR maps to at least one TR in the coverage matrix
- [ ] CHK-024: Error states defined for ALL FR-### requirements (FR-001 to FR-012)

## Technical Constraints

- [ ] CHK-025: TC-001 (Determinism) applied to state machine transitions
- [ ] CHK-026: TC-002 (Air-Gapped) enforced — no direct network calls from engine
- [ ] CHK-027: TC-003 (Fail-Fast) enforced — Zod config validation
- [ ] CHK-028: TC-004 through TC-007 are feature-specific constraints

## Notes
- Check items off as completed: `[x]`
- Items are numbered sequentially (CHK-NNN) for cross-reference
- Link findings to relevant FR-###, US-###, or TR-### identifiers
