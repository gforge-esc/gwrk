# Unified routing and prompt delivery

Consolidate routing policy and prove complete prompt delivery through the shared runtime.

Blocked for integration until domain boundary and port separation reviews pass.

## Finding coverage

- Routing policy (F04)
- Prompt transport (F05)

## Dependencies

- Domain purity and boundary gates
- Port and adapter separation

## Required changes

- Consolidate selection policy behind the existing agent port. Migrate callers before removing compatibility exports.
- Route workflow operations through WorkflowRuntime. Preserve the distinction between skill execution and workflow dispatch until their contracts agree.
- Populate the workflow payload before enforcement resolution. Include project context and task instructions in the captured transport.
- Retain the new Antigravity envelope parser and recorded-response recovery. Prove equivalent output handling across supported adapters.

## Acceptance criteria

1. Captured planning and implementation dispatches contain expanded enforcement rules and complete task instructions.
2. The recorded Antigravity response produces validated findings without another agent call.
3. Failed terminal status cannot produce a successful report.
4. Routing tests cover fallback behavior and configured model selection through the unified policy.

## Validation

Observe relevant failing tests before implementation. Preserve existing behavior during structural moves. Run the affected behavior and boundary checks after each step.

See [reviewed findings](../../docs/architecture/assessments/2026-11-11-self-assessment/report.md) for source evidence and review corrections.
