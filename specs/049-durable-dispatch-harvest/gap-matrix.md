# Phase 1 coverage

Phase 1 covers durable operation policy and lease fencing. Blocked: implementation depends on feature 048, Slack project identity.

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

## Integration dependencies

- Harvest policy accepts one candidate without prior operation state. It can prove equal work keys across arrival orders. It cannot prove that a stale close preserves an earlier verified merge. The store and coordinator must test that rule in later phases.
- Project identity types from feature 048 are absent. RED stubs inline the documented upstream shapes. Implementation must replace those copies with canonical domain imports after feature 048 lands.

## Verification

`pnpm build` passes. An explicit TypeScript check including both new test files and `src/architecture.test.ts` passes. The normal build excludes test files.

The scoped Vitest run reports 68 new failures and 17 existing passes. Dispatch contributes 30 RED cases. Harvest contributes 36 RED cases. Architecture contributes two RED cases. No new test passes before implementation.

Policy stubs throw `Not implemented`. Schema stubs reject every value. Architecture checks fail on missing domain barrel exports and the absent operations port. The implementation phase must supply these contracts and satisfy the policy assertions.
