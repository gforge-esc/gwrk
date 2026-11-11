# Workflow guidance and governance visibility

Align planning guidance with the selected architecture. Expose scoped assessment evidence through discovery.

Blocked: prerequisite features below. This is a proposed specification.

## Finding coverage

- Workflow guidance (F09)
- Governance visibility (F10)

## Dependencies

- Architecture-aware policy selection

## Required changes

- Update specification and planning prompts to describe the current hexagonal layers.
- Replace fixed stack mandates in the principal engineer persona with selected project standards.
- Keep every decision status visible. Add explicit guidance for conflicts between Proposed targets and Decided constraints.
- Report target selection and context health through discovery. Link the latest assessment without claiming general conformance.
- Track project policy versions. Repair or retire the separate plugin seed path that depends on an absent taxonomy.

## Acceptance criteria

1. Captured prompts use the selected layout and preserve existing decision authority.
2. Discovery reports context health separately from assessment results.
3. Two isolated machines resolve the same project policy versions.
4. Missing seed input produces an actionable failure.

## Validation

Observe relevant failing tests before implementation. Preserve existing behavior during structural moves. Run the affected behavior and boundary checks after each step.

See [reviewed findings](../../report.md) for source evidence and review corrections.
