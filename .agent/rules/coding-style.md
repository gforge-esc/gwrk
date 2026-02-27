# Coding Style Guide

## Architecture Reference
See `docs/architecture.md` §8 for full coding standards with enforcement rules.

## General Principles
- **Strict TypeScript**: No `any`. Use correct types.
- **Functional Components**: Use React 19 Functional Components with Hooks.
- **Tailwind CSS v4.2**: Utility-first styling for all UI components.
- **Schema Validation**: Zod for all schemas (config, API contracts, domain types).

## TypeScript Linting & Hygiene (STRICT)
- **Tool**: Biome for lint + format.
- **Resolution Over Suppression**: Fix the code, don't suppress the error.
- **Suppression Validity**: If necessary, use `// biome-ignore lint/<rule>: <Specific Architectural Reason>`.
    - ❌ BAD: `// biome-ignore lint/suspicious/noExplicitAny: fix`
    - ✅ GOOD: `// biome-ignore lint/suspicious/noExplicitAny: Legacy parser outputs unchecked JSON`
- **Audit Trails**: No "todo" or "fixme" without a tracking issue.
- **No Artifact Commits**: NEVER commit temporary files to the repository.

## Rust Linting & Hygiene (STRICT)
- **`cargo clippy`**: `--deny warnings` — zero warnings in CI.
- **`cargo fmt`**: `--check` — must be formatted.
- **`cargo test`**: All tests must pass.
- **No `unsafe`**: Without an adjacent comment justifying the block.
- **`#[must_use]`**: On all public functions returning values.

## Configuration
- **No Magic Values**: Never use hardcoded strings or numbers for config.
- **No Defaults**: No `|| 3000`. Missing env var = crash at boot.
- **Fail Fast**: `@codered/config` validates all required config at startup via Zod (no `.default()` calls).

## Monorepo
- **Packages**: Logic shared between apps goes in `packages/`.
- **Apps**: Application-specific code goes in `apps/`.
- **Crates**: Rust compute kernel in `crates/engine/`.
- **Dependencies**: Use `pnpm` workspace protocol for internal TS dependencies. Use Cargo workspace for Rust dependencies.

## Testing
- **Unit Tests (TS)**: Vitest (`pnpm test`).
- **Unit Tests (Rust)**: `cargo test` (`make test-engine`).
- **E2E**: Playwright for user-facing flows (`pnpm test:e2e`).
- **Golden-Hash**: Engine determinism verified via SHA256 fixture assertions in CI.

## Database
- **SQLite**: Local-first via `better-sqlite3`. WAL mode for crash safety.
- **No ORM**: Direct SQL queries in `packages/core/index/`.
- **Migrations**: Schema versioning managed in `packages/database/`.
- **Audit Trail**: Append-only `audit_events` table. No UPDATE, no DELETE.

## File Extensions
- **TypeScript Only**: All source files in `apps/*/src/` and `packages/*/src/` MUST be `.ts` or `.tsx`.
- **Rust Only**: All source files in `crates/*/src/` MUST be `.rs`.
- **No Transpiled JS**: NEVER create or commit `.js` or `.jsx` in `src/`.
