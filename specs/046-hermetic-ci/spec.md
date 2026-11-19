# Hermetic integration checks and blocking lint

Remove integration quarantine causes before enabling the full delivery checks.

Blocked: prerequisite features below. This is a proposed specification.

## Finding coverage

- Delivery evidence (F11)

## Dependencies

- Port and adapter separation
- Unified routing and prompt delivery

## Required changes

- Audit each quarantine pattern and identify the test files it still matches.
- Give affected tests isolated ports and temporary stores. Inject shared services where required.
- Remove unhandled-error suppression after reproducing and fixing the worker failures.
- Remove the unused database stub or implement its contract with tests.
- Make lint failures block continuous integration.

## Acceptance criteria

1. All formerly quarantined test files run without shared persistence or fixed-port conflicts.
2. Unhandled worker failures cause a failed test run.
3. The database stub has no unresolved callable path.
4. A lint defect causes the continuous integration job to fail.

## Validation

Observe relevant failing tests before implementation. Preserve existing behavior during structural moves. Run the affected behavior and boundary checks after each step.

See [reviewed findings](../../docs/architecture/assessments/2026-11-11-self-assessment/report.md) for source evidence and review corrections.
