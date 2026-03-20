| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-002 | Create git worktree sandbox | unit | src/server/sandbox.test.ts | ✅ | |
| US-002 | Isolated Sandboxes | unit | src/server/sandbox.test.ts | ✅ | |
| TC-004 | No Host Mutation | unit | src/server/sandbox.test.ts | ✅ | |
| TC-005 | Worktree Lifecycle / Prune | unit | src/server/sandbox.test.ts | ✅ | |
| FR-001 | DispatchOrchestrator parallel tasks | unit | src/server/dispatch-orchestrator.test.ts | ✅ | |
| FR-004 | Concurrency Capacity Gating | unit | src/server/dispatch-orchestrator.test.ts | ✅ | |
| FR-005 | 429 Exponential Backoff | unit | src/server/dispatch-orchestrator.test.ts | ✅ | |
| FR-006 | AgentBackend local-cli support | unit | src/server/backends/invocation-strategy.test.ts | ✅ | |
| US-005 | Cross-Backend Dispatch | unit | src/server/backends/invocation-strategy.test.ts | ✅ | |
| US-001 | Dispatch Concurrent Tasks | e2e | src/005-parallel-dispatch.e2e.test.ts | ✅ | |
| US-004 | Backend Capacity Limits | e2e | src/005-parallel-dispatch.e2e.test.ts | ✅ | |
| FR-003 | WorkflowRuntime in workDir | unit | src/server/dispatch-orchestrator.test.ts | ✅ | |
| TR-001 | Concurrency Limit Verification | unit | src/server/dispatch-orchestrator.test.ts | ✅ | |
| TR-002 | Sandbox Isolation & Lifecycle | unit | src/server/sandbox.test.ts | ✅ | |
| TR-003 | Local CLI Dispatch Verification | unit | src/server/backends/invocation-strategy.test.ts | ✅ | |
| TC-003 | Fail-Fast Configuration | unit | src/utils/config.test.ts | ✅ | |
| DM-001 | Dispatch State Model | unit | src/server/dispatch-orchestrator.test.ts | ✅ | |
| DM-002 | TaskDispatch/Result Contracts | unit | src/server/backends/invocation-strategy.test.ts | ✅ | |
| SC-002 | Host Repo Integrity | unit | src/server/sandbox.test.ts | ✅ | |
| VR-001 | Dummy Feature Ship Verification | e2e | src/005-parallel-dispatch.e2e.test.ts | ✅ | |
