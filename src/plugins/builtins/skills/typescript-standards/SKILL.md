# TypeScript Standards

## Language Configuration
- Strict typing is mandatory.
- Use of `any` is strictly prohibited unless absolutely necessary for low-level interop (and must be justified).
- No `.js` or `.jsx` files in the `src/` directory.
- Use ESM (ECMAScript Modules) conventions.
- Target is ES2022.

## Toolchain
- Linting compliance with Biome is required.
- Run `pnpm build` to verify types before finishing.
