# Phase 1 coverage

Phase 1 adds 66 RED cases across three unit test files. Blocked: the sandbox prevents committing through the parent repository Git index. The feature owner must also resolve the recovery contract gaps below.

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | Dispatch identity, stable receipts and crash decisions | unit | src/domain/durable-dispatch.test.ts | ✅ | |
| FR-002 | Harvest identity and repository, trunk, branch and merge verification | unit | src/domain/durable-harvest.test.ts | ✅ | |
| FR-003 | Lease fencing, independent stages and unresolved outcomes | unit | src/domain/durable-dispatch.test.ts; src/domain/durable-harvest.test.ts | ✅ | |
| FR-005 | Closed attempts and expected-tip cleanup | unit | src/domain/durable-harvest.test.ts | ✅ | |
| FR-006 | Pure policy, status schemas and inward port dependencies | unit | src/domain/durable-dispatch.test.ts; src/domain/durable-harvest.test.ts; src/architecture.test.ts | ✅ | |
| TR-001 | Pre-launch replay decision and pull request recovery | unit | src/domain/durable-dispatch.test.ts | ✅ | |
| TR-002 | Transport-independent identity and repository isolation | unit | src/domain/durable-harvest.test.ts | ✅ | |
| TR-003 | Lease epoch and expiry boundaries plus stage status derivation | unit | src/domain/durable-dispatch.test.ts; src/domain/durable-harvest.test.ts | ✅ | |
| TR-004 | Distinct closed and gate-failed states plus moved-tip protection | unit | src/domain/durable-harvest.test.ts | ✅ | |
| TR-005 | Phase 1 architecture checks and status schemas | unit | src/architecture.test.ts; src/domain/durable-dispatch.test.ts; src/domain/durable-harvest.test.ts | ✅ | |

## Scope

Functional requirements have Phase 1 coverage for 5 of 5 assigned requirements. Test requirements have Phase 1 coverage for 5 of 5 assigned requirements. The spec defines no user-story identifiers or error-state table. Tests use its test requirement scenarios and the contract error codes.

These rows record Phase 1 coverage only. Durable persistence and effects remain assigned to later phases in `plan.md`. The unattended restart proof in test requirement TR-005 belongs to Phase 6. Phase 1 uses that identifier for architecture checks as directed by its test strategy. Notification routing in functional requirement FR-004 starts in Phase 2.

No HTTP routes or UI components belong to Phase 1. Integration and end-to-end test counts are zero.

## Contract gaps

- Worker recovery evidence has no live, stopped or unknown worker state. `StaleLeaseDecision` has no pending result. The coordinator requires confirmed termination before requeue. Tests cover pre-launch crashes and verified pull requests. They cannot express the live-worker safeguard without a contract change.
- Harvest policy accepts one candidate without prior operation state. It can prove equal work keys across arrival orders. It cannot prove that a stale close preserves an earlier verified merge. The store and coordinator must test that rule in later phases.
- Project identity types from feature 048 are absent. RED stubs inline the documented upstream shapes. Implementation must replace those copies with canonical domain imports after feature 048 lands.
- `docs/architecture.md` is absent. Test conventions come from `docs/grounding/architecture.md` and existing tests. The named `compile-gate` skill was not found. The build and explicit TypeScript check ran directly.

## Verification

`pnpm build` passes. An explicit TypeScript check including both new test files and `src/architecture.test.ts` passes. The normal build excludes test files.

The scoped Vitest run reports 66 new failures and 17 existing passes. Dispatch contributes 28 RED cases. Harvest contributes 36 RED cases. Architecture contributes two RED cases. No new test passes before implementation.

Policy stubs throw `Not implemented`. Schema stubs reject every value. Architecture checks fail on missing domain barrel exports and the absent operations port. The implementation phase must supply these contracts and satisfy the policy assertions.

The commit attempt failed because the sandbox denied creation of the parent repository worktree index lock. No commit exists for these changes.
