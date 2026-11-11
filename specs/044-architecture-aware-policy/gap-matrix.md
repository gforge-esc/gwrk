# Phase 1 coverage

All 24 new cases fail before implementation. The build passes. Blocked: the runner denies Git index writes outside this worktree. The repository owner must commit the files from a writable Git session.

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

The new policy module contains signatures and throwing stubs only. The workspace resolver test calls the contracted two-argument interface. The current three-argument implementation fails that test.

The repository has no docs/architecture.md. Test conventions come from docs/grounding/architecture.md and existing co-located suites. The plan cites a missing ADR-010-polyglot-monorepo-workspaces.md. The existing ADR-010-decision-records.md retains authority. The compile-gate skill was not found. Direct pnpm build verification passed.

Implementation depends on feature 043: Unified Routing and Prompt Delivery. The plan records this dependency.
