# Architecture-aware policy selection

Carry project design through profiles and select compatible standards explicitly.

Blocked: prerequisite features below. This is a proposed specification.

## Finding coverage

- Policy routing (F08)

## Dependencies

- Unified routing and prompt delivery

## Required changes

- Add optional design metadata to typed project profiles. Preserve it during workspace resolution.
- Add architecture and principle selectors to enforcement manifests. Define precedence for project overrides.
- Add a JavaScript baseline matching the existing toolchain support.
- Scope remaining gwrk-only conventions. Assess external framework packs against the shared architecture contract.

## Acceptance criteria

1. Polyglot fixtures preserve project design and workspace toolchain overrides.
2. Matching architecture and language fragments load for the selected target.
3. Unrelated standards remain excluded. Missing framework bindings remain explicit.
4. Initialization still performs zero model calls.

## Validation

Observe relevant failing tests before implementation. Preserve existing behavior during structural moves. Run the affected behavior and boundary checks after each step.

See [reviewed findings](../../report.md) for source evidence and review corrections.
