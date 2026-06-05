# Requirements Checklist: 019 agy-agent-migration

**Purpose**: Verify all specs and functional requirements are met
**Created**: 2026-06-01
**Feature**: [spec.md](../spec.md)

## Implementation Checks

- [ ] CHK-001: Implement `AgyAdapter` backend without the `--model` flag (FR-001, FR-004)
- [ ] CHK-002: Implement mapping for YOLO mode to `--dangerously-skip-permissions` (FR-004)
- [ ] CHK-003: Verify `AgyAdapter.syncGovernance` targets `AGENTS.md` (FR-003)
- [ ] CHK-004: Update router defaults to prefer `agy` (FR-002)

## Testing Checks

- [ ] CHK-005: Verify `adapter.test.ts` covers flag differences (TR-001)
- [ ] CHK-006: Verify `router.test.ts` covers fallback priority (TR-002)
