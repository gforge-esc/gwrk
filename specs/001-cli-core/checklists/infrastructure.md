# Infrastructure Checklist: 001 CLI Core

**Purpose**: Verify the foundational infrastructure for the gwrk CLI core, including command routing, SQLite ledger, configuration validation, and task state management.
**Created**: 2026-03-05
**Feature**: [spec.md](../spec.md)

## Testing (CRITICAL)

- [ ] CHK-001 — Are unit test requirements (TR-001 to TR-019) specified for every functional requirement (FR-###)? [Coverage] (spec.md § 6 Testing Requirements)
- [ ] CHK-002 — Is E2E surface verification (VR-004) explicitly required to match the settled command hierarchy? [Testability] (spec.md § 8 Verification Requirements)
- [ ] CHK-003 — Are negative test cases (VR-002, VR-003) specified for gate failure and configuration crashes? [Coverage] (spec.md § 8 Verification Requirements)
- [ ] CHK-004 — Is the agent dispatch mock requirement (TR-002, TR-012) defined for isolation from network calls? [Testability] (spec.md § 6 Testing Requirements)
- [ ] CHK-005 — Is the compiled binary E2E test (TR-019) mandated to verify production-ready behavior? [Completeness] (spec.md § 6 Testing Requirements)

## Config Hygiene (CRITICAL)

- [ ] CHK-006 — Is the Zod-validated configuration schema (DM-003) specified without `.default()` calls to ensure fail-fast behavior? [Consistency] (spec.md § 4 DM-003)
- [ ] CHK-007 — Is the error message for missing `.gwrkrc.json` (FR-008) explicitly defined for UX consistency? [Clarity] (spec.md § 3 Error States)
- [ ] CHK-008 — Are all agent backends (define, implement) required to be externalized in the config? [Completeness] (spec.md § 4 DM-003)
- [ ] CHK-009 — Is the "no network calls" constraint (TC-002) enforceable through configuration hygiene? [Consistency] (spec.md § 5 Technical Constraints)

## Data & State Integrity (CRITICAL)

- [ ] CHK-010 — Is the atomic read/write requirement (TR-007) for `tasks.json` specified to prevent corruption during transitions? [Consistency] (spec.md § 6 Testing Requirements)
- [ ] CHK-011 — Is the branch-scoped state requirement (TC-007) defined for task isolation? [Clarity] (spec.md § 5 Technical Constraints)
- [ ] CHK-012 — Are the SQLite schema requirements (DM-004) for `projects`, `runs`, and `history` tables specified for the analytical ledger? [Completeness] (spec.md § 4 DM-004)
- [ ] CHK-013 — Is the append-only nature of `history.jsonl` (DM-002) required for every state transition? [Consistency] (spec.md § 4 DM-002)

## Observability

- [ ] CHK-014 — Is the streaming output requirement (TC-008) using `stdio: 'inherit'` specified for real-time agent monitoring? [Testability] (spec.md § 5 Technical Constraints)
- [ ] CHK-015 — Are SQLite run recording requirements (FR-011, FR-012, FR-013) specified for tracking duration and exit codes? [Coverage] (spec.md § 3 Functional Requirements)
- [ ] CHK-016 — Is the aggregate statistics requirement (FR-015) specified with measurable success rate criteria? [Completeness] (spec.md § 3 Functional Requirements)
- [ ] CHK-017 — Does the Pulse dashboard (FR-017) require git log scanning without external infrastructure? [Clarity] (spec.md § 3 Functional Requirements)

## Error Handling

- [ ] CHK-018 — Are specific exit codes and stderr messages (FR-003, FR-006, FR-008) defined for all critical failure states? [Clarity] (spec.md § 3 Error States)
- [ ] CHK-019 — Is the "Hard Gate" enforcement (TC-004) required to block state mutation on gate failure? [Consistency] (spec.md § 5 Technical Constraints)
- [ ] CHK-020 — Is the idempotent behavior of `gwrk init` (FR-001) specified with a success exit code? [Clarity] (spec.md § 3 Error States)

## Notes
- Check items off as completed: `[x]`
- Items are numbered sequentially (CHK-NNN) for cross-reference
- Link findings to relevant FR-###, US-###, or TR-### identifiers
