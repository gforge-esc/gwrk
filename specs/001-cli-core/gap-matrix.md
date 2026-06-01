| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| US-026 | Quiet output parity (specify) | unit | src/commands/specify.test.ts | ✅ | |
| US-026 | Quiet output parity (plan) | unit | src/commands/define-plan.test.ts | ✅ | |
| US-026 | Quiet output parity (tasks) | unit | src/commands/tasks-generate.test.ts | ✅ | |
| US-026 | Quiet output parity (tests) | unit | src/commands/tests-generate.red.test.ts | ✅ | |
| FR-028 | define subcommands pass quiet: true | unit | src/commands/tests-generate.red.test.ts | ✅ | |
| FR-029 | Tolerant JSON extraction (Strict mode) | unit | src/plugins/workflow-runtime.red.test.ts | ✅ | |
| TC-008 | Quiet agent output policy | unit | src/utils/agent.test.ts | ✅ | |
| US-028 | Project-Aware Prompt Conditioning | unit | src/engine/prompt-conditioner.test.ts | ✅ | |
| US-029 | Project Profile Introspection | unit | src/commands/project-info.test.ts | ✅ | |
| FR-033 | Inject <project_profile> XML block | unit | src/engine/prompt-conditioner.test.ts | ✅ | |
| FR-034 | Refactor PROMPT.md with guards | unit | src/engine/prompt-conditioner.test.ts | ✅ | |
| FR-035 | Display resolved profile | unit | src/commands/project-info.test.ts | ✅ | |
| TC-009 | Single prompt integration point | unit | src/engine/prompt-conditioner.test.ts | ✅ | |
| TC-010 | Backward compatibility (snapshot) | unit | src/engine/profile-detector.test.ts | ✅ | |
| TC-011 | Schema extension backward compat | unit | src/utils/config.test.ts | ✅ | |
