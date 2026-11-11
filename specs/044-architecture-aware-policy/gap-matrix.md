# Phase 1 coverage

All 24 new cases fail before implementation. The build passes. Blocked: implementation depends on feature 043, unified routing and prompt delivery.

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | Preserve design across profile and workspace overrides | unit and integration | src/domain/profile-policy.test.ts; src/engine/profile-detector.test.ts; src/engine/prompt-conditioner.test.ts | ✅ | |
| TR-001 | Preserve shared design with per-workspace stack and toolchain | integration | src/engine/profile-detector.test.ts | ✅ | |
| TR-005 | Pure merging with unchanged fallback when design is absent | unit | src/domain/profile-policy.test.ts | ✅ | |
| TR-006 | Render design only for configured profiles | unit | src/engine/prompt-conditioner.test.ts | ✅ | |

The spec defines no US identifiers or error-state table. Cases use the FR and TR identifiers from the spec and plan. Phases 2 through 4 remain outside this matrix.

## Verification

- Unit tests cover 13 new cases across two files.
- Integration tests cover 11 new cases in one file.
- No API routes or UI flows belong to this phase.
- All 62 existing cases pass across the phase test command, including config and architecture checks.
- Missing design and missing root config preserve legacy profiles.
- Invalid workspace design fails config validation.
- Workspace path boundaries prevent sibling overrides.
- Frozen inputs check deterministic merging without mutation.
