# Requirements Checklist: 004 WUD Loop

**Purpose**: Verify all spec requirements are complete and internally consistent before proceeding to `/plan`.
**Created**: 2026-02-27
**Revised**: 2026-03-15 (TDD Readiness Remediation)
**Feature**: [spec.md](../spec.md)

## User Stories

- [ ] CHK-001: US-001 (Single Phase Implementation) has executable assertions — FR-001,002,003,004,006,011,012,015,016,017
- [ ] CHK-002: US-002 (Hard Gate Pre-flight) has executable assertions — FR-003
- [ ] CHK-003: US-003 (Autonomous WUD Lifecycle) has executable assertions — FR-001, FR-013, FR-014
- [ ] CHK-004: US-004 (Circuit Breaker) has executable assertions — FR-007, FR-018
- [ ] CHK-005: US-005 (Crash Recovery) has executable assertions — FR-008
- [ ] CHK-006: US-006 (PR Creation) has executable assertions — FR-006
- [ ] CHK-007: US-007 (Branch/Manifest) has executable assertions — FR-012, FR-017
- [ ] CHK-008: US-008 (Agent Dispatch Config) has executable assertions — FR-009
- [ ] CHK-009: US-009 (Phase Skip) has executable assertions — FR-014
- [ ] CHK-010: US-010 (Staging Validation) has executable assertions — FR-016
- [ ] CHK-011: US-011 (Rip-Cord Bail) has executable assertions — FR-018

## Functional Requirements

- [ ] CHK-012: FR-001 (`gwrk ship`) maps to US-001/003, tested by TR-005/007
- [ ] CHK-013: FR-002 (branch management) maps to US-001, tested by TR-002
- [ ] CHK-014: FR-003 (pre-flight gate) maps to US-001/002, tested by TR-005/007
- [ ] CHK-015: FR-004 (`gwrk ship done`) maps to US-001, tested by TR-001/007
- [ ] CHK-016: FR-005 (review dispatch) maps to US-001, tested by TR-001/003
- [ ] CHK-017: FR-006 (PR + CI) maps to US-001/006, tested by TR-001/004
- [ ] CHK-018: FR-007 (circuit breaker) maps to US-004, tested by TR-001/007
- [ ] CHK-019: FR-008 (crash recovery) maps to US-005, tested by TR-001/007
- [ ] CHK-020: FR-009 (agent dispatch config) maps to US-008, tested by TR-005
- [ ] CHK-021: FR-010 (run logging) maps to US-001, tested by TR-001
- [ ] CHK-022: FR-011 (SQLite recording) maps to US-001, tested by TR-005
- [ ] CHK-023: FR-012 (`gwrk db record`) maps to US-001/007, tested by TR-005/007
- [ ] CHK-024: FR-013 (all-phases seq) maps to US-003, tested by TR-005
- [ ] CHK-025: FR-014 (phase skip) maps to US-009, tested by TR-005
- [ ] CHK-026: FR-015 (Agent-Native output) maps to US-001, tested by TR-005
- [ ] CHK-027: FR-016 (staging validator) maps to US-010, tested by TR-008
- [ ] CHK-028: FR-017 (3-tier logging) maps to US-001/007, tested by TR-007
- [ ] CHK-029: FR-018 (bail context) maps to US-004/011, tested by TR-001

## Testing Requirements

- [ ] CHK-030: TR-001 through TR-008 all name a specific target file and assert specific behavior
- [ ] CHK-031: Every FR maps to at least one TR in the coverage matrix
- [ ] CHK-032: Error states defined for ALL FR-### requirements that have failure modes

## Technical Constraints

- [ ] CHK-033: TC-001 (Air-Gapped) enforced — no external network calls at runtime
- [ ] CHK-034: TC-002 (Fail-Fast) enforced — Zod config validation
- [ ] CHK-035: TC-003 through TC-008 are feature-specific constraints (gate integrity, branch isolation, crash safety, shell product rule, staging scope)

## Notes
- Check items off as completed: `[x]`
- Items are numbered sequentially (CHK-NNN) for cross-reference
- Link findings to relevant FR-###, US-###, or TR-### identifiers
