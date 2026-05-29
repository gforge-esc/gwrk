# TypeScript Standards (typescript-standards)

Strict adherence to these standards is required for all TypeScript code.

## Strict Typing

- NEVER use `any`. Use `unknown` + type narrowing, or define a proper type/interface.
- NEVER use `@ts-ignore` in production code.
- NEVER use non-null assertions (`!`) when `?.` or `??` would suffice.
- All exported functions MUST have explicit return types.
- All function parameters MUST have explicit types.

## Lint Compliance

- Code MUST pass Biome linting.
- Run `pnpm exec biome lint --write .` before completing tasks.
- Do NOT add lint suppression comments.

## Imports & Files

- Use `.js` extension on all relative imports (ESM).
- Use `node:` prefix for Node.js built-ins.
- Use `import type` for type-only imports.
- Source files MUST be `.ts`. NEVER use `.js` or `.jsx` in `src/`.

## Error Handling

- Use `CommandError` for CLI-facing errors.
- NEVER swallow errors silently.
- Error messages MUST be actionable.
