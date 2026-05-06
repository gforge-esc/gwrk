# Infrastructure Checklist: 002 Build Server

**Purpose**: Verify the foundational infrastructure for the gwrk Build Server, including daemon management, Docker sandbox environment, Git lifecycle, and dispatch orchestration.
**Created**: 2026-03-05
**Feature**: [spec.md](../spec.md)

## Testing (CRITICAL)

- [ ] CHK-001 — Are unit test requirements (TR-001 to TR-009) specified with measurable success criteria? [Completeness] (spec.md § 7 Testing Requirements)
- [ ] CHK-002 — Is E2E verification (VR-001 to VR-005) explicitly mandated for the full dispatch lifecycle? [Testability] (spec.md § 9 Verification Requirements)
- [ ] CHK-003 — Are error states (FR-001, FR-003, FR-005, FR-010) covered by specific test cases? [Coverage] (spec.md § 4 Functional Requirements)
- [ ] CHK-004 — Is mock requirements for Docker (`dockerode`) and Git (`child_process`) operations defined for isolation? [Coverage] (spec.md § 7 Testing Requirements)

## Docker Verification (CRITICAL)

- [ ] CHK-005 — Are the required tools (Node.js, Git, gh) for the sandbox image explicitly listed for verification? [Completeness] (spec.md § 4 FR-012)
- [ ] CHK-006 — Is the labeling convention (`gwrk.feature`, `gwrk.phase`) required for all sandboxes to ensure lifecycle tracking? [Consistency] (spec.md § 6 TC-006)
- [ ] CHK-007 — Is the mounting strategy for the phase branch at `/workspace` clearly defined? [Clarity] (spec.md § 4 FR-006)
- [ ] CHK-008 — Is the sandbox destruction requirement on completion or failure specified to prevent resource leaks? [Completeness] (spec.md § 4 FR-006)

## Config Hygiene

- [ ] CHK-009 — Are all server parameters (port, host) and parallelism limits (maxClones, maxCpu, etc.) externalized to `.gwrkrc.json`? [Consistency] (spec.md § 5 DM-002)
- [ ] CHK-010 — Is fail-fast validation (no defaults) required for all configuration values via Zod (TC-003)? [Consistency] (spec.md § 6 TC-003)
- [ ] CHK-011 — Is the PID file location strictly defined at `.gwrk/server.pid` for CLI consistency? [Clarity] (spec.md § 4 FR-011)

## Observability

- [ ] CHK-012 — Are system resource metrics (CPU, memory, disk) required for the status response? [Completeness] (spec.md § 5 DM-003)
- [ ] CHK-013 — Is active sandbox monitoring (SandboxInfo) specified for tracking agent activity and resource usage? [Coverage] (spec.md § 5 DM-003)
- [ ] CHK-014 — Does the status command require monitoring when the daemon is stopped? [Clarity] (spec.md § 4 FR-004)
- [ ] CHK-015 — Are retry attempts required to be recorded with timestamps, backend, and error details? [Coverage] (spec.md § 4 FR-009)

## Error Handling

- [ ] CHK-016 — Are specific error messages and exit codes defined for "Port already in use" and "Docker not available"? [Clarity] (spec.md § 4 FR-001 Error States)
- [ ] CHK-017 — Is the behavior for merge conflicts during Git lifecycle management clearly specified with failure flags? [Completeness] (spec.md § 4 FR-010 Error States)
- [ ] CHK-018 — Are failure states for invalid backends or features not found specified with HTTP status codes? [Coverage] (spec.md § 4 FR-005 Error States)

## Notes
- Check items off as completed: `[x]`
- Items are numbered sequentially (CHK-NNN) for cross-reference
- Link findings to relevant FR-###, US-###, or TR-### identifiers
