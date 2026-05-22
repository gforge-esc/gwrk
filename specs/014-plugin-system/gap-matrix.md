| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | Plugin install validates manifest | integration | src/commands/plugin.test.ts | ✅ | |
| FR-002 | Manifest validation | unit | src/plugins/manifest.test.ts | ✅ | |
| FR-003 | Plugin list | integration | src/commands/plugin.test.ts | ✅ | |
| FR-004 | Plugin remove | integration | src/commands/plugin.test.ts | ✅ | |
| FR-005 | Plugin disable/enable | integration | src/commands/plugin.test.ts | ✅ | |
| FR-006 | Skill invocation | unit | src/plugins/skill-runtime.test.ts | ✅ | |
| FR-007 | Skill CLI F013 contract | integration | src/commands/skill.test.ts | ✅ | |
| FR-008 | Compound skill execution | unit | src/plugins/skill-runtime.test.ts | ✅ | |
| FR-009 | Compound skill manifest | unit | src/plugins/manifest.test.ts | ✅ | |
| FR-010 | Skill help | integration | src/commands/skill.test.ts | ✅ | |
| FR-L1-001 | Agent manifest | unit | src/plugins/manifest.test.ts | ✅ | |
| FR-L1-002 | AgentBackend dispatch | unit | src/plugins/agent-adapter.test.ts | ✅ | |
| FR-L1-003 | AgentBackend parseResult | unit | src/plugins/agent-adapter.test.ts | ✅ | |
| FR-L1-004 | AgentBackend syncGovernance | unit | src/plugins/agent-adapter.test.ts | ✅ | |
| FR-L25-001 | WorkflowRuntime resolves | unit | src/plugins/workflow-runtime.test.ts | ✅ | |
| FR-L25-002 | WorkflowRuntime executes intents | unit | src/engine/intent-engine.test.ts | ✅ | |
| US-001 | Install skill plugin | e2e | e2e/plugin-system.spec.ts | ✅ | |
| US-005 | Invoke atomic skill | e2e | e2e/skill-system.spec.ts | ✅ | |
| US-011 | Execute built-in workflow | e2e | e2e/workflow-system.spec.ts | ✅ | |