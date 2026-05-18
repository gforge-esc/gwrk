| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| US-021 | Workstation setup wizard (4 steps) | unit | src/commands/setup.test.ts | ✅ | T061 |
| US-021 | setup.json state persistence | unit | src/utils/setup-state.test.ts | ✅ | T062 |
| FR-022 | Ship pre-flight setup check | integration | src/commands/ship-setup.test.ts | ✅ | T063 |
| FR-028 | define subcommands pass quiet: true | unit | src/commands/tests-generate-contract-phase12.test.ts | ✅ | T056 |
| FR-029 | Tolerant JSON extraction for native agent work | unit | src/plugins/workflow-runtime-phase12.test.ts | ✅ | T064 |
| US-019 | Execution Manifest generation | unit | src/utils/manifest.test.ts | ✅ | T037 |
| US-020 | Task state verification | unit | src/commands/tasks-verify.test.ts | ✅ | T038 |
| US-026 | Quiet output parity (specify) | unit | src/commands/specify.test.ts | ✅ | T057 |
| US-026 | Quiet output parity (plan) | unit | src/commands/define-plan.test.ts | ✅ | T058 |
| US-026 | Quiet output parity (tasks) | unit | src/commands/tasks-generate.test.ts | ✅ | T059 |
