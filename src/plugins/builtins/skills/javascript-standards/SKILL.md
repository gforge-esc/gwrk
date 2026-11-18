# JavaScript standards

Use JavaScript consistently with the project's adopted decisions and selected architecture.

## Modules

- Keep the module format consistent with package settings and neighboring code.
- Import through declared module entry points. Keep dependencies explicit.
- Use descriptive domain names and small functions with one responsibility.

## Boundaries

- Document port contracts as explicit object shapes and observable return values.
- Validate external values at adapter boundaries with the project's schema tools.
- Pass configuration and clock values as arguments. Keep effect ownership visible.
- For hexagonal or clean architecture, keep framework objects outside domain contracts.
- When functional core is selected, return decisions from pure functions and perform effects through injected ports.
- Preserve the selected layout instead of creating a second architecture inside a feature.

## Verification

- Use the project's test and build commands.
- When test-driven development is selected, observe the required behavior fail before changing production code.
- Cover boundary failures and observable behavior. Preserve existing tests when repairing defects.
- Report which checks ran. Keep target architecture separate from evidence of present conformance.
