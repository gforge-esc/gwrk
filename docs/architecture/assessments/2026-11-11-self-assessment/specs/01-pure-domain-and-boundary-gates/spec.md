# Domain purity and boundary gates

Remove external effects from domain policy and strengthen architectural checks.

Blocked: none. This is a proposed specification.

## Finding coverage

- Domain effects (F01)
- Boundary coverage (F02)

## Dependencies

None.

## Required changes

- Move Git discovery from `src/domain/project-id.ts` into an adapter. Keep identity calculation pure.
- Separate configuration reads from registry validation in `src/domain/agent-config.ts`. Return errors as values or typed exceptions.
- Pass manifest facts into toolchain policy. Perform filesystem discovery in an adapter.
- Extend boundary checks to cover package imports and dynamic imports. Add negative fixtures for prohibited effects.

## Acceptance criteria

1. Prove that the current domain effect imports fail the stronger boundary checks before migration.
2. Pass injected values to identity and toolchain policy. Equal inputs must produce equal results.
3. Run domain tests with different working directories. Results must remain unchanged.
4. Retain the passing context determinism regression. The temporary template mismatch requires no further repair.

## Validation

Observe relevant failing tests before implementation. Preserve existing behavior during structural moves. Run the affected behavior and boundary checks after each step.

See [reviewed findings](../../report.md) for source evidence and review corrections.
