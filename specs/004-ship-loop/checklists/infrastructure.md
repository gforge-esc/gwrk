# Infrastructure Checklist: 004 WUD Loop

**Purpose**: Verify the foundational infrastructure for the Work-Until-Done loop, including the state machine, crash recovery, branching logic, and external CLI integrations (gh, git).
**Created**: 2026-03-05
**Feature**: [spec.md](../spec.md)

## Testing (CRITICAL)

- [ ] CHK-001 — Are unit test requirements (TR-001 to TR-010) specified with measurable success criteria? [Completeness] (spec.md § 7 Testing Requirements)
- [ ] CHK-002 — Is E2E verification (VR-001 to VR-005) explicitly required for the full WUD lifecycle? [Testability] (spec.md § 9 Verification Requirements)
- [ ] CHK-003 — Are mock requirements for `gh` CLI, `git`, and agent backends defined for unit tests? [Coverage] (spec.md § 7 Testing Requirements)

## State Management (CRITICAL)

- [ ] CHK-004 — Is the `WudState` interface (DM-001) comprehensive enough to enable crash recovery from any stage? [Completeness] (spec.md § 5 DM-001)
- [ ] CHK-005 — Is state flushing required before every stage transition to ensure crash safety (TC-007)? [Testability] (spec.md § 6 TC-007)
- [ ] CHK-006 — Is the requirement to delete the state file on successful `DONE` completion specified? [Consistency] (spec.md § 4 FR-008)
- [ ] CHK-007 — Are task state updates and history recording (DM-003) specified as part of the `implement` command? [Consistency] (spec.md § 5 DM-003)

## Config Hygiene

- [ ] CHK-008 — Are the `MAX_ITERATIONS` circuit breaker default and configurability defined? [Completeness] (spec.md § 4 FR-007)
- [ ] CHK-009 — Is fail-fast validation for `.gwrkrc.json` (no defaults) specified via Zod (TC-003)? [Consistency] (spec.md § 6 TC-003)
- [ ] CHK-010 — Are agent backend configurations for `implement` and `review` externalized in `.gwrkrc.json`? [Consistency] (spec.md § 4 FR-009)

## Error Handling

- [ ] CHK-011 — Are error states for `gh` CLI absence and PR creation failure specified with exit codes? [Coverage] (spec.md § 4 FR-006 Error States)
- [ ] CHK-012 — Is the "Corrupt state file" auto-healing recovery path well-defined? [Completeness] (spec.md § 4 FR-008 Error States)
- [ ] CHK-013 — Are the pre-flight gate failure (US-002) and already-passing skip (FR-003) behaviors specified? [Clarity] (spec.md § 4 FR-003)

## Observability

- [ ] CHK-014 — Are the timestamped log file format and naming convention (DM-002) well-defined? [Clarity] (spec.md § 5 DM-002)
- [ ] CHK-015 — Does the log requirement include recording agent outputs and timing information? [Coverage] (spec.md § 4 FR-010)
- [ ] CHK-016 — Is the stderr escalation for circuit breaker triggering (US-004) specified? [Testability] (spec.md § 2 US-004)

## Git & Branching

- [ ] CHK-017 — Is the `feat/<feature>` branch isolation from `develop` (TC-006) strictly enforced? [Consistency] (spec.md § 6 TC-006)
- [ ] CHK-018 — Is the rebase/merge strategy for updating from `develop` (FR-002) specified? [Completeness] (spec.md § 4 FR-002)
- [ ] CHK-019 — Is the "Commit-per-Task" invariant (TC-005) specified with a clear commit message format? [Consistency] (spec.md § 6 TC-005)

## External Dependencies & Registration

- [ ] CHK-020 — Are `implement` and `wud` commands registered in `src/cli.ts`? [Completeness] (src/cli.ts)
- [ ] CHK-021 — Does `gwrk wud` correctly record runs in the SQLite execution ledger (startRun/finishRun)? [Observability] (src/commands/wud.ts)
- [ ] CHK-022 — Are `gh` (GitHub CLI) and `jq` present as required by the WUD shell scripts? [Coverage] (scripts/dev/work-until-done.sh)
- [ ] CHK-023 — Are the helper scripts `wud-branch.sh`, `wud-verdict.sh`, and `wud-ci-wait.sh` present and executable? [Coverage] (scripts/dev/)

## Notes
- Check items off as completed: `[x]`
- Items are numbered sequentially (CHK-NNN) for cross-reference
- Link findings to relevant FR-###, US-###, or TR-### identifiers
