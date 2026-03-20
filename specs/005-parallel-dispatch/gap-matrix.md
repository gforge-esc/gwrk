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
