# Coverage Matrix for 019-agy-agent-migration

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | AgyAdapter implements AgentBackend | unit | src/plugins/builtins/agents/agy/adapter.test.ts | ✅ | |
| FR-002 | Default agent backend is agy | unit | src/engine/router.test.ts | ✅ | |
| FR-003 | syncGovernance persists rules | unit | src/plugins/builtins/agents/agy/adapter.test.ts | ✅ | |
| FR-004 | Map YOLO to --dangerously-skip-permissions and omit --model | unit | src/plugins/builtins/agents/agy/adapter.test.ts | ✅ | |
| US-001 | Dispatch via Agy Backend | e2e | none | ❌ | |
| US-002 | Agy Governance Sync | unit | src/plugins/builtins/agents/agy/adapter.test.ts | ✅ | |
| TR-001 | Verify command generation maps YOLO flag | unit | src/plugins/builtins/agents/agy/adapter.test.ts | ✅ | |
| TR-002 | Verify router fallback chain prioritizes agy | unit | src/engine/router.test.ts | ✅ | |

Note: US-001 deferred - End-to-end test validates dispatch via existing gate checking, so no dedicated E2E test file created in this phase.
