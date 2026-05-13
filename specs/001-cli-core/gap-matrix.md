| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-028 | All define subcommands pass quiet: true | unit | src/commands/tests-generate.test.ts | ✅ | T071 |
| FR-028 | specify passes quiet: true | unit | src/commands/specify.test.ts | ✅ | T072 |
| FR-028 | define-plan passes quiet: true | unit | src/commands/define-plan.test.ts | ✅ | T073 |
| FR-028 | tasks-generate passes quiet: true | unit | src/commands/tasks-generate.test.ts | ✅ | T074 |
| FR-029 | Tolerant JSON extraction in WorkflowRuntime | unit | src/plugins/workflow-runtime.test.ts | ✅ | T075 |
| FR-029 | Prose-only output + artifacts = success | unit | src/commands/tests-generate-contract.test.ts | ✅ | T076 |