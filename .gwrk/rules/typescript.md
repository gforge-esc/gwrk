---
trigger: always_on
scope: implementation
---

# TypeScript Coding Standards

These rules apply to ALL code written by agents during `/implement` and `/ship`.
Violations cause review failures. No exceptions.

## Strict Typing

- **NEVER use `any`**. Use `unknown` + type narrowing, or define a proper type/interface.
- **NEVER use `@ts-ignore`** in production code. RED test files may use `@ts-ignore` with the exact comment `// @ts-ignore - Module does not exist yet (RED)` — this is the ONLY acceptable use.
- **NEVER use non-null assertions (`!`)** when optional chaining (`?.`) or nullish coalescing (`??`) would suffice.
- All exported functions MUST have explicit return types.
- All function parameters MUST have explicit types (no inferred `any`).

## Lint Compliance

- Code MUST pass `pnpm lint` (Biome) before task completion.
- Auto-fixable issues: run `pnpm exec biome lint --write .` and commit.
- Non-auto-fixable issues: fix manually. Do NOT add suppression comments.

## Error Handling

- Use `CommandError` for CLI-facing errors (provides exit code + message).
- Use `Error` for internal/unexpected errors.
- NEVER swallow errors silently. Either handle, re-throw, or log with context.
- Error messages MUST be actionable: tell the user what went wrong AND what to do about it.

## Import Conventions

- Use `.js` extension on all relative imports (ESM requirement).
- Use `node:` prefix for Node.js built-in modules (`import fs from "node:fs"`).
- Use `import type` for type-only imports.

## File Conventions

- Source files: `.ts` only. NEVER `.js` in `src/`.
- Test files: co-located as `<module>.test.ts`.
- One export per file for main modules. Utility files may have multiple exports.

## Naming

- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Types/Interfaces: `PascalCase`

## Commit Hygiene

- Each task gets exactly one commit: `feat: T0XX — <title>`
- Do NOT bundle multiple tasks in one commit.
- Do NOT leave uncommitted changes between tasks.
