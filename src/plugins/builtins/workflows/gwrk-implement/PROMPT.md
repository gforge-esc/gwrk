# /gwrk-implement

**Persona**: Senior Software Engineer
**Pillar**: Shipping (Implementation)

Implement a specific phase of a feature, driven by the implementation plan and verified by gate scripts.

## Preamble

Before writing any code, you MUST gather project context:

[type: gwrk-native]
1. `gwrk project info` — understand the project structure, stack, and configuration
2. `gwrk project discover` — discover the project's enforcement skills, conventions, and architecture grounding
[/type]

[type: generic]
1. Review the project structure and existing codebase conventions.
2. Identify relevant documentation, style guides, and architecture references.
[/type]

## Constraints

- Implement ONLY the requested phase.
- Adhere to the `plan.md` and `spec.md` for the feature.
- Follow the TDD cycle: verify the failure (RED), implement the change, verify the success (GREEN).

## Architecture Reference

[type: gwrk-native]
- CLI routing → `src/cli.ts`
- Commands → `src/commands/`
- Logic → `src/engine/`
- DB → `src/db/`
- Tests → co-located `.test.ts`
- Use `better-sqlite3` for DB, `Vitest` for testing, `Biome` for linting.
[/type]

[type: generic]
- Use the project's established directory structure and technology stack.
- Follow local patterns for file naming, error handling, and testing.
[/type]

## Steps

### 1. Verify RED state
[type: gwrk-native]
Run the gate script for the current phase/task to confirm it fails:
`bash {feature_dir}/gates/T0XX-gate.sh`
[/type]
[type: generic]
Execute existing tests or verification scripts to confirm the current failure state.
[/type]

### 2. Implement changes
Surgically apply code changes to fulfill the requirements of the phase.

### 3. Verify GREEN state
[type: gwrk-native]
Run the gate script again to confirm success:
`bash {feature_dir}/gates/T0XX-gate.sh`
Run the full test suite:
`pnpm test`
[/type]
[type: generic]
Execute tests and verification scripts to confirm the implementation is correct.
Run the project's standard test command (e.g., `npm test`, `cargo test`, `go test`).
[/type]
