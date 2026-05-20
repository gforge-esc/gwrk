| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| US-001 | Project Initialization | integration | src/commands/init.test.ts | ✅ | T001 |
| US-002 | Agent Specification | unit | src/commands/specify.test.ts | ✅ | T002 |
| US-003 | Agent Planning | unit | src/commands/plan.test.ts | ✅ | T003 |
| US-004 | Task Decomposition | unit | src/commands/tasks-generate.test.ts | ✅ | T004 |
| US-005 | Task State Query | unit | src/commands/tasks-query.test.ts | ✅ | T005 |
| US-006 | Hard Gate Enforcement | unit | src/commands/tasks-done.test.ts | ✅ | T006 |
| US-007 | Status Transition History | unit | src/utils/state.test.ts | ✅ | T007 |
| US-008 | Configuration Validation | unit | src/utils/config.test.ts | ✅ | T008 |
| US-010 | Effort Estimation | unit | src/commands/effort.test.ts | ✅ | T010 |
| US-011 | Define Pillar (DUS loop) | unit | src/commands/define.test.ts | ✅ | T011 |
| US-012 | Ship Pillar (Agent implementation) | unit | src/commands/implement.test.ts | ✅ | T012 |
| US-013 | Ship (Full Lifecycle) | unit | src/commands/ship.test.ts | ✅ | T013 |
| US-014 | Execution History Query | unit | src/db/db.test.ts | ✅ | T014 |
| US-015 | Aggregate Statistics | unit | src/db/db.test.ts | ✅ | T015 |
| US-016 | Compression Tracking | unit | src/commands/compression.test.ts | ✅ | T016 |
| US-017 | Pulse Dashboard | unit | src/commands/pulse.test.ts | ✅ | T017 |
| US-018 | CLI Surface Verification | unit | src/cli.test.ts | ✅ | T018 |
| US-019 | Execution Manifest generation | unit | src/utils/manifest.test.ts | ✅ | T037 |
| US-020 | Task state verification | unit | src/commands/tasks-verify.test.ts | ✅ | T038 |
| US-021 | Workstation setup wizard (4 steps) | unit | src/commands/setup.test.ts | ✅ | T041 |
| US-022 | Help text examples audit | unit | src/cli.ux.test.ts | ✅ | T044 |
| US-023 | Feature-arg consistency | unit | src/cli.consistency.test.ts | ✅ | T050 |
| US-024 | No duplicate surfaces | unit | src/cli.consistency.test.ts | ✅ | T054 |
| US-025 | CLI grammar governance | unit | tests/governance.test.ts | ✅ | T055 |
| US-026 | Quiet output parity (specify) | unit | src/commands/specify.test.ts | ✅ | T057 |
| US-026 | Quiet output parity (plan) | unit | src/commands/define-plan.test.ts | ✅ | T058 |
| US-026 | Quiet output parity (tasks) | unit | src/commands/tasks-generate.test.ts | ✅ | T059 |
| US-026 | Quiet output parity (tests) | unit | src/commands/tests-generate-contract-phase12.test.ts | ✅ | T056 |
| FR-001 | idempotent init | integration | src/commands/init.test.ts | ✅ | T001 |
| FR-019 | Manifest committed alongside code | unit | src/utils/manifest.test.ts | ✅ | T037 |
| FR-020 | gwrk tasks verify | unit | src/commands/tasks-verify.test.ts | ✅ | T038 |
| FR-021 | history.jsonl deprecation | unit | src/utils/history.test.ts | ✅ | T024 |
| FR-022 | Setup state persistence | unit | src/utils/setup-state.test.ts | ✅ | T043 |
| FR-023 | Help text Examples section | unit | src/cli.ux.test.ts | ✅ | T044 |
| FR-024 | resolveFeature suffix resolution | unit | src/cli.consistency.test.ts | ✅ | T050 |
| FR-025 | No duplicate command paths | unit | src/cli.consistency.test.ts | ✅ | T054 |
| FR-026 | docs/governance/cli-grammar.md exists | unit | tests/governance.test.ts | ✅ | T055 |
| FR-027 | define tests contract fix | unit | src/commands/tests-generate-contract.test.ts | ✅ | T051 |
| FR-028 | define subcommands pass quiet: true | unit | src/commands/cli-core-phase12.test.ts | ✅ | T060 |
| FR-029 | Tolerant JSON extraction | unit | src/plugins/workflow-runtime-phase12.test.ts | ✅ | T060 |
| TC-008 | Quiet agent output policy | unit | src/utils/agent.test.ts | ✅ | T016 |