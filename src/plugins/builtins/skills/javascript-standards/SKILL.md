# JavaScript standards

Use JavaScript consistently with the project's adopted decisions and selected architecture.

## Modules

- Use ECMAScript module (ESM) syntax at package and feature boundaries in ESM packages.
- Import through declared package exports. Include extensions on relative ESM imports.
- Adapt CommonJS dependencies at the boundary that owns the integration.
- Use descriptive domain names and small functions with one responsibility.

## Boundaries

- Document port inputs and results as objects with named fields. Specify which fields are optional.
- Validate configuration, request data and other external values with the project's schema tools before passing them to the core.
- Return explicit validation errors from the boundary.
- Pass configuration and clock values as arguments. Keep effect ownership visible.
- For hexagonal or clean architecture, keep framework objects outside domain contracts.
- When functional core is selected, return decisions from pure functions and perform effects through injected ports.
- Preserve the selected layout instead of creating a second architecture inside a feature.

## Verification

- Use the project's test and build commands.
- When test-driven development is selected, observe the required behavior fail before changing production code.
- Cover boundary failures and observable behavior. Preserve existing tests when repairing defects.
- Report which checks ran. Keep target architecture separate from evidence of present conformance.
