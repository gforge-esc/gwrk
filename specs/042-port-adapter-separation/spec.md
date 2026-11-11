# Port and adapter separation

Keep port contracts separate from concrete construction. Inject infrastructure dependencies at composition.

Blocked for implementation until the domain boundary change passes review.

## Finding coverage

- Physical layering (F03)
- Infrastructure state (F06)

## Dependencies

- Domain purity and boundary gates

## Required changes

- Move `createToolchainAdapter` into the toolchain adapter package.
- Replace adapter re-exports with explicit implementations where they expose legacy infrastructure.
- Pass database handles and configuration into store adapters. Preserve connection state inside adapter instances.
- Replace global stdout mutation with scoped output handling. Preserve existing command output contracts.

## Acceptance criteria

1. Ports import only permitted domain types and port contracts.
2. Open two stores with separate paths in one process. Verify that their writes remain isolated.
3. Run agent-mode and normal commands in one process. Verify that stdout behavior does not persist between commands.
4. Run existing CLI and persistence contract tests after each move.

## Validation

Observe relevant failing tests before implementation. Preserve existing behavior during structural moves. Run the affected behavior and boundary checks after each step.

See [reviewed findings](../../docs/architecture/assessments/2026-11-11-self-assessment/report.md) for source evidence and review corrections.
