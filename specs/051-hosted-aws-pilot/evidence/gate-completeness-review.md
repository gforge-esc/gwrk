# Pilot gate review

The original future gates need completeness guards. The candidate array-based scripts pass the delegated completeness regression. This result covers gate execution only. It does not clear the future live verifier.

## Blocking finding

```text
REVIEW FAIL (gate): Missing named Vitest targets can be omitted from combined verification.
  WHERE: specs/051-hosted-aws-pilot/gates/phase-08.sh:23
  EXPECTED: Every named behavioral test must exist before any build or test command starts.
  ACTUAL: The original Phase 8 script names 23 Vitest files but guards only three of them. Its fourth guard covers a separate Node harness. Twenty earlier-phase test files can disappear without a guard denial. Related gaps affect Phases 2 through 7.
  FIX: Use explicit required and Vitest arrays. Include every approved Vitest target and Node test harness in the required set. Guard that set before child commands run.
  GATE: tests/hosted-pilot/gate-completeness.test.mjs
```

The original scripts reproduce 34 failed and 30 passed cases. The candidate scripts pass all 64 cases. The regression derives 56 Vitest targets from the approved plan's acceptance commands. It removes each target from an otherwise complete fixture and runs actual Bash. Missing targets must produce a numeric nonzero exit and zero child commands. Seven complete-fixture cases check the full approved command sequence.

## Nonblocking notes

Phase 1 explicitly guards both selected tests. Its executable wrappers delegate with `exec`. Shell failure propagation remains enabled. The two ADR commands validate the index and corpus. The combined reindex-and-check command checks freshness without rewriting the index. Static review found no Phase 1 gate blocker. The coordinator retains actual Phase 1 RED evidence separately.

Phase 9 denies absent operator authority before child execution. The regression creates its helper file before testing this denial. This verifies the authority guard rather than a missing-file failure. The future live verifier does not exist in the reviewed snapshot. Its real HTTPS probes and refusal of synthetic acceptance remain unverified until implementation and independent review.

The environment flag expresses an operator opt-in. It does not itself prove operator identity or live acceptance. Neither a fixture-only pass nor a prepared record can replace the planned live probes.

## Scope

Only `tests/hosted-pilot/gate-completeness.test.mjs` changed in the owned readiness checkout. Plan and gate snapshots remain private. No production modules or coordinator gate files changed. No cloud, browser or live acceptance command ran. The Node and pnpm commands inside fixtures are interception stubs. No heavy application suite ran.
