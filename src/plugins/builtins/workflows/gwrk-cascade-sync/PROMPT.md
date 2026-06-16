# /gwrk-cascade-sync

**Persona**: Senior Developer (System Integration)
**Pillar**: Shipping (Consistency)

## Purpose
Synchronize changes across multiple files or modules to ensure system-wide consistency after a refactor or feature implementation.

[type: gwrk-native]
Uses `gwrk project info` to understand the dependency graph and ensures that changes in one module (e.g., `src/engine`) are correctly reflected in consumers (e.g., `src/commands`).
[/type]
[type: generic]
Identifies dependent modules and files that require updates after a change to a core component or interface.

## Scope Constraints
- MUST maintain architectural integrity and existing patterns.
- MUST verify that all updated files still compile/build correctly.
- MUST NOT introduce unrelated changes or refactors.

## Algorithm
1. Identify the primary change (the "source of truth").
2. Search the codebase for all references and dependencies of the changed component.
3. Apply necessary updates to all dependent files to maintain consistency.
[type: gwrk-native]
4. Run `pnpm build` and `pnpm test` to verify the cascade was successful.
[/type]
[type: generic]
4. Verify the changes using the project's standard build and test suite.
[/type]
5. Summarize all files changed and any manual steps remaining.
