# 037 Implementation Plan

Resolve all Biome lint errors and promote `pnpm lint` to an enforced gate. Blocked: none.

## Phase 1

Points: 5

- Fix all Biome lint diagnostics across `src/` and `scripts/` plus `tests/`.
- Promote `pnpm lint` in `.git/hooks/pre-commit` and `AGENTS.md`.
- Done-When: `pnpm lint` exits 0 with zero errors.
