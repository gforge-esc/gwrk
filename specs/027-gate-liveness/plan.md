# 027 — Gate-Invoked-Test Liveness · Plan

## Phases

### Phase 1 — Conservative Liveness in Inline Gate Runner (3 SP)
- `src/engine/test-runner.ts` (MODIFY: Add `hasRecognizedTestSummary(output)`)
- `src/utils/gate-exec.ts` (MODIFY: Fail passing inline gates when an integration test command emits a recognized 0-test summary)
- `src/utils/gate-exec.test.ts` (MODIFY: Add TR-001 through TR-004 liveness tests)
